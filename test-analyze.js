const testCode = `/*
Matrix Multiplication, with help from cuBLASLt
*/
#include <assert.h>
#include <type_traits>      // std::bool_constant
// llmc internal imports
#include "cuda_common.h"
#include "cuda_utils.cuh"
#include "cublas_common.h"
// GELU can be either fused (cublasLt) or non-fused (gelu.h)
#include "gelu.cuh"

// ----------------------------------------------------------------------------
// CUDA kernels

template<typename OutFloat, bool UseAuxBuffer>
__global__ void matmul_backward_bias_kernel9(OutFloat* dbias, const floatX* dout, int B, int T, int OC,
                                             std::bool_constant<UseAuxBuffer>) {
    constexpr const int bdx = 4;
    constexpr const int bdy = WARP_SIZE / bdx;
    assert(blockDim.x == bdx);
    assert(blockDim.y == bdy);
}`;

async function testAnalyze() {
  console.log('Testing code analyzer...\n');
  console.log('Code length:', testCode.split('\n').length, 'lines\n');

  try {
    const response = await fetch('http://localhost:3000/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: testCode, language: 'cpp' }),
    });

    if (!response.ok) {
      console.error('Response not OK:', response.status);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let lineCount = 0;
    let hasErrors = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'concept') {
              console.log('✓ CONCEPT:', data.concept);
              console.log('  Why unique:', data.whyUnique);
              console.log('  Summary:', data.summary?.substring(0, 100) + '...\n');
            } else if (data.type === 'line') {
              lineCount++;
              const hasExplanation = data.line.explanation && !data.line.explanation.includes('Could not');
              if (!hasExplanation) hasErrors = true;
              console.log(`${hasExplanation ? '✓' : '✗'} Line ${data.line.lineNumber}: ${data.line.code.substring(0, 40).padEnd(40)} | ${data.line.explanation}`);
            } else if (data.type === 'done') {
              console.log('\n--- DONE ---');
            } else if (data.type === 'error') {
              console.error('ERROR:', data.message);
              hasErrors = true;
            }
          } catch (e) {
            console.error('Parse error:', e.message);
          }
        }
      }
    }

    console.log(`\nTotal lines analyzed: ${lineCount}`);
    console.log(`Status: ${hasErrors ? '❌ FAILED - Some lines could not be analyzed' : '✅ SUCCESS'}`);

  } catch (error) {
    console.error('Test failed:', error);
  }
}

testAnalyze();
