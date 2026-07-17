-- P3-2: add the missing foreign keys on post_its + chat_bookmarks.
--
-- Both tables were created with bare `uuid NOT NULL` parent columns, gated
-- only by owns_project() RLS -- the only two of the sixteen public tables
-- without real FKs. With no FK, deleting a parent (the app deletes projects:
-- useProjects) leaves child rows behind as orphans; owns_project() is false
-- for everyone once the project row is gone, so orphans become invisible AND
-- undeletable except via service role / SQL. Adding the FKs also completes
-- the delete-cascade spine ahead of account deletion (P3-1).
--
-- Idempotent for the SQL-editor apply flow: deletes are naturally
-- re-runnable, constraints DROP IF EXISTS + ADD, indexes IF NOT EXISTS.

-- 1. Purge pre-existing orphans. ADD CONSTRAINT validates existing rows and
--    fails (23503) while any remain. These rows are already invisible to
--    every user (owns_project false), so deleting them changes nothing
--    anyone can see.
DELETE FROM public.post_its p
  WHERE NOT EXISTS (SELECT 1 FROM public.projects pr WHERE pr.id = p.project_id);

DELETE FROM public.chat_bookmarks b
  WHERE NOT EXISTS (SELECT 1 FROM public.projects pr WHERE pr.id = b.project_id);

DELETE FROM public.chat_bookmarks b
  WHERE NOT EXISTS (SELECT 1 FROM public.chat_threads t WHERE t.id = b.thread_id);

DELETE FROM public.chat_bookmarks b
  WHERE NOT EXISTS (SELECT 1 FROM public.chat_messages m WHERE m.id = b.message_id);

-- 2. The four FKs, all ON DELETE CASCADE -- matches every sibling child
--    table, and a post-it/bookmark without its parent is meaningless.
--    (Messages/threads are never deleted individually today, only via the
--    project cascade, so message_id/thread_id CASCADE is unambiguous.)
--    Default-pattern constraint names (<table>_<column>_fkey) so a future
--    `supabase gen types` produces the same Relationships entries as the
--    hand-edit shipped with this migration.
ALTER TABLE public.post_its
  DROP CONSTRAINT IF EXISTS post_its_project_id_fkey;
ALTER TABLE public.post_its
  ADD CONSTRAINT post_its_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE public.chat_bookmarks
  DROP CONSTRAINT IF EXISTS chat_bookmarks_project_id_fkey;
ALTER TABLE public.chat_bookmarks
  ADD CONSTRAINT chat_bookmarks_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE public.chat_bookmarks
  DROP CONSTRAINT IF EXISTS chat_bookmarks_thread_id_fkey;
ALTER TABLE public.chat_bookmarks
  ADD CONSTRAINT chat_bookmarks_thread_id_fkey
  FOREIGN KEY (thread_id) REFERENCES public.chat_threads(id) ON DELETE CASCADE;

ALTER TABLE public.chat_bookmarks
  DROP CONSTRAINT IF EXISTS chat_bookmarks_message_id_fkey;
ALTER TABLE public.chat_bookmarks
  ADD CONSTRAINT chat_bookmarks_message_id_fkey
  FOREIGN KEY (message_id) REFERENCES public.chat_messages(id) ON DELETE CASCADE;

-- 3. Covering indexes (perf advisor 0001_unindexed_foreign_keys; same
--    decision as 20260702130000). Composite (fk, created_at) where the app
--    reads with ORDER BY created_at (usePostIts / useBookmarks fetch rows by
--    project_id ordered by created_at); plain single-column for the two FKs
--    with no app read path (cascade-delete lookups only). All four will read
--    as `unused_index` INFO until traffic grows -- accepted steady-state,
--    same as the token_usage pair; do not drop.
CREATE INDEX IF NOT EXISTS idx_post_its_project_created
  ON public.post_its (project_id, created_at);

CREATE INDEX IF NOT EXISTS idx_chat_bookmarks_project_created
  ON public.chat_bookmarks (project_id, created_at);

CREATE INDEX IF NOT EXISTS idx_chat_bookmarks_thread_id
  ON public.chat_bookmarks (thread_id);

CREATE INDEX IF NOT EXISTS idx_chat_bookmarks_message_id
  ON public.chat_bookmarks (message_id);
