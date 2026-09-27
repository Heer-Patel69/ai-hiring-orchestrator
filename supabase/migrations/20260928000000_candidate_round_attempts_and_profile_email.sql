-- =========================================================
-- Migration: Candidate Round Attempts + Profile Email Fix
-- Fixes: "No Interview Rounds Yet", "Round 0 of 1",
--         "Unknown Candidate", missing email, missing recording
-- =========================================================

-- 1. Add email column to candidate_profiles if not present
ALTER TABLE public.candidate_profiles
  ADD COLUMN IF NOT EXISTS email TEXT;

-- 2. Sync existing emails from profiles -> candidate_profiles
UPDATE public.candidate_profiles cp
SET email = p.email
FROM public.profiles p
WHERE p.user_id = cp.user_id
  AND cp.email IS NULL;

-- 3. Create candidate_round_attempts – the authoritative lifecycle table
CREATE TABLE IF NOT EXISTS public.candidate_round_attempts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  application_id        UUID NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  job_id                UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  round_id              UUID REFERENCES public.job_rounds(id) ON DELETE SET NULL,
  round_number          INTEGER NOT NULL,

  -- Lifecycle status
  status                TEXT NOT NULL DEFAULT 'available'
                          CHECK (status IN (
                            'available', 'in_progress', 'submitted',
                            'evaluating', 'completed', 'passed', 'failed',
                            'candidate_requested', 'policy_terminated', 'abandoned'
                          )),

  -- Scores
  score                 NUMERIC(5,2),
  technical_score       NUMERIC(5,2),
  communication_score   NUMERIC(5,2),
  problem_solving_score NUMERIC(5,2),

  -- Timestamps
  started_at            TIMESTAMP WITH TIME ZONE,
  submitted_at          TIMESTAMP WITH TIME ZONE,
  completed_at          TIMESTAMP WITH TIME ZONE,

  -- Termination details
  termination_type      TEXT CHECK (termination_type IN (
                            'normal', 'candidate_requested', 'policy_terminated',
                            'timeout', 'error'
                          )),
  termination_reason_code TEXT,
  termination_reason_text TEXT,

  -- Recording & transcript
  recording_url         TEXT,
  transcript_snapshot   JSONB DEFAULT '[]',

  -- AI evaluation
  ai_feedback           TEXT,
  ai_summary            TEXT,
  strengths             TEXT[],
  weaknesses            TEXT[],

  created_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

  UNIQUE(application_id, round_number)
);

-- 4. Enable RLS
ALTER TABLE public.candidate_round_attempts ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'candidate_round_attempts'
      AND policyname = 'Candidates can manage own attempts'
  ) THEN
    CREATE POLICY "Candidates can manage own attempts"
      ON public.candidate_round_attempts FOR ALL
      USING (candidate_id = auth.uid())
      WITH CHECK (candidate_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'candidate_round_attempts'
      AND policyname = 'Interviewers can view attempts for their jobs'
  ) THEN
    CREATE POLICY "Interviewers can view attempts for their jobs"
      ON public.candidate_round_attempts FOR SELECT
      USING (
        job_id IN (
          SELECT id FROM public.jobs WHERE interviewer_id = auth.uid()
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'candidate_round_attempts'
      AND policyname = 'Service role can manage all attempts'
  ) THEN
    CREATE POLICY "Service role can manage all attempts"
      ON public.candidate_round_attempts FOR ALL
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- 6. Indexes
CREATE INDEX IF NOT EXISTS idx_cra_application_id   ON public.candidate_round_attempts(application_id);
CREATE INDEX IF NOT EXISTS idx_cra_candidate_id     ON public.candidate_round_attempts(candidate_id);
CREATE INDEX IF NOT EXISTS idx_cra_job_id           ON public.candidate_round_attempts(job_id);
CREATE INDEX IF NOT EXISTS idx_cra_status           ON public.candidate_round_attempts(status);

-- 7. Add recording storage columns to interview_recordings if missing
ALTER TABLE public.interview_recordings
  ADD COLUMN IF NOT EXISTS candidate_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS recording_url      TEXT,
  ADD COLUMN IF NOT EXISTS recording_chunks   JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS status             TEXT DEFAULT 'pending'
                                                CHECK (status IN ('pending', 'recording', 'processing', 'ready', 'failed')),
  ADD COLUMN IF NOT EXISTS started_at         TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS ended_at           TIMESTAMP WITH TIME ZONE;

-- 8. Add completed_at column to applications if missing
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE;

-- 9. Allow candidates to update their own applications (for lifecycle tracking)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'applications'
      AND policyname = 'Candidates can update their own applications'
  ) THEN
    CREATE POLICY "Candidates can update their own applications"
      ON public.applications FOR UPDATE
      USING (candidate_id = auth.uid());
  END IF;
END $$;

-- 10. Ensure recording insert policy exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'interview_recordings'
      AND policyname = 'Candidates can insert own recordings'
  ) THEN
    CREATE POLICY "Candidates can insert own recordings"
      ON public.interview_recordings FOR INSERT
      WITH CHECK (
        application_id IN (
          SELECT id FROM public.applications WHERE candidate_id = auth.uid()
        )
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'interview_recordings'
      AND policyname = 'Candidates can update own recordings'
  ) THEN
    CREATE POLICY "Candidates can update own recordings"
      ON public.interview_recordings FOR UPDATE
      USING (
        application_id IN (
          SELECT id FROM public.applications WHERE candidate_id = auth.uid()
        )
      );
  END IF;
END $$;
