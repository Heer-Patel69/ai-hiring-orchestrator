import { useState, useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Video,
  Mic,
  Wifi,
  Sun,
  Volume2,
  CheckCircle,
  XCircle,
  AlertCircle,
  PlayCircle,
  Loader2,
  RefreshCw,
  Briefcase,
  Clock,
  ArrowRight,
  Camera,
  CameraOff,
  MicOff,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface PendingInterview {
  application_id: string;
  job_title: string;
  job_field: string;
  round_number: number;
  round_type: string;
  duration_minutes: number;
}

interface SystemCheck {
  id: string;
  label: string;
  icon: any;
  status: "pending" | "checking" | "passed" | "failed";
  errorMessage?: string;
}

export default function InterviewRoomPage() {
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);

  const [pendingInterviews, setPendingInterviews] = useState<PendingInterview[]>([]);
  const [selectedInterview, setSelectedInterview] = useState<PendingInterview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCheckingSystem, setIsCheckingSystem] = useState(false);
  const [allChecksPassed, setAllChecksPassed] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const [systemChecks, setSystemChecks] = useState<SystemCheck[]>([
    { id: "camera", label: "Camera", icon: Video, status: "pending" },
    { id: "microphone", label: "Microphone", icon: Mic, status: "pending" },
    { id: "internet", label: "Internet Connection", icon: Wifi, status: "pending" },
    { id: "lighting", label: "Lighting", icon: Sun, status: "pending" },
  ]);

  useEffect(() => {
    // Wait for auth to finish loading before fetching interviews
    if (authLoading) return;
    
    if (user) {
      fetchPendingInterviews();
    } else {
      setIsLoading(false);
    }

    return () => {
      // Cleanup stream on unmount
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [user, authLoading]);

  // Ensure video element always binds to stream
  useEffect(() => {
    if (videoRef.current && stream) {
      if (videoRef.current.srcObject !== stream) {
        videoRef.current.srcObject = stream;
      }
      videoRef.current.play().catch(() => {});
    }
  }, [stream]);

  const fetchPendingInterviews = async () => {
    try {
      console.log("Fetching pending interviews for user:", user!.id);
      
      // Fetch applications that are not rejected/completed - candidates can proceed with interviews
      const { data: applications, error } = await supabase
        .from("applications")
        .select(`
          id,
          current_round,
          status,
          job_id,
          jobs!inner(
            id,
            title,
            field,
            num_rounds
          )
        `)
        .eq("candidate_id", user!.id)
        .in("status", ["applied", "screening", "interviewing"]);

      if (error) {
        console.error("Error fetching applications:", error);
        throw error;
      }

      console.log("Applications found:", applications);

      // Get rounds for each application
      const interviews: PendingInterview[] = [];
      
      for (const app of applications || []) {
        const jobData = (app as any).jobs;
        console.log("Processing application:", app.id, "job:", jobData);
        
        if (!jobData) {
          console.log("No job data for application:", app.id);
          continue;
        }

        // Get the next round for this application
        const nextRound = (app.current_round || 0) + 1;
        console.log("Looking for round:", nextRound, "for job:", jobData.id);
        
        const { data: roundData, error: roundError } = await supabase
          .from("job_rounds")
          .select("*")
          .eq("job_id", jobData.id)
          .eq("round_number", nextRound)
          .maybeSingle();

        console.log("Round query result:", roundData, "error:", roundError);

        if (roundData) {
          interviews.push({
            application_id: app.id,
            job_title: jobData.title,
            job_field: jobData.field || "General",
            round_number: nextRound,
            round_type: roundData.round_type,
            duration_minutes: roundData.duration_minutes || 30,
          });
        }
      }

      console.log("Final interviews list:", interviews);
      setPendingInterviews(interviews);
    } catch (error) {
      console.error("Error fetching interviews:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const updateCheckStatus = (
    id: string,
    status: SystemCheck["status"],
    errorMessage?: string
  ) => {
    setSystemChecks((prev) =>
      prev.map((check) =>
        check.id === id ? { ...check, status, errorMessage } : check
      )
    );
  };

  const runSystemChecks = async () => {
    if (!selectedInterview) {
      toast({
        title: "Select an Interview",
        description: "Please select an interview to continue.",
        variant: "destructive",
      });
      return;
    }

    setIsCheckingSystem(true);
    setAllChecksPassed(false);

    // Reset all checks
    setSystemChecks((prev) =>
      prev.map((check) => ({ ...check, status: "pending", errorMessage: undefined }))
    );

    // Check Camera
    updateCheckStatus("camera", "checking");
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      
      setStream(mediaStream);
      
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
      
      updateCheckStatus("camera", "passed");
      updateCheckStatus("microphone", "passed");
    } catch (error) {
      updateCheckStatus("camera", "failed", "Camera access denied");
      updateCheckStatus("microphone", "failed", "Microphone access denied");
      setIsCheckingSystem(false);
      return;
    }

    // Check Internet
    updateCheckStatus("internet", "checking");
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (navigator.onLine) {
      updateCheckStatus("internet", "passed");
    } else {
      updateCheckStatus("internet", "failed", "No internet connection");
      setIsCheckingSystem(false);
      return;
    }

    // Check Lighting (simplified - just mark as passed after camera check)
    updateCheckStatus("lighting", "checking");
    await new Promise((resolve) => setTimeout(resolve, 500));
    updateCheckStatus("lighting", "passed");

    setIsCheckingSystem(false);
    setAllChecksPassed(true);
  };

  const startInterview = () => {
    if (!selectedInterview) return;

    // Stop the preview stream
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    const { round_type, application_id } = selectedInterview;
    
    // Route to appropriate assessment page based on round type
    switch (round_type) {
      case "mcq":
        navigate(`/candidate/assessment/mcq?application=${application_id}`);
        break;
      case "coding":
      case "dsa":
        navigate(`/candidate/assessment/coding?application=${application_id}`);
        break;
      case "behavioral":
        navigate(`/candidate/interview/live?type=behavioral&application=${application_id}`);
        break;
      case "system_design":
        navigate(`/candidate/interview/live?type=system-design&application=${application_id}`);
        break;
      case "technical":
      case "interview":
      default:
        navigate(`/candidate/interview/live?type=technical&application=${application_id}`);
        break;
    }
  };

  const getStatusIcon = (status: SystemCheck["status"]) => {
    switch (status) {
      case "checking":
        return <Loader2 className="h-5 w-5 animate-spin text-warning" />;
      case "passed":
        return <CheckCircle className="h-5 w-5 text-success" />;
      case "failed":
        return <XCircle className="h-5 w-5 text-danger" />;
      default:
        return <AlertCircle className="h-5 w-5 text-muted-foreground" />;
    }
  };

  if (isLoading || authLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-success border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Interview Room</h1>
        <p className="text-muted-foreground">
          Complete the pre-interview checks and start your interview
        </p>
      </div>

      {pendingInterviews.length === 0 ? (
        <GlassCard className="py-12 text-center">
          <PlayCircle className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-semibold">No Pending Interviews</h3>
          <p className="mt-1 text-muted-foreground">
            Apply to jobs and complete previous rounds to unlock new interviews.
          </p>
          <Button className="mt-4 bg-success hover:bg-success/90" asChild>
            <Link to="/candidate/jobs">Browse Jobs</Link>
          </Button>
        </GlassCard>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Interview Selection */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Select Interview</h2>
            {pendingInterviews.map((interview) => (
              <motion.div
                key={interview.application_id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <GlassCard
                  hover
                  className={cn(
                    "cursor-pointer transition-all",
                    selectedInterview?.application_id === interview.application_id &&
                      "ring-2 ring-success"
                  )}
                  onClick={() => setSelectedInterview(interview)}
                >
                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-success/10">
                      <Briefcase className="h-6 w-6 text-success" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold">{interview.job_title}</h3>
                      <p className="text-sm text-muted-foreground">{interview.job_field}</p>
                      <div className="mt-2 flex items-center gap-4 text-sm">
                        <span className="flex items-center gap-1">
                          <PlayCircle className="h-4 w-4" />
                          Round {interview.round_number}
                        </span>
                        <span className="capitalize">
                          {interview.round_type.replace("_", " ")}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-4 w-4" />
                          {interview.duration_minutes} min
                        </span>
                      </div>
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            ))}
          </div>

          {/* System Checks & Preview */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Pre-Interview Checklist</h2>

            {/* Video Preview */}
            <GlassCard>
              <div className="relative aspect-video overflow-hidden rounded-lg bg-secondary">
                {stream ? (
                  <video
                    ref={videoRef}
                    autoPlay
                    muted
                    playsInline
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <div className="text-center">
                      <CameraOff className="mx-auto h-12 w-12 text-muted-foreground" />
                      <p className="mt-2 text-sm text-muted-foreground">
                        Camera preview will appear here
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </GlassCard>

            {/* System Checks */}
            <GlassCard>
              <div className="space-y-3">
                {systemChecks.map((check) => {
                  const CheckIcon = check.icon;
                  return (
                    <div
                      key={check.id}
                      className="flex items-center justify-between rounded-lg bg-secondary/50 p-3"
                    >
                      <div className="flex items-center gap-3">
                        <CheckIcon className="h-5 w-5 text-muted-foreground" />
                        <div>
                          <p className="font-medium">{check.label}</p>
                          {check.errorMessage && (
                            <p className="text-xs text-danger">{check.errorMessage}</p>
                          )}
                        </div>
                      </div>
                      {getStatusIcon(check.status)}
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 flex gap-2">
                <Button
                  variant="outline"
                  onClick={runSystemChecks}
                  disabled={isCheckingSystem || !selectedInterview}
                  className="flex-1"
                >
                  {isCheckingSystem ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Checking...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Run Checks
                    </>
                  )}
                </Button>

                <Button
                  className="flex-1 bg-success hover:bg-success/90"
                  onClick={startInterview}
                  disabled={!allChecksPassed}
                >
                  Start Interview
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </GlassCard>

            {/* Tips */}
            <GlassCard className="bg-success/5 border-success/20">
              <h3 className="font-semibold flex items-center gap-2 mb-2">
                <AlertCircle className="h-5 w-5 text-success" />
                Interview Tips
              </h3>
              <ul className="space-y-1 text-sm text-muted-foreground">
                <li>• Ensure you're in a quiet, well-lit environment</li>
                <li>• Position your camera at eye level</li>
                <li>• Close unnecessary browser tabs and applications</li>
                <li>• Have a glass of water nearby</li>
                <li>• Take a deep breath and stay calm!</li>
              </ul>
            </GlassCard>
          </div>
        </div>
      )}
    </div>
  );
}
