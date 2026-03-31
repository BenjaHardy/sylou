CREATE TABLE public.chat_bookmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  message_id uuid NOT NULL,
  char_offset int DEFAULT 0,
  color text DEFAULT 'blue',
  annotation text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_bookmarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_bookmarks" ON public.chat_bookmarks FOR SELECT TO authenticated USING (owns_project(project_id));
CREATE POLICY "insert_own_bookmarks" ON public.chat_bookmarks FOR INSERT TO authenticated WITH CHECK (owns_project(project_id));
CREATE POLICY "update_own_bookmarks" ON public.chat_bookmarks FOR UPDATE TO authenticated USING (owns_project(project_id)) WITH CHECK (owns_project(project_id));
CREATE POLICY "delete_own_bookmarks" ON public.chat_bookmarks FOR DELETE TO authenticated USING (owns_project(project_id));