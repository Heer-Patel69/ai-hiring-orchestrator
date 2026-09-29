-- Durable claims prevent simultaneous generations across workers and restarts.
CREATE TABLE IF NOT EXISTS public.interview_turn_requests (
  application_id uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  turn_id uuid NOT NULL,
  request_hash text NOT NULL,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'complete', 'failed')),
  response_sse text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (application_id, turn_id)
);
ALTER TABLE public.interview_turn_requests ENABLE ROW LEVEL SECURITY;
-- Only the authenticated backend's database role accesses this table.
REVOKE ALL ON public.interview_turn_requests FROM anon, authenticated;
