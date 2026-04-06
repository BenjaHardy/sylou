CREATE TABLE public.project_creative_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tool_type TEXT NOT NULL CHECK (tool_type IN ('worldbuilding', 'characters', 'timeline')),
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, tool_type)
);

ALTER TABLE public.project_creative_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users access own creative data" ON public.project_creative_data
  FOR ALL
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));