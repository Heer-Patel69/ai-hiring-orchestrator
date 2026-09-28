import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface RoundConfig {
  id: string;
  job_id: string;
  round_number: number;
  round_type: "mcq" | "coding" | "system_design" | "behavioral" | "live_ai_interview";
  duration_minutes: number;
  custom_questions: string[] | null;
  ai_generate_questions: boolean;
  passing_score?: number;
}

export interface JobConfig {
  id: string;
  title: string;
  field: string;
  toughness_level: string;
  num_rounds: number;
  round_config: any;
  custom_questions: string[] | null;
}

export function useJobRoundConfig(applicationId: string | null) {
  return useQuery({
    queryKey: ["job-round-config", applicationId],
    queryFn: async (): Promise<{ job: JobConfig; rounds: RoundConfig[]; currentRound: RoundConfig | null; currentRoundNumber: number }> => {
      if (!applicationId) throw new Error("No application ID");

      // Get application with job info
      const { data: application, error: appError } = await supabase
        .from("applications")
        .select(`
          id,
          job_id,
          current_round,
          job:jobs!inner(
            id,
            title,
            field,
            toughness_level,
            num_rounds,
            round_config,
            custom_questions
          )
        `)
        .eq("id", applicationId)
        .single();

      if (appError || !application) {
        throw new Error("Failed to fetch application");
      }

      const job = application.job as unknown as JobConfig;
      const currentRoundNumber = application.current_round || 1;

      // Get job rounds configuration
      const { data: rounds, error: roundsError } = await supabase
        .from("job_rounds")
        .select("*")
        .eq("job_id", application.job_id)
        .order("round_number");

      if (roundsError) {
        console.error("Error fetching rounds:", roundsError);
      }

      const roundsData = (rounds || []) as RoundConfig[];
      const currentRound = roundsData.find(r => r.round_number === currentRoundNumber) || null;

      return {
        job,
        rounds: roundsData,
        currentRound,
        currentRoundNumber,
      };
    },
    enabled: !!applicationId,
    staleTime: 30000,
  });
}

export function useNextRound(applicationId: string | null, currentRoundNumber: number) {
  return useQuery({
    queryKey: ["next-round", applicationId, currentRoundNumber],
    queryFn: async (): Promise<RoundConfig | null> => {
      if (!applicationId) return null;

      const { data: application } = await supabase
        .from("applications")
        .select("job_id")
        .eq("id", applicationId)
        .single();

      if (!application) return null;

      const { data: nextRound } = await supabase
        .from("job_rounds")
        .select("*")
        .eq("job_id", application.job_id)
        .eq("round_number", currentRoundNumber + 1)
        .maybeSingle();

      return nextRound as RoundConfig | null;
    },
    enabled: !!applicationId,
  });
}
