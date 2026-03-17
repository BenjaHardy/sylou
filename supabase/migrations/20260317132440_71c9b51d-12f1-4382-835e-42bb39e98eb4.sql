
-- flow_reports
CREATE TABLE public.flow_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  ai_summary text NOT NULL,
  ai_find jsonb NOT NULL,
  ai_lead jsonb NOT NULL,
  ai_organize jsonb NOT NULL,
  ai_write jsonb NOT NULL,
  user_feedback_pre jsonb,
  user_feedback_pre_at timestamptz,
  user_feedback_post jsonb,
  user_feedback_post_at timestamptz,
  metrics_snapshot jsonb,
  flow_meta jsonb,
  provenance_snapshot jsonb,
  ai_editor_summary jsonb,
  model_used text NOT NULL,
  share_token text UNIQUE,
  share_enabled boolean DEFAULT false,
  share_visibility text DEFAULT 'public',
  certificate_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE POLICY "Users can select own flow_reports" ON public.flow_reports
  FOR SELECT TO authenticated USING (owns_project(project_id));
CREATE POLICY "Users can insert own flow_reports" ON public.flow_reports
  FOR INSERT TO authenticated WITH CHECK (owns_project(project_id));
CREATE POLICY "Users can update own flow_reports" ON public.flow_reports
  FOR UPDATE TO authenticated USING (owns_project(project_id)) WITH CHECK (owns_project(project_id));
CREATE POLICY "Users can delete own flow_reports" ON public.flow_reports
  FOR DELETE TO authenticated USING (owns_project(project_id));
CREATE POLICY "Public can view shared flow_reports" ON public.flow_reports
  FOR SELECT TO anon, authenticated USING (share_enabled = true AND share_visibility = 'public');

-- ai_editor_actions
CREATE TABLE public.ai_editor_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  action_type text NOT NULL CHECK (action_type IN ('rewrite','simplify','expand','fix_grammar','translate','ask','propose')),
  selected_text_preview text,
  instruction_text text,
  ai_response_preview text,
  outcome text NOT NULL CHECK (outcome IN ('accepted','modified','rejected')),
  char_count_original int,
  char_count_result int,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_editor_actions_project_created ON public.ai_editor_actions(project_id, created_at);

CREATE POLICY "Users can select own ai_editor_actions" ON public.ai_editor_actions
  FOR SELECT TO authenticated USING (owns_project(project_id));
CREATE POLICY "Users can insert own ai_editor_actions" ON public.ai_editor_actions
  FOR INSERT TO authenticated WITH CHECK (owns_project(project_id));
CREATE POLICY "Users can update own ai_editor_actions" ON public.ai_editor_actions
  FOR UPDATE TO authenticated USING (owns_project(project_id)) WITH CHECK (owns_project(project_id));
CREATE POLICY "Users can delete own ai_editor_actions" ON public.ai_editor_actions
  FOR DELETE TO authenticated USING (owns_project(project_id));

-- writing_summary_log
CREATE TABLE public.writing_summary_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  summary_text text NOT NULL,
  last_updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id)
);

CREATE POLICY "Users can select own writing_summary_log" ON public.writing_summary_log
  FOR SELECT TO authenticated USING (owns_project(project_id));
CREATE POLICY "Users can insert own writing_summary_log" ON public.writing_summary_log
  FOR INSERT TO authenticated WITH CHECK (owns_project(project_id));
CREATE POLICY "Users can update own writing_summary_log" ON public.writing_summary_log
  FOR UPDATE TO authenticated USING (owns_project(project_id)) WITH CHECK (owns_project(project_id));
CREATE POLICY "Users can delete own writing_summary_log" ON public.writing_summary_log
  FOR DELETE TO authenticated USING (owns_project(project_id));

-- provenance_events
CREATE TABLE public.provenance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  segment_map jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id)
);

CREATE POLICY "Users can select own provenance_events" ON public.provenance_events
  FOR SELECT TO authenticated USING (owns_project(project_id));
CREATE POLICY "Users can insert own provenance_events" ON public.provenance_events
  FOR INSERT TO authenticated WITH CHECK (owns_project(project_id));
CREATE POLICY "Users can update own provenance_events" ON public.provenance_events
  FOR UPDATE TO authenticated USING (owns_project(project_id)) WITH CHECK (owns_project(project_id));
CREATE POLICY "Users can delete own provenance_events" ON public.provenance_events
  FOR DELETE TO authenticated USING (owns_project(project_id));

-- token_usage
CREATE TABLE public.token_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  function_name text NOT NULL,
  model_used text NOT NULL,
  input_tokens int NOT NULL DEFAULT 0,
  output_tokens int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE POLICY "Users can select own token_usage" ON public.token_usage
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users can insert own token_usage" ON public.token_usage
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- Update handle_new_project trigger to also create provenance_events
CREATE OR REPLACE FUNCTION public.handle_new_project()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.writing_content (project_id) VALUES (NEW.id);
  INSERT INTO public.chat_threads (project_id, name) VALUES (NEW.id, 'Main');
  INSERT INTO public.project_stats (project_id) VALUES (NEW.id);
  INSERT INTO public.provenance_events (project_id) VALUES (NEW.id);
  RETURN NEW;
END;
$function$;
