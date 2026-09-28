import { useState, useCallback, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import Editor from "@monaco-editor/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GlassCard } from "@/components/ui/glass-card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Clock,
  Play,
  Send,
  CheckCircle2,
  XCircle,
  Code2,
  FileCode,
  Terminal,
  Lightbulb,
  AlertTriangle,
  Trophy,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { submitRoundResult } from "@/lib/round-submission";
import { useJobRoundConfig, useNextRound } from "@/hooks/useJobRoundConfig";
import { analyzeCode } from "@/lib/code-analyzer";

interface CodingProblem {
  id: string;
  title: string;
  description: string;
  difficulty: "easy" | "medium" | "hard";
  examples: { input: string; output: string; explanation?: string }[];
  constraints: string[];
  hints: string[];
  timeLimit: number; // minutes
}

interface TestCase {
  input: string;
  expected: string;
  actual?: string;
  passed?: boolean;
}

interface Submission {
  problemId: string;
  code: string;
  language: string;
  testResults: TestCase[];
  score: number;
  timeComplexity?: string;
  spaceComplexity?: string;
  timeTaken: number;
}

type ChallengeStatus = "loading" | "ready" | "in-progress" | "submitting" | "completed";

const languages = [
  { value: "python", label: "Python" },
  { value: "javascript", label: "JavaScript" },
  { value: "java", label: "Java" },
  { value: "cpp", label: "C++" },
];

const defaultCode: Record<string, string> = {
  python: `def solution(nums):
    # Write your solution here
    pass
`,
  javascript: `function solution(nums) {
    // Write your solution here
}
`,
  java: `class Solution {
    public int solution(int[] nums) {
        // Write your solution here
        return 0;
    }
}
`,
  cpp: `class Solution {
public:
    int solution(vector<int>& nums) {
        // Write your solution here
        return 0;
    }
};
`,
};

const TOTAL_TIME = 90 * 60; // 90 minutes

export default function CodingChallengePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();

  const applicationId = searchParams.get("application");
  const { data: jobConfig } = useJobRoundConfig(applicationId);
  const currentRoundNumber = jobConfig?.currentRoundNumber || 2;
  const { data: nextRound } = useNextRound(applicationId, currentRoundNumber);
  const [isAdvancing, setIsAdvancing] = useState(false);

  // Challenge state
  const [status, setStatus] = useState<ChallengeStatus>("loading");
  const [problems, setProblems] = useState<CodingProblem[]>([]);
  const [currentProblemIndex, setCurrentProblemIndex] = useState(0);
  const [language, setLanguage] = useState("python");
  const [codes, setCodes] = useState<Record<string, Record<string, string>>>({});
  const [submissions, setSubmissions] = useState<Map<string, Submission>>(new Map());

  // Running state
  const [isRunning, setIsRunning] = useState(false);
  const [testResults, setTestResults] = useState<TestCase[]>([]);
  const [compilerError, setCompilerError] = useState<string | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("problem");

  // Timer
  const [timeRemaining, setTimeRemaining] = useState(TOTAL_TIME);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<Record<string, number>>({});

  // Dialogs
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [showHint, setShowHint] = useState(false);

  // Results
  const [results, setResults] = useState<{
    totalScore: number;
    problemScores: { problem: CodingProblem; submission: Submission }[];
  } | null>(null);

  const currentProblem = problems[currentProblemIndex];
  const currentCode = codes[currentProblem?.id]?.[language] || defaultCode[language];

  const getStorageKey = (problemId: string, lang: string) =>
    `hireminds_code_${applicationId || "local"}_${problemId}_${lang}`;

  useEffect(() => {
    loadProblems();
  }, []);

  useEffect(() => {
    if (status !== "in-progress") return;

    timerRef.current = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          handleTimeUp();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status]);

  const loadProblems = async () => {
    // Generate sample problems
    const sampleProblems: CodingProblem[] = [
      {
        id: "p1",
        title: "Two Sum",
        description: `Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.

You may assume that each input would have exactly one solution, and you may not use the same element twice.

You can return the answer in any order.`,
        difficulty: "easy",
        examples: [
          { input: "nums = [2,7,11,15], target = 9", output: "[0,1]", explanation: "Because nums[0] + nums[1] == 9, we return [0, 1]." },
          { input: "nums = [3,2,4], target = 6", output: "[1,2]" },
        ],
        constraints: [
          "2 <= nums.length <= 10^4",
          "-10^9 <= nums[i] <= 10^9",
          "-10^9 <= target <= 10^9",
          "Only one valid answer exists.",
        ],
        hints: [
          "Think about using a hash map to store values you've seen.",
          "For each number, check if target - number exists in the map.",
        ],
        timeLimit: 30,
      },
      {
        id: "p2",
        title: "Valid Parentheses",
        description: `Given a string s containing just the characters '(', ')', '{', '}', '[' and ']', determine if the input string is valid.

An input string is valid if:
1. Open brackets must be closed by the same type of brackets.
2. Open brackets must be closed in the correct order.
3. Every close bracket has a corresponding open bracket of the same type.`,
        difficulty: "easy",
        examples: [
          { input: 's = "()"', output: "true" },
          { input: 's = "()[]{}"', output: "true" },
          { input: 's = "(]"', output: "false" },
        ],
        constraints: [
          "1 <= s.length <= 10^4",
          "s consists of parentheses only '()[]{}'.",
        ],
        hints: [
          "Use a stack data structure.",
          "When you see an opening bracket, push it. When you see a closing bracket, check if it matches the top of the stack.",
        ],
        timeLimit: 25,
      },
      {
        id: "p3",
        title: "Merge Two Sorted Lists",
        description: `You are given the heads of two sorted linked lists list1 and list2.

Merge the two lists into one sorted list. The list should be made by splicing together the nodes of the first two lists.

Return the head of the merged linked list.`,
        difficulty: "medium",
        examples: [
          { input: "list1 = [1,2,4], list2 = [1,3,4]", output: "[1,1,2,3,4,4]" },
          { input: "list1 = [], list2 = []", output: "[]" },
          { input: "list1 = [], list2 = [0]", output: "[0]" },
        ],
        constraints: [
          "The number of nodes in both lists is in the range [0, 50].",
          "-100 <= Node.val <= 100",
          "Both list1 and list2 are sorted in non-decreasing order.",
        ],
        hints: [
          "Use a dummy head to simplify the code.",
          "Compare nodes from both lists and append the smaller one.",
        ],
        timeLimit: 35,
      },
    ];

    setProblems(sampleProblems);

    // Initialize codes with localStorage autosave recovery
    const initialCodes: Record<string, Record<string, string>> = {};
    sampleProblems.forEach((p) => {
      initialCodes[p.id] = {};
      languages.forEach((langObj) => {
        const saved = localStorage.getItem(getStorageKey(p.id, langObj.value));
        initialCodes[p.id][langObj.value] = saved !== null ? saved : defaultCode[langObj.value];
      });
    });
    setCodes(initialCodes);

    setStatus("ready");
  };

  const startChallenge = () => {
    setStatus("in-progress");
    startTimeRef.current[problems[0]?.id] = Date.now();
  };

  const handleCodeChange = (value: string | undefined) => {
    if (!currentProblem) return;
    const newCode = value || "";
    setCodes((prev) => ({
      ...prev,
      [currentProblem.id]: {
        ...prev[currentProblem.id],
        [language]: newCode,
      },
    }));
    // Autosave to localStorage immediately on keystroke
    localStorage.setItem(getStorageKey(currentProblem.id, language), newCode);
  };

  const runCode = async () => {
    if (!currentProblem) return;
    setIsRunning(true);
    setCompilerError(null);
    setRuntimeError(null);
    setActiveTab("output");

    try {
      const data = await analyzeCode({
        code: currentCode,
        language,
        testCases: currentProblem.examples.map((e) => ({
          input: e.input,
          expectedOutput: e.output,
        })),
      });

      if (data?.compilerError) {
        setCompilerError(data.compilerError);
      }
      if (data?.runtimeError) {
        setRuntimeError(data.runtimeError);
      }

      const results: TestCase[] = data?.testResults?.map((r: any, i: number) => ({
        input: currentProblem.examples[i]?.input || "",
        expected: currentProblem.examples[i]?.output || "",
        actual: r.actual,
        passed: r.passed,
      })) || [];

      setTestResults(results);

      toast({
        title: results.every((r) => r.passed) ? "All tests passed! 🎉" : "Tests analyzed",
        description: `${results.filter((r) => r.passed).length}/${results.length} tests passed`,
      });
    } catch (error) {
      console.error("Run error:", error);
      toast({
        title: "Error running code",
        description: "Please try again",
        variant: "destructive",
      });
    } finally {
      setIsRunning(false);
    }
  };

  const submitProblem = async () => {
    if (!currentProblem) return;
    setIsRunning(true);

    try {
      const data = await analyzeCode({
        code: currentCode,
        language,
      });

      const timeTaken = Math.round((Date.now() - (startTimeRef.current[currentProblem.id] || Date.now())) / 1000);

      const submission: Submission = {
        problemId: currentProblem.id,
        code: currentCode,
        language,
        testResults: testResults,
        score: data.overallScore || 0,
        timeComplexity: data.timeComplexity,
        spaceComplexity: data.spaceComplexity,
        timeTaken,
      };

      setSubmissions((prev) => new Map(prev).set(currentProblem.id, submission));

      toast({
        title: "Problem submitted!",
        description: `Score: ${submission.score}/100`,
      });

      // Move to next problem or finish
      if (currentProblemIndex < problems.length - 1) {
        setCurrentProblemIndex((prev) => prev + 1);
        startTimeRef.current[problems[currentProblemIndex + 1]?.id] = Date.now();
        setTestResults([]);
        setActiveTab("problem");
      }
    } catch (error) {
      console.error("Submit error:", error);
      toast({
        title: "Error submitting",
        description: "Please try again",
        variant: "destructive",
      });
    } finally {
      setIsRunning(false);
    }
  };

  const handleTimeUp = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    void finishChallenge();
  };

  const finishChallenge = async () => {
    setStatus("submitting");

    const problemScores = problems.map((p) => ({
      problem: p,
      submission: submissions.get(p.id) || {
        problemId: p.id,
        code: codes[p.id]?.[language] || "",
        language,
        testResults: [],
        score: 0,
        timeTaken: 0,
      },
    }));

    const totalScore = Math.round(
      problemScores.reduce((acc, ps) => acc + ps.submission.score, 0) / (problems.length || 1)
    );

    const passingScore = jobConfig?.currentRound?.passing_score || 60;
    const passed = totalScore >= passingScore;

    // Persist to database using authoritative submitRoundResult!
    if (applicationId) {
      try {
        const codeSubmissionsList = problemScores.map((ps) => ({
          problem_id: ps.problem.id,
          problem_title: ps.problem.title,
          language: ps.submission.language,
          code: ps.submission.code,
          score: ps.submission.score,
          time_taken_seconds: ps.submission.timeTaken,
        }));

        await submitRoundResult({
          applicationId,
          roundNumber: currentRoundNumber,
          score: totalScore,
          passingScore,
          feedback: passed
            ? `Candidate passed coding challenge with score ${totalScore}%. Algorithmic logic and test suites verified.`
            : `Candidate scored ${totalScore}%, below passing threshold of ${passingScore}%.`,
          strengths: ["Clean code structure", "Handled basic algorithmic cases"],
          weaknesses: passed ? [] : ["Edge case validation", "Algorithmic optimization"],
          detailedScores: {
            technical: totalScore,
            problemSolving: totalScore,
            codeQuality: totalScore,
          },
          codeSubmissions: codeSubmissionsList,
        });
      } catch (err) {
        console.error("Failed to submit coding round result:", err);
      }
    }

    setResults({ totalScore, problemScores });
    setStatus("completed");
  };

  const handleAdvanceToNext = async () => {
    if (!applicationId || !nextRound) return;
    setIsAdvancing(true);
    try {
      const { error } = await supabase
        .from("applications")
        .update({
          current_round: nextRound.round_number,
          status: "interviewing",
        })
        .eq("id", applicationId);

      if (error) throw error;

      const routeMap: Record<string, string> = {
        mcq: "/candidate/assessment/mcq",
        coding: "/candidate/assessment/coding",
        behavioral: "/candidate/interview/live",
        system_design: "/candidate/interview/live",
        live_ai_interview: "/candidate/interview/live",
      };

      const route = routeMap[nextRound.round_type] || "/candidate/interview/live";
      navigate(`${route}?application=${applicationId}`);
    } catch (err) {
      console.error("Error advancing to next round:", err);
    } finally {
      setIsAdvancing(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Loading
  if (status === "loading") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-12 w-12 text-primary animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading coding challenge...</p>
        </div>
      </div>
    );
  }

  // Ready
  if (status === "ready") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-lg w-full"
        >
          <GlassCard className="text-center">
            <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
              <Code2 className="h-10 w-10 text-primary" />
            </div>
            <h1 className="text-2xl font-bold mb-2">Coding Challenge</h1>
            <p className="text-muted-foreground mb-6">
              Solve {problems.length} coding problems to showcase your skills.
            </p>

            <div className="space-y-4 mb-6 text-left">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/50">
                <Clock className="h-5 w-5 text-primary" />
                <div>
                  <p className="font-medium">Time Limit: 90 minutes</p>
                  <p className="text-sm text-muted-foreground">For all {problems.length} problems</p>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/50">
                <FileCode className="h-5 w-5 text-primary" />
                <div>
                  <p className="font-medium">Languages</p>
                  <p className="text-sm text-muted-foreground">Python, JavaScript, Java, C++</p>
                </div>
              </div>
            </div>

            <div className="space-y-2 mb-6">
              <h3 className="font-medium text-left">Problems:</h3>
              {problems.map((p, i) => (
                <div key={p.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
                  <span className="text-sm">{i + 1}. {p.title}</span>
                  <Badge className={cn(
                    p.difficulty === "easy" && "bg-success",
                    p.difficulty === "medium" && "bg-warning",
                    p.difficulty === "hard" && "bg-danger"
                  )}>
                    {p.difficulty}
                  </Badge>
                </div>
              ))}
            </div>

            <Button onClick={startChallenge} variant="hero" className="w-full" size="lg">
              Start Challenge
              <Play className="ml-2 h-5 w-5" />
            </Button>
          </GlassCard>
        </motion.div>
      </div>
    );
  }

  // Completed
  if (status === "completed" && results) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-2xl w-full"
        >
          <GlassCard>
            <div className="text-center mb-8">
              <div className={cn(
                "h-24 w-24 rounded-full flex items-center justify-center mx-auto mb-4",
                results.totalScore >= 55 ? "bg-success/10" : "bg-danger/10"
              )}>
                <Trophy className={cn(
                  "h-12 w-12",
                  results.totalScore >= 55 ? "text-success" : "text-danger"
                )} />
              </div>
              <h1 className="text-2xl font-bold mb-2">Challenge Complete!</h1>
              <p className="text-muted-foreground">Here's your coding performance</p>
            </div>

            <div className={cn(
              "p-6 rounded-xl mb-6",
              results.totalScore >= 55 ? "bg-success/10" : "bg-danger/10"
            )}>
              <div className="flex items-center justify-between mb-4">
                <span className="text-lg font-medium">Overall Score</span>
                <span className={cn(
                  "text-4xl font-bold",
                  results.totalScore >= 55 ? "text-success" : "text-danger"
                )}>
                  {results.totalScore}%
                </span>
              </div>
              <Progress value={results.totalScore} className="h-3" />
            </div>

            <div className="space-y-4 mb-6">
              {results.problemScores.map(({ problem, submission }) => (
                <div key={problem.id} className="p-4 rounded-lg bg-secondary/50">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{problem.title}</span>
                      <Badge className={cn(
                        problem.difficulty === "easy" && "bg-success",
                        problem.difficulty === "medium" && "bg-warning",
                        problem.difficulty === "hard" && "bg-danger"
                      )}>
                        {problem.difficulty}
                      </Badge>
                    </div>
                    <span className={cn(
                      "font-bold",
                      submission.score >= 70 ? "text-success" :
                      submission.score >= 40 ? "text-warning" : "text-danger"
                    )}>
                      {submission.score}/100
                    </span>
                  </div>
                  <div className="flex gap-4 text-sm text-muted-foreground">
                    <span>Language: {submission.language}</span>
                    {submission.timeComplexity && <span>Time: {submission.timeComplexity}</span>}
                    {submission.spaceComplexity && <span>Space: {submission.spaceComplexity}</span>}
                  </div>
                </div>
              ))}
            </div>

            {/* Next Round Button if Passed */}
            {results.totalScore >= (jobConfig?.currentRound?.passing_score || 60) && nextRound && (
              <div className="mb-6 p-4 rounded-xl bg-primary/10 border border-primary/30 text-left">
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center">
                    <Sparkles className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h4 className="font-semibold">Next: {nextRound.round_type.replace(/_/g, " ")}</h4>
                    <p className="text-sm text-muted-foreground">
                      Round {nextRound.round_number} • {nextRound.duration_minutes} minutes
                    </p>
                  </div>
                </div>
                <Button
                  onClick={handleAdvanceToNext}
                  className="w-full bg-primary hover:bg-primary/90"
                  disabled={isAdvancing}
                >
                  {isAdvancing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Loading Next Assessment...
                    </>
                  ) : (
                    <>
                      Proceed to Next Round
                      <ChevronRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
            )}

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => navigate("/candidate/applications")}>
                View Applications
              </Button>
              <Button className="flex-1" onClick={() => navigate("/candidate")}>
                Back to Dashboard
              </Button>
            </div>
          </GlassCard>
        </motion.div>
      </div>
    );
  }

  // In-progress
  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={currentProblemIndex === 0}
              onClick={() => setCurrentProblemIndex((p) => p - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Badge variant="outline">
              Problem {currentProblemIndex + 1} of {problems.length}
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              disabled={currentProblemIndex === problems.length - 1}
              onClick={() => {
                setCurrentProblemIndex((p) => p + 1);
                startTimeRef.current[problems[currentProblemIndex + 1]?.id] = Date.now();
              }}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <Badge className={cn(
            currentProblem?.difficulty === "easy" && "bg-success",
            currentProblem?.difficulty === "medium" && "bg-warning",
            currentProblem?.difficulty === "hard" && "bg-danger"
          )}>
            {currentProblem?.difficulty}
          </Badge>
        </div>

        <div className="flex items-center gap-4">
          <Select value={language} onValueChange={setLanguage}>
            <SelectTrigger className="w-32 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {languages.map((l) => (
                <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Badge
            variant={timeRemaining < 300 ? "destructive" : "secondary"}
            className="tabular-nums"
          >
            <Clock className="h-3 w-3 mr-1" />
            {formatTime(timeRemaining)}
          </Badge>

          <Button variant="outline" size="sm" onClick={() => setShowSubmitDialog(true)}>
            Finish All
          </Button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 grid grid-cols-2 min-h-0">
        {/* Left - Problem */}
        <div className="border-r border-border overflow-hidden flex flex-col">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
            <TabsList className="mx-4 mt-4 w-fit">
              <TabsTrigger value="problem">Problem</TabsTrigger>
              <TabsTrigger value="output">Output</TabsTrigger>
            </TabsList>

            <TabsContent value="problem" className="flex-1 overflow-auto p-4 m-0">
              <h2 className="text-xl font-bold mb-4">{currentProblem?.title}</h2>
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <p className="whitespace-pre-wrap">{currentProblem?.description}</p>

                <h3 className="text-lg font-semibold mt-6 mb-3">Examples</h3>
                {currentProblem?.examples.map((ex, i) => (
                  <div key={i} className="p-4 rounded-lg bg-secondary/50 mb-3">
                    <p className="font-mono text-sm mb-1"><strong>Input:</strong> {ex.input}</p>
                    <p className="font-mono text-sm mb-1"><strong>Output:</strong> {ex.output}</p>
                    {ex.explanation && (
                      <p className="text-sm text-muted-foreground mt-2">{ex.explanation}</p>
                    )}
                  </div>
                ))}

                <h3 className="text-lg font-semibold mt-6 mb-3">Constraints</h3>
                <ul className="list-disc pl-5 space-y-1">
                  {currentProblem?.constraints.map((c, i) => (
                    <li key={i} className="text-sm font-mono">{c}</li>
                  ))}
                </ul>

                {showHint && currentProblem?.hints && (
                  <div className="mt-6 p-4 rounded-lg bg-warning/10 border border-warning/30">
                    <div className="flex items-center gap-2 mb-2">
                      <Lightbulb className="h-4 w-4 text-warning" />
                      <span className="font-medium">Hints</span>
                    </div>
                    <ul className="list-disc pl-5 space-y-1">
                      {currentProblem.hints.map((h, i) => (
                        <li key={i} className="text-sm">{h}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <Button
                variant="ghost"
                size="sm"
                className="mt-4"
                onClick={() => setShowHint(!showHint)}
              >
                <Lightbulb className="h-4 w-4 mr-2" />
                {showHint ? "Hide Hints" : "Show Hints"}
              </Button>
            </TabsContent>

            <TabsContent value="output" className="flex-1 overflow-auto p-4 m-0 space-y-3">
              {compilerError && (
                <div className="p-3.5 rounded-lg bg-danger/10 border border-danger/30 text-danger text-sm">
                  <div className="flex items-center gap-2 font-semibold mb-1">
                    <AlertTriangle className="h-4 w-4" />
                    Compiler Error
                  </div>
                  <pre className="font-mono text-xs whitespace-pre-wrap">{compilerError}</pre>
                </div>
              )}

              {runtimeError && (
                <div className="p-3.5 rounded-lg bg-warning/10 border border-warning/30 text-warning text-sm">
                  <div className="flex items-center gap-2 font-semibold mb-1">
                    <AlertTriangle className="h-4 w-4" />
                    Runtime Error
                  </div>
                  <pre className="font-mono text-xs whitespace-pre-wrap">{runtimeError}</pre>
                </div>
              )}

              {testResults.length > 0 ? (
                <div className="space-y-3">
                  {testResults.map((result, i) => (
                    <div
                      key={i}
                      className={cn(
                        "p-4 rounded-lg border",
                        result.passed ? "bg-success/10 border-success/30" : "bg-danger/10 border-danger/30"
                      )}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        {result.passed ? (
                          <CheckCircle2 className="h-5 w-5 text-success" />
                        ) : (
                          <XCircle className="h-5 w-5 text-danger" />
                        )}
                        <span className="font-medium">Test Case {i + 1}: {result.passed ? "Passed" : "Failed"}</span>
                      </div>
                      <div className="font-mono text-sm space-y-1">
                        <p><strong>Input:</strong> {result.input}</p>
                        <p><strong>Expected:</strong> {result.expected}</p>
                        <p><strong>Received:</strong> {result.actual || "N/A"}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : !compilerError && !runtimeError ? (
                <div className="flex flex-col items-center justify-center h-full text-center py-12">
                  <Terminal className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">Run your code to see output and test results</p>
                </div>
              ) : null}
            </TabsContent>
          </Tabs>
        </div>

        {/* Right - Editor */}
        <div className="flex flex-col overflow-hidden">
          <div className="flex-1 min-h-0">
            <Editor
              height="100%"
              language={language}
              value={currentCode}
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
            />
          </div>

          {/* Action bar */}
          <div className="p-4 border-t border-border flex items-center justify-between bg-card">
            <div className="flex items-center gap-2">
              {submissions.has(currentProblem?.id || "") && (
                <Badge className="bg-success">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Submitted
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={runCode} disabled={isRunning}>
                {isRunning ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 mr-2" />
                )}
                Run
              </Button>
              <Button onClick={submitProblem} disabled={isRunning}>
                {isRunning ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                Submit
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Finish dialog */}
      <AlertDialog open={showSubmitDialog} onOpenChange={setShowSubmitDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Finish Challenge?</AlertDialogTitle>
            <AlertDialogDescription>
              You have submitted {submissions.size} of {problems.length} problems.
              {submissions.size < problems.length && (
                <span className="text-warning"> {problems.length - submissions.size} problems are not submitted.</span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continue Coding</AlertDialogCancel>
            <AlertDialogAction onClick={finishChallenge}>Finish</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
