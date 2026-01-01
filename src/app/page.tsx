'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Play, Loader2, Code, RotateCcw, Sparkles, CheckCircle } from 'lucide-react';
import { detectLanguage, getLanguageLabel } from '@/lib/detectLanguage';

interface CodeLine {
  lineNumber: number;
  code: string;
  explanation: string;
}

interface AnalysisResult {
  concept: string;
  whyUnique: string;
  summary: string;
  lines: CodeLine[];
}

const sampleCode = `function quickSort(arr) {
  if (arr.length <= 1) {
    return arr;
  }

  const pivot = arr[0];
  const left = [];
  const right = [];

  for (let i = 1; i < arr.length; i++) {
    if (arr[i] < pivot) {
      left.push(arr[i]);
    } else {
      right.push(arr[i]);
    }
  }

  return [...quickSort(left), pivot, ...quickSort(right)];
}`;

export default function Home() {
  const [inputCode, setInputCode] = useState(sampleCode);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [detectedLang, setDetectedLang] = useState('');
  const [oneShot, setOneShot] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [isDone, setIsDone] = useState(false);
  const [visibleLines, setVisibleLines] = useState<number>(0);
  const [typingLine, setTypingLine] = useState<number>(-1);
  const [typedCode, setTypedCode] = useState('');
  const [typedExplanation, setTypedExplanation] = useState('');
  const [phase, setPhase] = useState<'code' | 'explanation' | 'done'>('done');
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);
  const lastScrollTop = useRef(0);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
    if (scrollTop < lastScrollTop.current && !isAtBottom) {
      userScrolledUp.current = true;
    }
    if (isAtBottom) {
      userScrolledUp.current = false;
    }
    lastScrollTop.current = scrollTop;
  };

  const autoScroll = () => {
    if (scrollRef.current && !userScrolledUp.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    if (!analysis || typingLine < 0 || typingLine >= analysis.lines.length) return;

    // One Shot mode: skip animation, show all instantly
    if (oneShot) {
      setVisibleLines(analysis.lines.length);
      setTypingLine(-1);
      setPhase('done');
      autoScroll();
      return;
    }

    const line = analysis.lines[typingLine];

    if (phase === 'code') {
      let i = 0;
      setTypedCode('');
      const interval = setInterval(() => {
        if (i <= line.code.length) {
          setTypedCode(line.code.slice(0, i));
          i += 2;
        } else {
          clearInterval(interval);
          setPhase('explanation');
        }
      }, 5);
      return () => clearInterval(interval);
    }

    if (phase === 'explanation') {
      let i = 0;
      setTypedExplanation('');
      const interval = setInterval(() => {
        if (i <= line.explanation.length) {
          setTypedExplanation(line.explanation.slice(0, i));
          i += 2;
          autoScroll();
        } else {
          clearInterval(interval);
          setVisibleLines(prev => prev + 1);
          if (typingLine < analysis.lines.length - 1) {
            setTypingLine(prev => prev + 1);
            setPhase('code');
          } else {
            setPhase('done');
          }
        }
      }, 8);
      return () => clearInterval(interval);
    }
  }, [phase, typingLine, analysis, oneShot]);

  // Start typing when new lines arrive
  useEffect(() => {
    if (analysis && analysis.lines.length > 0 && typingLine === -1) {
      if (oneShot) {
        // One Shot: show all lines instantly
        setVisibleLines(analysis.lines.length);
        setPhase('done');
        autoScroll();
      } else {
        setTypingLine(0);
        setPhase('code');
      }
    }
  }, [analysis?.lines.length, oneShot]);

  // One Shot: always show all lines instantly when enabled
  useEffect(() => {
    if (oneShot && analysis && analysis.lines.length > 0) {
      setVisibleLines(analysis.lines.length);
      setTypingLine(-1);
      setPhase('done');
      autoScroll();
    }
  }, [oneShot, analysis?.lines.length]);

  const handleAnalyze = async (forceOneShot?: boolean) => {
    if (!inputCode.trim()) return;

    const useOneShot = forceOneShot ?? oneShot;
    const language = detectLanguage(inputCode);
    setDetectedLang(language);
    setIsAnalyzing(true);
    setAnalysis(null);
    setIsDone(false);
    setVisibleLines(0);
    setTypingLine(-1);
    setTypedCode('');
    setTypedExplanation('');
    setPhase('done');
    userScrolledUp.current = false;

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: inputCode, language, oneShot: useOneShot }),
      });

      if (!response.ok) throw new Error('Analysis failed');

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('No response body');

      let buffer = '';
      let result: AnalysisResult = { concept: '', whyUnique: '', summary: '', lines: [] };

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
                result.concept = data.concept;
                result.whyUnique = data.whyUnique;
                result.summary = data.summary || '';
                setAnalysis({ ...result });
              } else if (data.type === 'line') {
                result.lines.push(data.line);
                setAnalysis({ ...result });
              } else if (data.type === 'done') {
                setIsDone(true);
              }
            } catch {
              // Skip
            }
          }
        }
      }
    } catch (error) {
      console.error('Analysis error:', error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleReset = () => {
    setAnalysis(null);
    setIsDone(false);
    setDetectedLang('');
    setVisibleLines(0);
    setTypingLine(-1);
  };

  return (
    <main className="h-screen bg-[#0a0a0a] flex flex-col overflow-hidden">
      {/* Header */}
      <header className="border-b border-emerald-900/30 px-6 py-3 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Code className="w-4 h-4 text-black" />
            </div>
            <span className="font-semibold text-emerald-400">Code Whisperer</span>
            {detectedLang && (
              <span className="text-xs text-emerald-600 bg-emerald-950/50 border border-emerald-900/50 px-2 py-1 rounded">
                {getLanguageLabel(detectedLang)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {analysis && (
              <Button variant="ghost" size="sm" onClick={handleReset} className="text-emerald-600 hover:text-emerald-400">
                <RotateCcw className="w-4 h-4" />
              </Button>
            )}
            <button
              onClick={() => {
                if (!oneShot) {
                  setOneShot(true);
                  if (!isAnalyzing && inputCode.trim()) {
                    handleAnalyze(true);
                  }
                } else {
                  setOneShot(false);
                }
              }}
              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                oneShot
                  ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                  : 'bg-transparent border-zinc-700 text-zinc-500 hover:border-zinc-600'
              }`}
            >
              One Shot
            </button>
            <Button
              id="analyze-btn"
              onClick={() => handleAnalyze()}
              disabled={isAnalyzing || !inputCode.trim()}
              size="sm"
              className="bg-emerald-500 text-black hover:bg-emerald-400"
            >
              {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Play className="w-4 h-4 mr-1.5" />Analyze</>}
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-6"
      >
        {/* Input Mode */}
        {!analysis && !isAnalyzing && (
          <textarea
            value={inputCode}
            onChange={(e) => setInputCode(e.target.value)}
            className="w-full h-[calc(100vh-120px)] bg-emerald-950/20 border border-emerald-900/30 rounded-lg p-4 font-mono text-sm text-emerald-300 resize-none focus:outline-none focus:border-emerald-700/50 placeholder:text-emerald-800"
            placeholder="// Paste your code here..."
            spellCheck={false}
          />
        )}

        {/* Loading */}
        {isAnalyzing && !analysis && (
          <div className="flex flex-col items-center justify-center py-32">
            <Loader2 className="w-8 h-8 animate-spin text-emerald-500 mb-4" />
            <p className="text-emerald-600">Analyzing...</p>
          </div>
        )}

        {/* Results */}
        {analysis && (
          <div className="flex gap-8">
            <div className="flex-1 min-w-0 space-y-4">
              {/* Concept */}
              {analysis.concept && (
                <div className="flex items-center gap-3 pb-4 border-b border-emerald-900/30">
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  <span className="text-emerald-300 font-medium">{analysis.concept}</span>
                  <span className="text-emerald-700 text-sm">— {analysis.whyUnique}</span>
                </div>
              )}

              {/* Lines */}
              <div className="font-mono text-sm space-y-1 overflow-x-auto">
                {analysis.lines.map((line, idx) => {
                  const isVisible = idx < visibleLines;
                  const isTyping = idx === typingLine;

                  if (!isVisible && !isTyping) return null;

                  return (
                    <div key={idx}>
                      {/* Code line */}
                      <div className={`flex items-start py-1 ${isTyping ? 'bg-emerald-950/30' : ''}`}>
                        <span className="w-12 text-right pr-4 text-emerald-800 text-xs select-none shrink-0 pt-0.5">
                          {line.lineNumber}
                        </span>
                        <pre className="flex-1">
                          <code className="text-emerald-300 whitespace-pre">
                            {isTyping && phase === 'code' ? typedCode : line.code}
                            {isTyping && phase === 'code' && <span className="text-emerald-500 animate-pulse">█</span>}
                          </code>
                        </pre>
                      </div>

                      {/* Explanation */}
                      {(isVisible || (isTyping && phase === 'explanation')) && line.explanation && (
                        <div className="flex items-start ml-12 mb-3">
                          <div className="text-sm text-emerald-600 pl-4 border-l border-emerald-900/50">
                            {isTyping && phase === 'explanation' ? typedExplanation : line.explanation}
                            {isTyping && phase === 'explanation' && <span className="text-emerald-500 animate-pulse">█</span>}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Done */}
              {isDone && phase === 'done' && visibleLines >= (analysis?.lines.length || 0) && (
                <div className="flex items-center gap-2 pt-4">
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                  <span className="text-sm text-emerald-400">Analysis Complete</span>
                </div>
              )}
            </div>

            {/* Summary Panel */}
            {isDone && phase === 'done' && analysis.summary && visibleLines >= (analysis?.lines.length || 0) && (
              <div className="w-80 shrink-0">
                <div className="sticky top-6 bg-emerald-950/30 border border-emerald-900/30 rounded-xl p-5 max-h-[calc(100vh-120px)] overflow-y-auto">
                  <div className="flex items-center gap-2 mb-4">
                    <Sparkles className="w-4 h-4 text-emerald-400" />
                    <span className="text-sm font-medium text-emerald-300">In Simple Terms</span>
                  </div>
                  <p className="text-sm text-emerald-500 leading-relaxed">{analysis.summary}</p>
                  <div className="mt-4 pt-4 border-t border-emerald-900/30 text-xs text-emerald-700">
                    <div>Language: {getLanguageLabel(detectedLang)}</div>
                    <div className="mt-1">Lines: {analysis.lines.length}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
