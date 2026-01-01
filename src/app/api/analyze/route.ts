import { NextRequest } from 'next/server';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_LINES_PER_BATCH = 100;

function isCommentLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (t.startsWith('//')) return true;
  if (t.startsWith('#') && !t.startsWith('#include') && !t.startsWith('#define') && !t.startsWith('#ifdef') && !t.startsWith('#ifndef') && !t.startsWith('#endif') && !t.startsWith('#pragma')) return true;
  if (t.startsWith('/*') || t.startsWith('*') || t.startsWith('*/')) return true;
  if (t.startsWith('--')) return true;
  if (t.startsWith('"""') || t.startsWith("'''")) return true;
  return false;
}

export async function POST(request: NextRequest) {
  try {
    const { code, language, oneShot } = await request.json();

    if (!code) {
      return new Response(JSON.stringify({ error: 'No code provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const allLines = code.split('\n');
    const codeLines: { lineNumber: number; code: string }[] = [];

    for (let i = 0; i < allLines.length; i++) {
      if (!isCommentLine(allLines[i])) {
        codeLines.push({ lineNumber: i + 1, code: allLines[i] });
      }
    }

    const lineCount = codeLines.length;

    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();
    let writerClosed = false;

    const safeWrite = async (data: string) => {
      if (writerClosed) return;
      try {
        await writer.write(encoder.encode(data));
      } catch {
        writerClosed = true;
      }
    };

    const safeClose = async () => {
      if (writerClosed) return;
      try {
        writerClosed = true;
        await writer.close();
      } catch {
        // Already closed
      }
    };

    (async () => {
      try {
        const batches: { lineNumber: number; code: string }[][] = [];
        if (oneShot) {
          // One shot mode: all lines in single batch
          batches.push(codeLines);
        } else {
          for (let i = 0; i < codeLines.length; i += MAX_LINES_PER_BATCH) {
            batches.push(codeLines.slice(i, i + MAX_LINES_PER_BATCH));
          }
        }

        let conceptSent = false;

        const processBatch = async (batch: { lineNumber: number; code: string }[], batchIndex: number, includeConcept: boolean) => {
          const batchLineCount = batch.length;
          const batchCode = batch.map(l => l.code).join('\n');

          const systemPrompt = `Explain code simply. Return ONLY JSON, no markdown.
${includeConcept ? `{"concept":"2-3 words","whyUnique":"1 sentence","summary":"2 sentences","lines":[...]}` : `{"lines":[...]}`}
Line format: {"lineNumber":N,"code":"...","explanation":"8-12 words"}
Rules: ${batchLineCount} lines, simple words, no markdown`;

          const userPrompt = `Analyze these ${batchLineCount} lines of ${language} code:

\`\`\`${language}
${batchCode}
\`\`\``;

          const response = await fetch(OPENROUTER_API_URL, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
              'X-Title': 'Code Whisperer',
            },
            body: JSON.stringify({
              model: 'meta-llama/llama-3.3-70b-instruct',
              max_tokens: oneShot ? 8192 : 4096,
              stream: true,
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
              ],
            }),
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || `API error: ${response.status}`);
          }

          // Read streaming response
          const reader = response.body?.getReader();
          const decoder = new TextDecoder();
          let responseText = '';

          if (reader) {
            let streamBuffer = '';
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              streamBuffer += decoder.decode(value, { stream: true });
              const lines = streamBuffer.split('\n');
              streamBuffer = lines.pop() || '';

              for (const line of lines) {
                if (line.startsWith('data: ') && !line.includes('[DONE]')) {
                  try {
                    const chunk = JSON.parse(line.slice(6));
                    const content = chunk.choices?.[0]?.delta?.content;
                    if (content) responseText += content;
                  } catch {
                    // Skip parse errors
                  }
                }
              }
            }
          }

          let analysisData;
          try {
            let cleanedResponse = responseText || '';
            cleanedResponse = cleanedResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '');
            cleanedResponse = cleanedResponse.trim();

            const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              analysisData = JSON.parse(jsonMatch[0]);
              console.log(`Batch ${batchIndex + 1}: Parsed ${analysisData.lines?.length || 0} lines`);
            } else {
              throw new Error('No JSON');
            }
          } catch {
            analysisData = {
              concept: 'Code Analysis',
              whyUnique: '',
              summary: '',
              lines: batch.map((item) => ({
                lineNumber: item.lineNumber,
                code: item.code,
                explanation: '⚠️ Could not analyze'
              }))
            };
          }

          return { analysisData, batch, batchIndex, includeConcept };
        };

        // Start ALL batches in parallel, stream results as each completes in order
        const allPromises = batches.map((batch, idx) =>
          processBatch(batch, idx, idx === 0 && !conceptSent)
        );

        // Process results in order as they complete
        for (let i = 0; i < allPromises.length; i++) {
          const result = await allPromises[i];

          if (result.includeConcept && !conceptSent) {
            await safeWrite(`data: ${JSON.stringify({
              type: 'concept',
              concept: result.analysisData.concept || 'Code Analysis',
              whyUnique: result.analysisData.whyUnique || '',
              summary: result.analysisData.summary || ''
            })}\n\n`);
            conceptSent = true;
          }

          if (result.analysisData.lines && Array.isArray(result.analysisData.lines)) {
            for (let j = 0; j < result.analysisData.lines.length && j < result.batch.length; j++) {
              const line = result.analysisData.lines[j];
              line.lineNumber = result.batch[j].lineNumber;
              line.code = result.batch[j].code;
              await safeWrite(`data: ${JSON.stringify({ type: 'line', line })}\n\n`);
            }
          }
        }

        await safeWrite(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      } catch (error) {
        console.error('Analysis error:', error);
        await safeWrite(`data: ${JSON.stringify({
          type: 'error',
          message: error instanceof Error ? error.message : 'Analysis failed'
        })}\n\n`);
      } finally {
        await safeClose();
      }
    })();

    return new Response(stream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Request error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
