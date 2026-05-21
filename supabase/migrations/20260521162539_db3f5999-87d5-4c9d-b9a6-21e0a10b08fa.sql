CREATE POLICY "update_own_imported_documents"
ON public.imported_documents
FOR UPDATE
TO authenticated
USING (owns_project(project_id))
WITH CHECK (owns_project(project_id));