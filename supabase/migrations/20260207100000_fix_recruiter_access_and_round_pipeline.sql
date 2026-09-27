-- Migration: Fix Recruiter Access, RLS Permissions, and Round Pipeline Schema
-- Ensures interviewers can see candidate profiles, candidates can submit round results,
-- and server-authoritative timer columns exist.

-- 1. Ensure application_status enum includes completed and assessment_in_progress
ALTER TYPE public.application_status ADD VALUE IF NOT EXISTS 'completed';
ALTER TYPE public.application_status ADD VALUE IF NOT EXISTS 'assessment_in_progress';

-- 2. Add server-enforced timer columns and context snapshot to applications
ALTER TABLE public.applications
ADD COLUMN IF NOT EXISTS started_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS duration_seconds INTEGER,
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS interview_context_snapshot JSONB;

-- 3. Add rich profile columns to candidate_profiles if not present
ALTER TABLE public.candidate_profiles
ADD COLUMN IF NOT EXISTS full_name TEXT,
ADD COLUMN IF NOT EXISTS summary TEXT,
ADD COLUMN IF NOT EXISTS location TEXT,
ADD COLUMN IF NOT EXISTS work_experience JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS technical_skills JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS soft_skills JSONB DEFAULT '[]';

-- 4. RLS for public.profiles: Allow interviewers to view applicant profiles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Interviewers can view applicant profiles'
  ) THEN
    CREATE POLICY "Interviewers can view applicant profiles"
      ON public.profiles
      FOR SELECT
      USING (
        public.has_role(auth.uid(), 'interviewer')
        OR auth.uid() = user_id
      );
  END IF;
END $$;

-- 5. RLS for public.round_results: Allow candidates to insert and update their own application round results
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'round_results' AND policyname = 'Candidates can insert and update their own round results'
  ) THEN
    CREATE POLICY "Candidates can insert and update their own round results"
      ON public.round_results
      FOR ALL
      USING (EXISTS (
        SELECT 1 FROM public.applications
        WHERE applications.id = round_results.application_id
        AND applications.candidate_id = auth.uid()
      ))
      WITH CHECK (EXISTS (
        SELECT 1 FROM public.applications
        WHERE applications.id = round_results.application_id
        AND applications.candidate_id = auth.uid()
      ));
  END IF;
END $$;

-- 6. Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_round_results_app_round ON public.round_results(application_id, round_id);
CREATE INDEX IF NOT EXISTS idx_round_scores_app ON public.round_scores(application_id);
CREATE INDEX IF NOT EXISTS idx_candidate_scores_app ON public.candidate_scores(application_id);
