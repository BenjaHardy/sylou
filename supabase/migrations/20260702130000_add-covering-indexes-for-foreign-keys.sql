-- Performance advisor (0001_unindexed_foreign_keys): add covering indexes for
-- the six foreign keys the linter flagged. Every one is an ON DELETE CASCADE /
-- SET NULL child of projects/profiles, so an unindexed FK forces a sequential
-- scan (and heavier locks) on the child whenever a parent row is deleted -- and
-- four of the six are also read by their FK column on the app's hot paths.
--
-- Where the table is read with an ORDER BY, the index is composite on
-- (fk_column, sort_column) so it doubles as the FK-covering index AND serves
-- the sort -- matching the existing idx_ai_editor_actions_project_created /
-- idx_chat_messages_thread_created convention. Sort column names were verified
-- against each CREATE TABLE (flow_reports/chat_threads use created_at, NOT a
-- generated_at/analyzed_at; imported_documents uses uploaded_at; writing_versions
-- uses saved_at).

-- Read by project_id on the app's hot paths + cascade on project delete.
CREATE INDEX IF NOT EXISTS idx_chat_threads_project_created
  ON public.chat_threads (project_id, created_at);        -- useChatThread: .eq(project_id).order(created_at)

CREATE INDEX IF NOT EXISTS idx_flow_reports_project_created
  ON public.flow_reports (project_id, created_at);        -- useFlowAnalysis: latest report .order(created_at desc).limit(1)

CREATE INDEX IF NOT EXISTS idx_imported_documents_project_uploaded
  ON public.imported_documents (project_id, uploaded_at); -- useImportedDocuments: .eq(project_id).order(uploaded_at desc)

CREATE INDEX IF NOT EXISTS idx_writing_versions_project_saved
  ON public.writing_versions (project_id, saved_at);      -- analysis: .eq(project_id).order(saved_at asc)

-- Append-only audit log -- never SELECTed by the app, so plain single-column FK
-- indexes purely to keep parent deletes fast as the log grows
-- (user_id -> ON DELETE CASCADE from profiles; project_id -> ON DELETE SET NULL
-- from projects; both still have to locate the child rows on delete).
CREATE INDEX IF NOT EXISTS idx_token_usage_user_id
  ON public.token_usage (user_id);

CREATE INDEX IF NOT EXISTS idx_token_usage_project_id
  ON public.token_usage (project_id);
