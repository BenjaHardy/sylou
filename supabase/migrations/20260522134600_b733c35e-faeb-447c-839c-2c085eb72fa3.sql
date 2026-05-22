-- Explicit deny policies on token_usage to lock down future permissive mistakes
CREATE POLICY "No updates to token_usage" ON public.token_usage
  FOR UPDATE TO authenticated USING (false);

CREATE POLICY "No deletes from token_usage" ON public.token_usage
  FOR DELETE TO authenticated USING (false);

-- Add missing UPDATE policy on imports storage bucket, scoped to user's own folder
CREATE POLICY "Users update own imports"
ON storage.objects
FOR UPDATE TO authenticated
USING (bucket_id = 'imports' AND (auth.uid())::text = (storage.foldername(name))[1])
WITH CHECK (bucket_id = 'imports' AND (auth.uid())::text = (storage.foldername(name))[1]);