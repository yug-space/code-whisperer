import { NextRequest } from 'next/server';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_LINES_PER_BATCH = 150;

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

        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
          const batch = batches[batchIndex];
          const batchLineCount = batch.length;
          const batchCode = batch.map(l => l.code).join('\n');

          const systemPrompt = `You explain code to a 16-year-old beginner. Return ONLY valid JSON, no markdown.

${!conceptSent ? `{
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
              'X-Title': 'Code Analyzer',
            },
            body: JSON.stringify({
              model: 'anthropic/claude-3.5-haiku',
              max_tokens: 8000,
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

          const data = await response.json();
          const responseText = data.choices?.[0]?.message?.content;

          let analysisData;
          try {
            // Remove markdown code blocks if present
            let cleanedResponse = responseText || '';
            cleanedResponse = cleanedResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '');
            cleanedResponse = cleanedResponse.trim();

            const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              analysisData = JSON.parse(jsonMatch[0]);
              console.log(`Batch ${batchIndex + 1}: Parsed ${analysisData.lines?.length || 0} lines`);
            } else {
              console.error('No JSON found in response:', cleanedResponse.substring(0, 200));
              throw new Error('No JSON');
            }
          } catch (parseError) {
            console.error('JSON parse error:', parseError, 'Response:', responseText?.substring(0, 500));
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

          if (!conceptSent) {
            await safeWrite(`data: ${JSON.stringify({
              type: 'concept',
              concept: analysisData.concept || 'Code Analysis',
              whyUnique: analysisData.whyUnique || '',
              summary: analysisData.summary || ''
            })}\n\n`);
            conceptSent = true;
          }

          if (analysisData.lines && Array.isArray(analysisData.lines)) {
            for (let i = 0; i < analysisData.lines.length && i < batch.length; i++) {
              const line = analysisData.lines[i];
              line.lineNumber = batch[i].lineNumber;
              line.code = batch[i].code;
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
