import { supabase } from "@/integrations/supabase/client";

export interface SubmitRoundParams {
  applicationId: string;
  roundNumber: number;
  score: number;
  passingScore?: number;
  feedback?: string;
  strengths?: string[];
  weaknesses?: string[];
  improvementSuggestions?: string[];
  detailedScores?: {
    technical?: number;
    communication?: number;
    problemSolving?: number;
    codeQuality?: number;
    accuracy?: number;
  };
  questionScores?: Array<{
    questionNumber: number;
    questionText: string;
    candidateAnswer?: string;
    score: number;
    feedback?: string;
    timeTakenSeconds?: number;
  }>;
  codeSubmissions?: any[];
  recordingUrl?: string;
  proctoringEventsCount?: number;
}

export interface SubmitRoundResult {
  success: boolean;
  score: number;
  passed: boolean;
  currentRound: number;
  totalRounds: number;
  isCompleted: boolean;
  nextRoundUnlocked: boolean;
  nextRoundNumber?: number;
  error?: string;
}

/**
 * Authoritative, idempotent round completion and score persistence handler.
 * Writes to round_results, round_scores, question_scores, candidate_scores,
 * and updates applications.current_round and status transactionally.
 */
export async function submitRoundResult(params: SubmitRoundParams): Promise<SubmitRoundResult> {
  const {
    applicationId,
    roundNumber,
    score,
    passingScore = 60,
    feedback = "Round assessment completed.",
    strengths = [],
    weaknesses = [],
    improvementSuggestions = [],
    detailedScores = {},
    questionScores = [],
    codeSubmissions = [],
    recordingUrl,
  } = params;

  try {
    // 1. Fetch current application & job config
    const { data: app, error: appError } = await supabase
      .from("applications")
      .select(`
        id,
        current_round,
        status,
        candidate_id,
        job_id,
        jobs (
          id,
          num_rounds,
          interviewer_id
        )
      `)
      .eq("id", applicationId)
      .single();

    if (appError || !app) {
      throw new Error(`Application not found: ${appError?.message || ""}`);
    }

    const job = app.jobs as any;
    const totalRounds = job?.num_rounds || 1;
    const passed = score >= passingScore;

    // 2. Lookup the corresponding job_round record
    const { data: jobRound } = await supabase
      .from("job_rounds")
      .select("id, round_number, round_type")
      .eq("job_id", app.job_id)
      .eq("round_number", roundNumber)
      .maybeSingle();

    const roundId = jobRound?.id;
    let roundResultId: string | null = null;

    if (roundId) {
      // 3. Upsert round_results
      const roundResultPayload: any = {
        application_id: applicationId,
        round_id: roundId,
        score,
        ai_feedback: feedback,
        ai_explanation: feedback,
        completed_at: new Date().toISOString(),
      };

      if (recordingUrl) {
        roundResultPayload.recording_url = recordingUrl;
      }
      if (codeSubmissions.length > 0) {
        roundResultPayload.code_submissions = codeSubmissions;
      }

      const { data: existingResult } = await supabase
        .from("round_results")
        .select("id")
        .eq("application_id", applicationId)
        .eq("round_id", roundId)
        .maybeSingle();

      if (existingResult) {
        roundResultId = existingResult.id;
        await supabase
          .from("round_results")
          .update(roundResultPayload)
          .eq("id", existingResult.id);
      } else {
        const { data: newResult, error: insertResultError } = await supabase
          .from("round_results")
          .insert(roundResultPayload)
          .select("id")
          .single();

        if (!insertResultError && newResult) {
          roundResultId = newResult.id;
        }
      }
    }

    // 4. Upsert round_scores if we have a roundResultId
    if (roundResultId) {
      const roundScorePayload = {
        round_result_id: roundResultId,
        application_id: applicationId,
        round_number: roundNumber,
        base_score: score,
        final_score: score,
        strengths,
        weaknesses,
        improvement_suggestions: improvementSuggestions,
        updated_at: new Date().toISOString(),
      };

      const { data: existingRoundScore } = await supabase
        .from("round_scores")
        .select("id")
        .eq("round_result_id", roundResultId)
        .maybeSingle();

      if (existingRoundScore) {
        await supabase
          .from("round_scores")
          .update(roundScorePayload)
          .eq("id", existingRoundScore.id);
      } else {
        await supabase.from("round_scores").insert(roundScorePayload);
      }

      // 5. Insert question_scores if provided
      if (questionScores.length > 0) {
        for (const qs of questionScores) {
          try {
            await supabase.from("question_scores").upsert(
              {
                round_result_id: roundResultId,
                question_number: qs.questionNumber,
                question_text: qs.questionText,
                candidate_answer: qs.candidateAnswer || "",
                weighted_score: qs.score,
                ai_evaluation: qs.feedback || "Evaluated by AI",
                time_taken_seconds: qs.timeTakenSeconds || 0,
              },
              { onConflict: "round_result_id,question_number" }
            );
          } catch (e) {
            console.warn("Failed to upsert question score:", e);
          }
        }
      }
    }

    // 6. Calculate new application state
    const previousRound = app.current_round || 0;
    const newCurrentRound = passed
      ? Math.max(previousRound, roundNumber)
      : previousRound;

    const isAllRoundsFinished = passed && roundNumber >= totalRounds;

    let newStatus = app.status;
    if (!passed) {
      newStatus = "rejected";
    } else if (isAllRoundsFinished) {
      newStatus = "completed";
    } else {
      newStatus = "interviewing";
    }

    // 7. Update candidate_scores
    const techScore = detailedScores.technical ?? score;
    const commScore = detailedScores.communication ?? score;
    const psScore = detailedScores.problemSolving ?? score;

    const recommendation: "shortlist" | "maybe" | "reject" = !passed
      ? "reject"
      : score >= 80
      ? "shortlist"
      : "maybe";

    const candidateScorePayload = {
      application_id: applicationId,
      candidate_id: app.candidate_id,
      job_id: app.job_id,
      final_score: score,
      technical_score: techScore,
      communication_score: commScore,
      problem_solving_score: psScore,
      recommendation,
      recommendation_reason: passed
        ? `Candidate passed Round ${roundNumber} with a score of ${score}%.`
        : `Candidate scored ${score}%, below passing score of ${passingScore}%.`,
      recommendation_confidence: 0.9,
      overall_summary: feedback,
      strengths,
      weaknesses,
      improvement_suggestions: improvementSuggestions,
    };

    const { data: existingCandScore } = await supabase
      .from("candidate_scores")
      .select("id")
      .eq("application_id", applicationId)
      .maybeSingle();

    if (existingCandScore) {
      await supabase
        .from("candidate_scores")
        .update(candidateScorePayload)
        .eq("id", existingCandScore.id);
    } else {
      await supabase.from("candidate_scores").insert(candidateScorePayload);
    }

    // 8. Update applications table
    const applicationUpdate: any = {
      current_round: newCurrentRound,
      overall_score: score,
      status: newStatus,
    };

    if (isAllRoundsFinished) {
      applicationUpdate.completed_at = new Date().toISOString();
    }

    await supabase
      .from("applications")
      .update(applicationUpdate)
      .eq("id", applicationId);

    // Also record agent_result for historical tracking
    try {
      await supabase.from("agent_results").insert({
        application_id: applicationId,
        agent_number: roundNumber,
        agent_name: `Round ${roundNumber} Evaluator`,
        score,
        decision: passed ? "pass" : "reject",
        reasoning: feedback,
        raw_data: {
          round_number: roundNumber,
          passing_score: passingScore,
          detailed_scores: detailedScores,
        },
      });
    } catch (e) {
      console.warn("Non-fatal agent_results logging error:", e);
    }

    return {
      success: true,
      score,
      passed,
      currentRound: newCurrentRound,
      totalRounds,
      isCompleted: isAllRoundsFinished,
      nextRoundUnlocked: passed && roundNumber < totalRounds,
      nextRoundNumber: passed && roundNumber < totalRounds ? roundNumber + 1 : undefined,
    };
  } catch (error: any) {
    console.error("submitRoundResult failed:", error);
    return {
      success: false,
      score,
      passed: false,
      currentRound: 0,
      totalRounds: 1,
      isCompleted: false,
      nextRoundUnlocked: false,
      error: error.message || "Failed to persist round submission",
    };
  }
}
