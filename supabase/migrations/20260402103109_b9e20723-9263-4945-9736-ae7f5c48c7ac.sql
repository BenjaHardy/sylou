-- 1. imported_documents table
CREATE TABLE public.imported_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  extracted_text TEXT,
  summary TEXT,
  file_size_bytes BIGINT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.imported_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_imported_documents" ON public.imported_documents
  FOR SELECT TO authenticated USING (owns_project(project_id));

CREATE POLICY "insert_own_imported_documents" ON public.imported_documents
  FOR INSERT TO authenticated WITH CHECK (owns_project(project_id));

CREATE POLICY "delete_own_imported_documents" ON public.imported_documents
  FOR DELETE TO authenticated USING (owns_project(project_id));

-- 2. Add documents_referenced to chat_messages
ALTER TABLE public.chat_messages ADD COLUMN documents_referenced JSONB DEFAULT NULL;

-- 3. Create imports storage bucket (private)
INSERT INTO storage.buckets (id, name, public) VALUES ('imports', 'imports', false);

-- 4. Storage RLS policies
CREATE POLICY "Users can upload own imports"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'imports' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can view own imports"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'imports' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete own imports"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'imports' AND auth.uid()::text = (storage.foldername(name))[1]);