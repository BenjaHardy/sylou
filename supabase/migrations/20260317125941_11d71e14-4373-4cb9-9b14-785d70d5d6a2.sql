
-- project_stats table for activity tracking
CREATE TABLE public.project_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  total_active_time_seconds bigint NOT NULL DEFAULT 0,
  total_writing_time_seconds bigint NOT NULL DEFAULT 0,
  chat_prompt_count_normal bigint NOT NULL DEFAULT 0,
  chat_prompt_count_tutor bigint NOT NULL DEFAULT 0,
  sanity_check_count bigint NOT NULL DEFAULT 0,
  first_activity_at timestamptz,
  last_activity_at timestamptz,
  clock_anomaly_count bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id)
);

-- RLS policies
ALTER TABLE public.project_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own project_stats"
  ON public.project_stats FOR SELECT TO authenticated
  USING (owns_project(project_id));

CREATE POLICY "Users can insert own project_stats"
  ON public.project_stats FOR INSERT TO authenticated
  WITH CHECK (owns_project(project_id));

CREATE POLICY "Users can update own project_stats"
  ON public.project_stats FOR UPDATE TO authenticated
  USING (owns_project(project_id))
  WITH CHECK (owns_project(project_id));

-- Auto-create project_stats row when a project is created
CREATE OR REPLACE FUNCTION public.handle_new_project()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.writing_content (project_id) VALUES (NEW.id);
  INSERT INTO public.chat_threads (project_id, name) VALUES (NEW.id, 'Main');
  INSERT INTO public.project_stats (project_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;

-- Backfill project_stats for existing projects
INSERT INTO public.project_stats (project_id)
SELECT id FROM public.projects
WHERE id NOT IN (SELECT project_id FROM public.project_stats);
