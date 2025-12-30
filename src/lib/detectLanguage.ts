export function detectLanguage(code: string): string {
  const lines = code.trim().split('\n');
  const firstLines = lines.slice(0, 10).join('\n');
  const allCode = code.toLowerCase();

  // Python
  if (
    /^(import |from .+ import |def |class |if __name__|print\(|#.*coding)/.test(code) ||
    /:\s*$/.test(firstLines) && /^\s{4}/.test(lines[1] || '') ||
    /self\.|\.py/.test(code)
  ) {
    return 'python';
  }

  // Rust (check after C++ to avoid false positives)
  if (
    /^(use |mod |pub fn |impl |pub struct |pub enum )/.test(code) ||
    /fn\s+\w+\s*\([^)]*\)\s*->/.test(code) ||
    /println!\(|vec!\[|&str|&mut |\.unwrap\(\)|\.expect\(|Option<|Result</.test(code) ||
    /let mut \w+\s*=/.test(code)
  ) {
    // Make sure it's not C++ with #include
    if (!/#include/.test(code)) {
      return 'rust';
    }
  }

  // Go
  if (
    /^(package |import \(|func |type .+ struct|var |const )/.test(code) ||
    /func\s+\w+\s*\([^)]*\)\s*\w*\s*{/.test(code) ||
    /fmt\.|:=|go func|chan /.test(code)
  ) {
    return 'go';
  }

  // Java
  if (
    /^(package |import java\.|public class |private |protected )/.test(code) ||
    /public static void main|System\.out\.print|new \w+\(|@Override/.test(code) ||
    /class \w+ (extends|implements)/.test(code)
  ) {
    return 'java';
  }

  // C++ / CUDA
  if (
    /^#include\s*</.test(code) ||
    /iostream|std::|cout|cin|nullptr|template\s*<|vector<|::/.test(code) ||
    /int main\s*\(/.test(code) && /#include/.test(code) ||
    /__global__|__device__|__host__|__shared__|cudaMalloc|cudaMemcpy|blockIdx|threadIdx|blockDim|gridDim/.test(code) ||
    /cublasLt|cublas|floatX|CUDA_R_|constexpr/.test(code)
  ) {
    return 'cpp';
  }

  // C
  if (
    /^#include\s*<(stdio|stdlib|string|stdint|assert|math|time|unistd|stdbool|limits|float|errno|signal|setjmp|ctype|locale|stdarg|stddef)\.h>/.test(code) ||
    /printf\(|scanf\(|malloc\(|int main\s*\(/.test(code) && !/#include\s*<iostream>/.test(code) ||
    /#ifdef\s+\w+|#ifndef\s+\w+|#endif|#define\s+\w+/.test(code) && /#include\s*<\w+\.h>/.test(code)
  ) {
    return 'c';
  }

  // TypeScript
  if (
    /^(import .+ from |export |interface |type \w+ =|:\s*(string|number|boolean|any)\b)/.test(code) ||
    /: (string|number|boolean|any|void)\b|<\w+>|\?: /.test(code) ||
    /\.tsx?$/.test(code)
  ) {
    return 'typescript';
  }

  // JavaScript (default for JS-like syntax)
  if (
    /^(const |let |var |function |import |export |class )/.test(code) ||
    /=>\s*{|\.then\(|async |await |console\.log/.test(code) ||
    /\bfunction\s+\w+\s*\(/.test(code)
  ) {
    return 'javascript';
  }

  // Ruby
  if (
    /^(require |def |class |module |end$|puts |attr_)/.test(code) ||
    /do\s*\|.*\||\.each|\.map|@\w+|#{/.test(code)
  ) {
    return 'ruby';
  }

  // PHP
  if (
    /^<\?php|<\?=|\$\w+|function \w+\s*\(.*\$|->|echo |namespace /.test(code)
  ) {
    return 'php';
  }

  // Swift
  if (
    /^(import |func |var |let |class |struct |enum |protocol )/.test(code) ||
    /guard |if let|print\(|-> |nil\b|\.self/.test(code)
  ) {
    return 'swift';
  }

  // Kotlin
  if (
    /^(fun |val |var |class |package |import )/.test(code) ||
    /println\(|fun \w+\(|: \w+ =|null\?|\.kt$/.test(code)
  ) {
    return 'kotlin';
  }

  // SQL
  if (
    /^(SELECT |INSERT |UPDATE |DELETE |CREATE |DROP |ALTER )/i.test(code) ||
    /FROM .+ WHERE|JOIN .+ ON|GROUP BY|ORDER BY/i.test(code)
  ) {
    return 'sql';
  }

  // Shell/Bash
  if (
    /^(#!\/bin\/(bash|sh)|export |echo |if \[|fi$|done$|esac$)/.test(code) ||
    /\$\{|\$\(|&&|\|\||>>/.test(code)
  ) {
    return 'shell';
  }

  // Default to JavaScript
  return 'javascript';
}

export function getLanguageLabel(lang: string): string {
  const labels: Record<string, string> = {
    javascript: 'JavaScript',
    typescript: 'TypeScript',
    python: 'Python',
    java: 'Java',
    cpp: 'C++',
    c: 'C',
    go: 'Go',
    rust: 'Rust',
    ruby: 'Ruby',
    php: 'PHP',
    swift: 'Swift',
    kotlin: 'Kotlin',
    sql: 'SQL',
    shell: 'Shell',
  };
  return labels[lang] || lang;
}
