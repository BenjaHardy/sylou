ALTER TABLE public.flow_reports
  ADD COLUMN IF NOT EXISTS replay_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS share_include_replay BOOLEAN NOT NULL DEFAULT false;