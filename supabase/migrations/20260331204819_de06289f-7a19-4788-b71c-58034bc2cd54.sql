CREATE TABLE public.post_its (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  content text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT 'yellow',
  position_x int NOT NULL DEFAULT 50,
  position_y int NOT NULL DEFAULT 50,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.post_its ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_post_its" ON public.post_its FOR SELECT TO authenticated USING (owns_project(project_id));
CREATE POLICY "insert_own_post_its" ON public.post_its FOR INSERT TO authenticated WITH CHECK (owns_project(project_id));
CREATE POLICY "update_own_post_its" ON public.post_its FOR UPDATE TO authenticated USING (owns_project(project_id)) WITH CHECK (owns_project(project_id));
CREATE POLICY "delete_own_post_its" ON public.post_its FOR DELETE TO authenticated USING (owns_project(project_id));