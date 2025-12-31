import { NextRequest } from 'next/server';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_LINES_PER_BATCH = 50;

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
    const { code, language } = await request.json();

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
        for (let i = 0; i < codeLines.length; i += MAX_LINES_PER_BATCH) {
          batches.push(codeLines.slice(i, i + MAX_LINES_PER_BATCH));
        }

        let conceptSent = false;

        const processBatch = async (batch: { lineNumber: number; code: string }[], batchIndex: number, includeConcept: boolean) => {
          const batchLineCount = batch.length;
          const batchCode = batch.map(l => l.code).join('\n');

          const systemPrompt = `You explain code to a 16-year-old beginner. Return ONLY valid JSON, no markdown.

${includeConcept ? `{
  "concept": "2-3 word description",
  "whyUnique": "One sentence why this is cool",
  "summary": "3-4 sentences for a teenager using analogies",
  "lines": [...]
}` : `{"lines": [...]}`}

Each line object: {"lineNumber": N, "code": "exact code", "explanation": "10-15 word explanation"}

RULES:
- Return EXACTLY ${batchLineCount} line entries
- EVERY line gets a meaningful explanation connecting to the bigger picture
- Closing braces: explain what ended (e.g., "Ends the function that multiplies matrices")
- Empty lines: "Spacing for readability"
- Use simple words. Explain technical terms briefly.
- NO markdown, NO code blocks, ONLY raw JSON`;

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
              model: 'anthropic/claude-haiku-4.5',
              max_tokens: 8192,
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

        // Process batches 2 at a time - start both in parallel, stream as each completes
        for (let i = 0; i < batches.length; i += 2) {
          // Start first batch
          const firstPromise = processBatch(batches[i], i, !conceptSent);

          // Start second batch in parallel (if exists)
          const secondPromise = i + 1 < batches.length
            ? processBatch(batches[i + 1], i + 1, false)
            : null;

          // Wait for first batch and stream immediately
          const firstResult = await firstPromise;

          if (firstResult.includeConcept && !conceptSent) {
            await safeWrite(`data: ${JSON.stringify({
              type: 'concept',
              concept: firstResult.analysisData.concept || 'Code Analysis',
              whyUnique: firstResult.analysisData.whyUnique || '',
              summary: firstResult.analysisData.summary || ''
            })}\n\n`);
            conceptSent = true;
          }

          if (firstResult.analysisData.lines && Array.isArray(firstResult.analysisData.lines)) {
            for (let j = 0; j < firstResult.analysisData.lines.length && j < firstResult.batch.length; j++) {
              const line = firstResult.analysisData.lines[j];
              line.lineNumber = firstResult.batch[j].lineNumber;
              line.code = firstResult.batch[j].code;
              await safeWrite(`data: ${JSON.stringify({ type: 'line', line })}\n\n`);
            }
          }

          // Wait for second batch (already running) and stream
          if (secondPromise) {
            const secondResult = await secondPromise;

            if (secondResult.analysisData.lines && Array.isArray(secondResult.analysisData.lines)) {
              for (let j = 0; j < secondResult.analysisData.lines.length && j < secondResult.batch.length; j++) {
                const line = secondResult.analysisData.lines[j];
                line.lineNumber = secondResult.batch[j].lineNumber;
                line.code = secondResult.batch[j].code;
                await safeWrite(`data: ${JSON.stringify({ type: 'line', line })}\n\n`);
              }
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
