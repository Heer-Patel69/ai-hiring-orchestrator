import { useState, useCallback, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { GlassCard } from "@/components/ui/glass-card";
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
  CheckCircle2,
  XCircle,
  ArrowRight,
  ArrowLeft,
  Flag,
  AlertTriangle,
  Brain,
  Loader2,
  BookOpen,
  Shield,
  Maximize2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { useJobRoundConfig, useNextRound } from "@/hooks/useJobRoundConfig";
import { AssessmentComplete } from "@/components/assessment/AssessmentComplete";
import { useAntiCheat } from "@/hooks/useAntiCheat";
import { AntiCheatOverlay, AntiCheatStatusBadge } from "@/components/proctoring";
import { submitRoundResult } from "@/lib/round-submission";

interface MCQQuestion {
  id: string;
  question: string;
  options: string[];
  type: "single" | "multiple";
  difficulty: "easy" | "medium" | "hard" | "expert";
  topic: string;
  points: number;
  timeLimit: number;
}

interface Answer {
  questionId: string;
  selectedOptions: number[];
  timeTaken: number;
  flagged: boolean;
}

type AssessmentStatus = "loading" | "ready" | "in-progress" | "submitting" | "completed";

export default function MCQAssessmentPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { toast } = useToast();

  const applicationId = searchParams.get("application");
  
  // Fetch job configuration to get correct number of questions
  const { data: jobConfig, isLoading: configLoading } = useJobRoundConfig(applicationId);
  const currentRoundNumber = jobConfig?.currentRoundNumber || 1;
  const { data: nextRound } = useNextRound(applicationId, currentRoundNumber);

  // Assessment state
  const [status, setStatus] = useState<AssessmentStatus>("loading");
  const [questions, setQuestions] = useState<MCQQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Map<string, Answer>>(new Map());
  const [selectedOptions, setSelectedOptions] = useState<number[]>([]);

  // Timer state - use configured duration or default
  const configuredTime = (jobConfig?.currentRound?.duration_minutes || 45) * 60;
  const [totalTimeRemaining, setTotalTimeRemaining] = useState(configuredTime);
  const [questionTimeRemaining, setQuestionTimeRemaining] = useState(60);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Anti-cheat system
  const antiCheat = useAntiCheat({
    enforceFullscreen: true,
    maxTabSwitches: 3,
    maxFocusLoss: 5,
    blockCopyPaste: true,
    blockRightClick: true,
    blockDevTools: true,
    blockScreenshot: true,
    autoTerminateOnViolation: false,
    onEvent: (event) => {
      console.log("Anti-cheat event:", event);
    },
  });

  // Dialog state
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [showTimeUpDialog, setShowTimeUpDialog] = useState(false);

  // Results
  const [results, setResults] = useState<{
    score: number;
    correct: number;
    wrong: number;
    skipped: number;
    topicBreakdown: Record<string, { correct: number; total: number }>;
  } | null>(null);

  const currentQuestion = questions[currentIndex];

  // Load questions when config is available
  useEffect(() => {
    if (jobConfig && !configLoading) {
      loadQuestions();
    }
  }, [jobConfig, configLoading]);

  // Timer effect
  useEffect(() => {
    if (status !== "in-progress") return;

    timerRef.current = setInterval(() => {
      setTotalTimeRemaining((prev) => {
        if (prev <= 1) {
          handleTimeUp();
          return 0;
        }
        return prev - 1;
      });

      setQuestionTimeRemaining((prev) => {
        if (prev <= 1) {
          handleNext();
          return currentQuestion?.timeLimit || 60;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status, currentIndex]);

  // Start anti-cheat when assessment begins
  useEffect(() => {
    if (status === "in-progress" && !antiCheat.isActive) {
      antiCheat.startMonitoring();
    } else if (status !== "in-progress" && antiCheat.isActive) {
      antiCheat.stopMonitoring();
    }
  }, [status]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (antiCheat.isActive) {
        antiCheat.stopMonitoring();
      }
    };
  }, []);

  const loadQuestions = async () => {
    try {
      const currentRound = jobConfig?.currentRound;
      const job = jobConfig?.job;
      
      // Get configured number of questions from round_config
      let numQuestions = 25; // Default
      if (job?.round_config && typeof job.round_config === "object") {
        const rc = job.round_config as any;
        if (rc.mcq?.num_questions) {
          numQuestions = rc.mcq.num_questions;
        }
      }
      
      // Check if custom questions exist and AI generation is disabled
      const hasCustomQuestions = currentRound?.custom_questions && 
        Array.isArray(currentRound.custom_questions) && 
        currentRound.custom_questions.length > 0;
      const useAI = currentRound?.ai_generate_questions !== false;

      if (hasCustomQuestions && !useAI) {
        // Use company's custom questions - limit to configured count
        const customQuestions = (currentRound.custom_questions as any[]).slice(0, numQuestions);
        const formattedQuestions: MCQQuestion[] = customQuestions.map((q, i) => ({
          id: `custom-${i}`,
          question: q.question || q,
          options: q.options || ["Option A", "Option B", "Option C", "Option D"],
          type: "single",
          difficulty: q.difficulty || "medium",
          topic: q.topic || job?.field || "General",
          points: 1,
          timeLimit: 60,
        }));
        setQuestions(formattedQuestions);
        setQuestionTimeRemaining(60);
        setStatus("ready");
        return;
      }

      // Generate questions via AI - pass configured count
      console.log(`[MCQ] Loading ${numQuestions} questions for assessment`);
      const { data, error } = await supabase.functions.invoke("generate-mcq-questions", {
        body: {
          applicationId,
          field: job?.field || "Data Structures and Algorithms",
          toughnessLevel: getToughnessNumber(job?.toughness_level || "medium"),
          numQuestions, // Use configured count
        },
      });

      if (error || !data?.questions) {
        // Use sample questions if AI fails - respect configured count
        const sampleQuestions = generateSampleQuestions(numQuestions, job?.field || "DSA");
        setQuestions(sampleQuestions);
      } else {
        // Limit AI-generated questions to configured count
        const limitedQuestions = data.questions.slice(0, numQuestions);
        setQuestions(limitedQuestions);
      }

      setQuestionTimeRemaining(60);
      setStatus("ready");
    } catch (error) {
      console.error("Error loading questions:", error);
      // Get configured count from job config
      let numQuestions = 10; // Fallback
      if (jobConfig?.job?.round_config) {
        const rc = jobConfig.job.round_config as any;
        if (rc.mcq?.num_questions) {
          numQuestions = rc.mcq.num_questions;
        }
      }
      const sampleQuestions = generateSampleQuestions(numQuestions, "DSA");
      setQuestions(sampleQuestions);
      setStatus("ready");
    }
  };

  const getToughnessNumber = (level: string): number => {
    const map: Record<string, number> = { easy: 1, medium: 2, hard: 3, expert: 4 };
    return map[level] || 2;
  };

  const generateSampleQuestions = (count: number, field: string): MCQQuestion[] => {
    const topics = ["Arrays", "Linked Lists", "Trees", "Graphs", "Dynamic Programming", "Sorting", "Searching"];
    const difficulties: MCQQuestion["difficulty"][] = ["easy", "medium", "hard", "expert"];

    return Array.from({ length: count }, (_, i) => {
      const sampleData = getSampleQuestionData(i);
      return {
        id: `q-${i + 1}`,
        question: sampleData.question,
        options: sampleData.options,
        type: i % 5 === 0 ? "multiple" as const : "single" as const,
        difficulty: difficulties[Math.min(Math.floor(i / (count / 4)), 3)],
        topic: topics[i % topics.length],
        points: Math.floor(i / (count / 4)) + 1,
        timeLimit: 60 + (Math.floor(i / (count / 4)) * 15),
        // Include correct answer for evaluation
        correctAnswer: sampleData.correctAnswer,
        correctAnswers: i % 5 === 0 ? sampleData.correctAnswers : [sampleData.correctAnswer],
      } as MCQQuestion & { correctAnswer: number; correctAnswers: number[] };
    });
  };

  // Sample questions with correct answers
  const getSampleQuestionData = (index: number): { 
    question: string; 
    options: string[]; 
    correctAnswer: number;
    correctAnswers: number[];
  } => {
    const questionData = [
      {
        question: "What is the time complexity of binary search?",
        options: ["O(1)", "O(log n)", "O(n)", "O(n log n)"],
        correctAnswer: 1, // O(log n)
        correctAnswers: [1],
      },
      {
        question: "Which data structure uses LIFO principle?",
        options: ["Queue", "Stack", "Heap", "Tree"],
        correctAnswer: 1, // Stack
        correctAnswers: [1],
      },
      {
        question: "What is the space complexity of merge sort?",
        options: ["O(1)", "O(n)", "O(log n)", "O(n²)"],
        correctAnswer: 1, // O(n)
        correctAnswers: [1],
      },
      {
        question: "In a binary search tree, where is the minimum element located?",
        options: ["Root node", "Leftmost node", "Rightmost node", "Any leaf node"],
        correctAnswer: 1, // Leftmost node
        correctAnswers: [1],
      },
      {
        question: "What is the best case time complexity of quicksort?",
        options: ["O(n)", "O(n log n)", "O(n²)", "O(log n)"],
        correctAnswer: 1, // O(n log n)
        correctAnswers: [1],
      },
      {
        question: "Which traversal visits the root node first?",
        options: ["Preorder", "Inorder", "Postorder", "Level order"],
        correctAnswer: 0, // Preorder
        correctAnswers: [0, 3], // Preorder and Level order both visit root first - for multiple choice
      },
      {
        question: "What is the height of a complete binary tree with n nodes?",
        options: ["O(n)", "O(log n)", "O(n log n)", "O(1)"],
        correctAnswer: 1, // O(log n)
        correctAnswers: [1],
      },
      {
        question: "Which algorithm is used to detect a cycle in a linked list?",
        options: ["Floyd's algorithm", "Dijkstra's algorithm", "Kruskal's algorithm", "Prim's algorithm"],
        correctAnswer: 0, // Floyd's algorithm
        correctAnswers: [0],
      },
      {
        question: "What is the time complexity of inserting an element at the beginning of an array?",
        options: ["O(1)", "O(n)", "O(log n)", "O(n²)"],
        correctAnswer: 1, // O(n)
        correctAnswers: [1],
      },
      {
        question: "Which data structure is used for BFS traversal?",
        options: ["Stack", "Queue", "Priority Queue", "Deque"],
        correctAnswer: 1, // Queue
        correctAnswers: [1],
      },
    ];
    return questionData[index % questionData.length];
  };

  const startAssessment = () => {
    setStatus("in-progress");
    setTotalTimeRemaining(configuredTime);
    setQuestionTimeRemaining(questions[0]?.timeLimit || 60);
  };

  const handleOptionSelect = (optionIndex: number) => {
    if (!currentQuestion) return;

    if (currentQuestion.type === "single") {
      setSelectedOptions([optionIndex]);
    } else {
      setSelectedOptions((prev) =>
        prev.includes(optionIndex)
          ? prev.filter((i) => i !== optionIndex)
          : [...prev, optionIndex]
      );
    }
  };

  const saveAnswer = () => {
    if (!currentQuestion) return;

    const answer: Answer = {
      questionId: currentQuestion.id,
      selectedOptions,
      timeTaken: currentQuestion.timeLimit - questionTimeRemaining,
      flagged: answers.get(currentQuestion.id)?.flagged || false,
    };

    setAnswers((prev) => new Map(prev).set(currentQuestion.id, answer));
  };

  const handleNext = () => {
    saveAnswer();
    if (currentIndex < questions.length - 1) {
      setCurrentIndex((prev) => prev + 1);
      const nextQuestion = questions[currentIndex + 1];
      setQuestionTimeRemaining(nextQuestion?.timeLimit || 60);
      setSelectedOptions(answers.get(nextQuestion?.id || "")?.selectedOptions || []);
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      saveAnswer();
      setCurrentIndex((prev) => prev - 1);
      const prevQuestion = questions[currentIndex - 1];
      setSelectedOptions(answers.get(prevQuestion?.id || "")?.selectedOptions || []);
    }
  };

  const handleFlag = () => {
    if (!currentQuestion) return;
    const current = answers.get(currentQuestion.id);
    setAnswers((prev) =>
      new Map(prev).set(currentQuestion.id, {
        ...current,
        questionId: currentQuestion.id,
        selectedOptions: current?.selectedOptions || [],
        timeTaken: current?.timeTaken || 0,
        flagged: !current?.flagged,
      })
    );
  };

  const handleTimeUp = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setShowTimeUpDialog(true);
    submitAssessment();
  };

  const submitAssessment = async () => {
    saveAnswer();
    setStatus("submitting");

    try {
      // Build response data with actual answers
      const responseData = questions.map((q, qIndex) => {
        const answer = answers.get(q.id);
        const questionAny = q as any;
        
        // Get correct answer(s) - handle various storage formats
        let correctAnswers: number[] = [];
        if (questionAny.correctAnswers && Array.isArray(questionAny.correctAnswers)) {
          correctAnswers = questionAny.correctAnswers;
        } else if (questionAny.correctAnswer !== undefined) {
          correctAnswers = [questionAny.correctAnswer];
        } else if (questionAny.correct_answer !== undefined) {
          correctAnswers = [questionAny.correct_answer];
        } else if (questionAny.correct_option !== undefined) {
          correctAnswers = [questionAny.correct_option];
        } else {
          // Default fallback - for sample questions, option B (index 1) is typically correct
          correctAnswers = [1];
        }
        
        const selectedOptions = answer?.selectedOptions || [];
        
        // More robust correctness check:
        // - For single choice: the selected option must be in correctAnswers
        // - For multiple choice: all correct answers must be selected and no incorrect ones
        let isCorrect = false;
        if (selectedOptions.length > 0) {
          if (q.type === "multiple") {
            // For multiple choice, check exact match
            const sortedSelected = [...selectedOptions].sort();
            const sortedCorrect = [...correctAnswers].sort();
            isCorrect = sortedSelected.length === sortedCorrect.length &&
              sortedSelected.every((opt, idx) => opt === sortedCorrect[idx]);
          } else {
            // For single choice, any selected option that's in correct answers counts
            isCorrect = selectedOptions.some(opt => correctAnswers.includes(opt));
          }
        }
        
        console.log(`[MCQ] Q${qIndex + 1}: selected=${JSON.stringify(selectedOptions)}, correct=${JSON.stringify(correctAnswers)}, isCorrect=${isCorrect}`);
        
        return {
          questionId: q.id,
          question: q.question,
          selectedOptions,
          correctAnswers,
          isCorrect,
          topic: q.topic,
          difficulty: q.difficulty,
          timeTaken: answer?.timeTaken || 0,
        };
      });

      // Calculate scores
      let correct = 0;
      let wrong = 0;
      let skipped = 0;
      const topicBreakdown: Record<string, { correct: number; total: number }> = {};

      responseData.forEach((r) => {
        if (!topicBreakdown[r.topic]) {
          topicBreakdown[r.topic] = { correct: 0, total: 0 };
        }
        topicBreakdown[r.topic].total++;

        if (r.selectedOptions.length === 0) {
          skipped++;
        } else if (r.isCorrect) {
          correct++;
          topicBreakdown[r.topic].correct++;
        } else {
          wrong++;
        }
      });

      const score = Math.round((correct / questions.length) * 100);
      const passingScore = jobConfig?.job?.round_config?.mcq?.passing_score || 60;
      const passed = score >= passingScore;
      
      console.log(`[MCQ] Final: ${correct}/${questions.length} correct, score=${score}%, passing=${passingScore}%, passed=${passed}`);

      // Save results to database
      if (applicationId) {
        // Build question-level scores for database persistence
        const questionScoresData = responseData.map((r, idx) => ({
          questionNumber: idx + 1,
          questionText: r.question,
          candidateAnswer: (r.selectedOptions || []).map((optIdx) => questions[idx]?.options[optIdx] || optIdx).join(", "),
          score: r.isCorrect ? 10 : 0,
          feedback: r.isCorrect ? "Correct answer selected." : "Incorrect selection.",
          timeTakenSeconds: r.timeTaken,
        }));

        // Authoritatively persist round result, round scores, question scores, and update current_round!
        try {
          await submitRoundResult({
            applicationId,
            roundNumber: currentRoundNumber,
            score,
            passingScore,
            feedback: passed
              ? `Candidate scored ${score}% (passing: ${passingScore}%). Strong performance in screening.`
              : `Score ${score}% below passing threshold of ${passingScore}%.`,
            strengths: Object.entries(topicBreakdown)
              .filter(([_, d]) => d.correct === d.total && d.total > 0)
              .map(([topic]) => `Mastery in ${topic}`),
            weaknesses: Object.entries(topicBreakdown)
              .filter(([_, d]) => d.correct < d.total)
              .map(([topic]) => `Review ${topic}`),
            detailedScores: {
              technical: score,
              accuracy: score,
            },
            questionScores: questionScoresData,
            proctoringEventsCount: antiCheat.tabSwitchCount,
          });
        } catch (subErr) {
          console.error("Failed to submit round result via submitRoundResult:", subErr);
        }

        // Store agent result for legacy tracking
        try {
          await supabase.from("agent_results").insert({
            application_id: applicationId,
            agent_number: 2,
            agent_name: "Quizmaster",
            score,
            detailed_scores: Object.fromEntries(
              Object.entries(topicBreakdown).map(([topic, data]) => [
                topic,
                Math.round((data.correct / data.total) * 100),
              ])
            ),
            decision: passed ? "pass" : "reject",
            reasoning: passed
              ? `Candidate scored ${score}% (passing: ${passingScore}%). Strong performance.`
              : `Score ${score}% below passing threshold of ${passingScore}%.`,
            raw_data: {
              total_questions: questions.length,
              correct,
              wrong,
              skipped,
              topic_breakdown: topicBreakdown,
              tab_switches: antiCheat.tabSwitchCount,
              trust_score: antiCheat.trustScore,
            },
          });
        } catch (e) {
          console.error("Error saving agent result:", e);
        }

        // Record fraud flags if present
        if (antiCheat.tabSwitchCount > 2) {
          try {
            await supabase.from("fraud_logs").insert({
              application_id: applicationId,
              agent_number: 2,
              flag_type: "tab_switches",
              severity: antiCheat.tabSwitchCount > 5 ? "high" : "medium",
              evidence: { 
                tab_switches: antiCheat.tabSwitchCount,
                trust_score: antiCheat.trustScore,
              },
            });
          } catch (e) {
            console.error("Error saving fraud log:", e);
          }
        }
      }

      setResults({ score, correct, wrong, skipped, topicBreakdown });
      setStatus("completed");
    } catch (error) {
      console.error("Error submitting assessment:", error);
      toast({
        title: "Error",
        description: "Failed to submit assessment. Please try again.",
        variant: "destructive",
      });
      setStatus("in-progress");
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Loading screen
  if (status === "loading" || configLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-12 w-12 text-primary animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading assessment...</p>
        </div>
      </div>
    );
  }

  // Ready screen
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
              <BookOpen className="h-10 w-10 text-primary" />
            </div>
            <h1 className="text-2xl font-bold mb-2">MCQ Assessment</h1>
            <p className="text-muted-foreground mb-6">
              Answer {questions.length} multiple-choice questions to test your knowledge.
            </p>

            <div className="space-y-4 mb-6 text-left">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/50">
                <Clock className="h-5 w-5 text-primary" />
                <div>
                  <p className="font-medium">Time Limit: {Math.floor(configuredTime / 60)} minutes</p>
                  <p className="text-sm text-muted-foreground">Each question has its own time limit</p>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/50">
                <Brain className="h-5 w-5 text-primary" />
                <div>
                  <p className="font-medium">Adaptive Difficulty</p>
                  <p className="text-sm text-muted-foreground">Questions get harder as you progress</p>
                </div>
              </div>
            </div>

            <div className="p-4 rounded-lg bg-warning/10 border border-warning/30 mb-6 text-left">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 text-warning mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-warning">Important</p>
                  <ul className="text-sm text-muted-foreground mt-1 space-y-1">
                    <li>• No back navigation after answering</li>
                    <li>• Tab switches are monitored</li>
                    <li>• Negative marking: -0.25 for wrong answers</li>
                  </ul>
                </div>
              </div>
            </div>

            <Button onClick={startAssessment} variant="hero" className="w-full" size="lg">
              Start Assessment
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </GlassCard>
        </motion.div>
      </div>
    );
  }

  // Get next round info - after passing, advance to next round number
  const actualNextRoundNumber = results?.score && results.score >= (jobConfig?.job?.round_config?.mcq?.passing_score || 60) 
    ? currentRoundNumber + 1 
    : currentRoundNumber;
  
  // Find next round from job rounds
  const nextRoundFromConfig = jobConfig?.rounds?.find(r => r.round_number === actualNextRoundNumber);
  
  // Completed screen - use new component
  if (status === "completed" && results) {
    const configuredPassingScore = jobConfig?.job?.round_config?.mcq?.passing_score || 60;
    const hasNextRound = results.score >= configuredPassingScore && nextRoundFromConfig;
    
    return (
      <AssessmentComplete
        results={results}
        applicationId={applicationId}
        nextRound={hasNextRound ? {
          round_number: nextRoundFromConfig.round_number,
          round_type: nextRoundFromConfig.round_type,
          duration_minutes: nextRoundFromConfig.duration_minutes,
        } : null}
        roundType="mcq"
        passingScore={configuredPassingScore}
      />
    );
  }

  // In-progress view
  return (
    <div className="min-h-screen bg-background">
      {/* Anti-cheat fullscreen overlay */}
      <AntiCheatOverlay
        state={antiCheat}
        onRequestFullscreen={antiCheat.requestFullscreen}
        showDetailedStatus={false}
      />

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="container flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-4">
            <Badge variant="outline">
              Q{currentIndex + 1} of {questions.length}
            </Badge>
            <Badge className={cn(
              currentQuestion?.difficulty === "easy" && "bg-success text-success-foreground",
              currentQuestion?.difficulty === "medium" && "bg-warning text-warning-foreground",
              currentQuestion?.difficulty === "hard" && "bg-orange-500 text-white",
              currentQuestion?.difficulty === "expert" && "bg-danger text-danger-foreground"
            )}>
              {currentQuestion?.difficulty}
            </Badge>
            <Badge variant="secondary">{currentQuestion?.topic}</Badge>
          </div>

          <div className="flex items-center gap-4">
            {/* Anti-cheat status badge */}
            <AntiCheatStatusBadge 
              trustScore={antiCheat.trustScore} 
              isActive={antiCheat.isActive} 
            />
            <Badge
              variant={questionTimeRemaining < 15 ? "destructive" : "secondary"}
              className="tabular-nums"
            >
              <Clock className="h-3 w-3 mr-1" />
              {formatTime(questionTimeRemaining)}
            </Badge>
            <Badge
              variant={totalTimeRemaining < 300 ? "destructive" : "outline"}
              className="tabular-nums"
            >
              Total: {formatTime(totalTimeRemaining)}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSubmitDialog(true)}
            >
              Submit
            </Button>
          </div>
        </div>
      </header>

      {/* Progress bar */}
      <Progress
        value={(currentIndex / questions.length) * 100}
        className="h-1 rounded-none"
      />

      {/* Question content */}
      <main className="container max-w-3xl py-8 px-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentIndex}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
          >
            <GlassCard>
              <div className="flex items-start justify-between mb-6">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <span className="text-sm font-bold text-primary">{currentIndex + 1}</span>
                  </div>
                  <Badge variant="outline">{currentQuestion?.points} point{currentQuestion?.points !== 1 ? "s" : ""}</Badge>
                </div>
                <Button
                  variant={answers.get(currentQuestion?.id || "")?.flagged ? "default" : "outline"}
                  size="sm"
                  onClick={handleFlag}
                >
                  <Flag className="h-4 w-4 mr-1" />
                  Flag
                </Button>
              </div>

              <h2 className="text-xl font-semibold mb-6">{currentQuestion?.question}</h2>

              {currentQuestion?.type === "single" ? (
                <RadioGroup
                  value={selectedOptions[0]?.toString()}
                  onValueChange={(v) => handleOptionSelect(parseInt(v))}
                  className="space-y-3"
                >
                  {currentQuestion?.options.map((option, i) => (
                    <Label
                      key={i}
                      className={cn(
                        "flex items-center gap-3 p-4 rounded-lg border cursor-pointer transition-all",
                        selectedOptions.includes(i)
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/50"
                      )}
                    >
                      <RadioGroupItem value={i.toString()} />
                      <span>{option}</span>
                    </Label>
                  ))}
                </RadioGroup>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground mb-4">Select all that apply:</p>
                  {currentQuestion?.options.map((option, i) => (
                    <Label
                      key={i}
                      className={cn(
                        "flex items-center gap-3 p-4 rounded-lg border cursor-pointer transition-all",
                        selectedOptions.includes(i)
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/50"
                      )}
                    >
                      <Checkbox
                        checked={selectedOptions.includes(i)}
                        onCheckedChange={() => handleOptionSelect(i)}
                      />
                      <span>{option}</span>
                    </Label>
                  ))}
                </div>
              )}

              {/* Navigation */}
              <div className="flex items-center justify-between mt-8 pt-6 border-t border-border">
                <Button
                  variant="outline"
                  onClick={handlePrevious}
                  disabled={currentIndex === 0}
                >
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Previous
                </Button>

                {currentIndex < questions.length - 1 ? (
                  <Button onClick={handleNext}>
                    Next
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                ) : (
                  <Button onClick={() => setShowSubmitDialog(true)}>
                    Submit Assessment
                    <CheckCircle2 className="h-4 w-4 ml-2" />
                  </Button>
                )}
              </div>
            </GlassCard>
          </motion.div>
        </AnimatePresence>

        {/* Question navigator */}
        <div className="mt-6">
          <GlassCard>
            <h3 className="text-sm font-medium mb-3">Question Navigator</h3>
            <div className="flex flex-wrap gap-2">
              {questions.map((q, i) => {
                const answer = answers.get(q.id);
                return (
                  <button
                    key={q.id}
                    onClick={() => {
                      saveAnswer();
                      setCurrentIndex(i);
                      setSelectedOptions(answers.get(q.id)?.selectedOptions || []);
                    }}
                    className={cn(
                      "h-8 w-8 rounded text-sm font-medium transition-all",
                      i === currentIndex && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                      answer?.selectedOptions.length
                        ? "bg-success text-success-foreground"
                        : "bg-secondary hover:bg-secondary/80",
                      answer?.flagged && "ring-2 ring-warning"
                    )}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
          </GlassCard>
        </div>
      </main>

      {/* Submit confirmation dialog */}
      <AlertDialog open={showSubmitDialog} onOpenChange={setShowSubmitDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Submit Assessment?</AlertDialogTitle>
            <AlertDialogDescription>
              You have answered {answers.size} of {questions.length} questions.
              {answers.size < questions.length && (
                <span className="text-warning"> {questions.length - answers.size} questions are unanswered.</span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continue</AlertDialogCancel>
            <AlertDialogAction onClick={submitAssessment}>Submit</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Time up dialog */}
      <AlertDialog open={showTimeUpDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Time's Up!</AlertDialogTitle>
            <AlertDialogDescription>
              Your time has ended. Your answers have been automatically submitted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setShowTimeUpDialog(false)}>
              View Results
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
