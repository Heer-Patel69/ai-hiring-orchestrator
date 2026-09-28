import { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Editor from "@monaco-editor/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  Cpu,
  HardDrive,
  Sparkles,
  Loader2,
  Code2,
  FileCode,
  Terminal,
  Lightbulb,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { analyzeCode } from "@/lib/code-analyzer";

interface TestCase {
  input: string;
  expectedOutput: string;
}

interface CodeAnalysis {
  correctness: number;
  timeComplexity: string;
  spaceComplexity: string;
  codeQuality: number;
  overallScore: number;
  suggestions: string[];
  explanation: string;
  testResults?: Array<{
    passed: boolean;
    actual: string;
    expected: string;
  }>;
}

interface CodeEditorPanelProps {
  problemStatement?: string;
  testCases?: TestCase[];
  onCodeChange?: (code: string, language: string) => void;
  onAnalysisComplete?: (analysis: CodeAnalysis) => void;
  className?: string;
}

const languages = [
  { value: "python", label: "Python", extension: ".py" },
  { value: "javascript", label: "JavaScript", extension: ".js" },
  { value: "typescript", label: "TypeScript", extension: ".ts" },
  { value: "java", label: "Java", extension: ".java" },
  { value: "cpp", label: "C++", extension: ".cpp" },
  { value: "go", label: "Go", extension: ".go" },
  { value: "rust", label: "Rust", extension: ".rs" },
];

const defaultCode: Record<string, string> = {
  python: `# Write your solution here
def solution(input_data):
    # Your code here
    pass
`,
  javascript: `// Write your solution here
function solution(inputData) {
    // Your code here
}
`,
  typescript: `// Write your solution here
function solution(inputData: any): any {
    // Your code here
}
`,
  java: `// Write your solution here
public class Solution {
    public static Object solution(Object input) {
        // Your code here
        return null;
    }
}
`,
  cpp: `// Write your solution here
#include <iostream>
using namespace std;

int main() {
    // Your code here
    return 0;
}
`,
  go: `// Write your solution here
package main

func solution(input interface{}) interface{} {
    // Your code here
    return nil
}
`,
  rust: `// Write your solution here
fn solution(input: &str) -> String {
    // Your code here
    String::new()
}
`,
};

export function CodeEditorPanel({
  problemStatement,
  testCases = [],
  onCodeChange,
  onAnalysisComplete,
  className,
}: CodeEditorPanelProps) {
  const [language, setLanguage] = useState("python");
  const [code, setCode] = useState(defaultCode.python);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<CodeAnalysis | null>(null);
  const [activeTab, setActiveTab] = useState("editor");
  const editorRef = useRef<any>(null);
  const { toast } = useToast();

  const handleLanguageChange = useCallback((newLang: string) => {
    setLanguage(newLang);
    setCode(defaultCode[newLang] || "");
  }, []);

  const handleCodeChange = useCallback(
    (value: string | undefined) => {
      const newCode = value || "";
      setCode(newCode);
      onCodeChange?.(newCode, language);
    },
    [language, onCodeChange]
  );

  const handleRunCode = useCallback(async () => {
    setIsAnalyzing(true);
    setActiveTab("results");

    try {
      const data = await analyzeCode({
        code,
        language,
        testCases: testCases.length > 0 ? testCases : undefined,
      });

      setAnalysis(data);
      onAnalysisComplete?.(data);

      if (data.overallScore >= 80) {
        toast({
          title: "Great job! 🎉",
          description: `Your solution scored ${data.overallScore}/100`,
        });
      } else {
        toast({
          title: "Code Analyzed",
          description: `Analysis completed with overall score: ${data.overallScore}/100`,
        });
      }
    } catch (error) {
      console.error("Code analysis error:", error);
      toast({
        title: "Analysis failed",
        description: "Unable to analyze your code. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsAnalyzing(false);
    }
  }, [code, language, testCases, onAnalysisComplete, toast]);

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-success";
    if (score >= 60) return "text-warning";
    return "text-danger";
  };

  const getScoreBg = (score: number) => {
    if (score >= 80) return "bg-success/10";
    if (score >= 60) return "bg-warning/10";
    return "bg-danger/10";
  };

  return (
    <div className={cn("flex flex-col h-full rounded-xl border border-border bg-card", className)}>
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div className="flex items-center gap-3">
          <Select value={language} onValueChange={handleLanguageChange}>
            <SelectTrigger className="w-36 h-8">
              <Code2 className="h-4 w-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {languages.map((lang) => (
                <SelectItem key={lang.value} value={lang.value}>
                  {lang.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Badge variant="outline" className="text-xs">
            <FileCode className="h-3 w-3 mr-1" />
            solution{languages.find((l) => l.value === language)?.extension}
          </Badge>
        </div>

        <Button
          size="sm"
          onClick={handleRunCode}
          disabled={isAnalyzing}
          className="gap-2"
        >
          {isAnalyzing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Analyzing...
            </>
          ) : (
            <>
              <Play className="h-4 w-4" />
              Run & Analyze
            </>
          )}
        </Button>
      </div>

      {/* Problem Statement */}
      {problemStatement && (
        <div className="p-3 border-b border-border bg-secondary/30">
          <p className="text-sm text-muted-foreground">{problemStatement}</p>
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <TabsList className="mx-3 mt-2 w-fit">
          <TabsTrigger value="editor" className="gap-1.5">
            <Code2 className="h-3.5 w-3.5" />
            Editor
          </TabsTrigger>
          <TabsTrigger value="results" className="gap-1.5">
            <Terminal className="h-3.5 w-3.5" />
            Results
            {analysis && (
              <Badge
                variant="secondary"
                className={cn("ml-1 h-5 px-1.5", getScoreBg(analysis.overallScore))}
              >
                {analysis.overallScore}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="editor" className="flex-1 min-h-0 m-0 mt-2">
          <Editor
            height="100%"
            language={language}
            value={code}
            onChange={handleCodeChange}
            theme="vs-dark"
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              lineNumbers: "on",
              automaticLayout: true,
              scrollBeyondLastLine: false,
              padding: { top: 12, bottom: 12 },
              wordWrap: "on",
            }}
            onMount={(editor) => {
              editorRef.current = editor;
            }}
          />
        </TabsContent>

        <TabsContent value="results" className="flex-1 min-h-0 m-0 overflow-auto p-4">
          {isAnalyzing ? (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <Loader2 className="h-12 w-12 text-primary animate-spin" />
              <p className="text-muted-foreground">Analyzing your code...</p>
            </div>
          ) : analysis ? (
            <div className="space-y-4">
              {/* Overall Score */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn("p-4 rounded-lg", getScoreBg(analysis.overallScore))}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Overall Score</p>
                    <p className={cn("text-3xl font-bold", getScoreColor(analysis.overallScore))}>
                      {analysis.overallScore}/100
                    </p>
                  </div>
                  <Sparkles className={cn("h-8 w-8", getScoreColor(analysis.overallScore))} />
                </div>
              </motion.div>

              {/* Metrics Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-secondary/50">
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                    <span className="text-xs text-muted-foreground">Correctness</span>
                  </div>
                  <p className={cn("text-lg font-bold", getScoreColor(analysis.correctness))}>
                    {analysis.correctness}%
                  </p>
                </div>

                <div className="p-3 rounded-lg bg-secondary/50">
                  <div className="flex items-center gap-2 mb-1">
                    <Code2 className="h-4 w-4 text-primary" />
                    <span className="text-xs text-muted-foreground">Code Quality</span>
                  </div>
                  <p className={cn("text-lg font-bold", getScoreColor(analysis.codeQuality))}>
                    {analysis.codeQuality}%
                  </p>
                </div>

                <div className="p-3 rounded-lg bg-secondary/50">
                  <div className="flex items-center gap-2 mb-1">
                    <Clock className="h-4 w-4 text-primary" />
                    <span className="text-xs text-muted-foreground">Time Complexity</span>
                  </div>
                  <p className="text-lg font-bold font-mono">{analysis.timeComplexity}</p>
                </div>

                <div className="p-3 rounded-lg bg-secondary/50">
                  <div className="flex items-center gap-2 mb-1">
                    <HardDrive className="h-4 w-4 text-primary" />
                    <span className="text-xs text-muted-foreground">Space Complexity</span>
                  </div>
                  <p className="text-lg font-bold font-mono">{analysis.spaceComplexity}</p>
                </div>
              </div>

              {/* Test Results */}
              {analysis.testResults && analysis.testResults.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold mb-2">Test Cases</h4>
                  <div className="space-y-2">
                    {analysis.testResults.map((result, i) => (
                      <div
                        key={i}
                        className={cn(
                          "p-3 rounded-lg flex items-center gap-3",
                          result.passed ? "bg-success/10" : "bg-danger/10"
                        )}
                      >
                        {result.passed ? (
                          <CheckCircle2 className="h-5 w-5 text-success" />
                        ) : (
                          <XCircle className="h-5 w-5 text-danger" />
                        )}
                        <div className="flex-1">
                          <p className="text-sm font-medium">Test Case {i + 1}</p>
                          <p className="text-xs text-muted-foreground">
                            Expected: {result.expected} | Got: {result.actual}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Suggestions */}
              {analysis.suggestions && analysis.suggestions.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                    <Lightbulb className="h-4 w-4 text-warning" />
                    Suggestions
                  </h4>
                  <ul className="space-y-2">
                    {analysis.suggestions.map((suggestion, i) => (
                      <li
                        key={i}
                        className="text-sm text-muted-foreground bg-warning/5 p-2 rounded-lg"
                      >
                        {suggestion}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Explanation */}
              {analysis.explanation && (
                <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                  <p className="text-sm">{analysis.explanation}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
              <Terminal className="h-12 w-12 text-muted-foreground" />
              <div>
                <p className="font-medium">No results yet</p>
                <p className="text-sm text-muted-foreground">
                  Write your code and click "Run & Analyze"
                </p>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
