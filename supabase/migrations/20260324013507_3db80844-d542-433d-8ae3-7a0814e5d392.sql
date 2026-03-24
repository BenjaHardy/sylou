ALTER TABLE public.ai_editor_actions
  DROP CONSTRAINT ai_editor_actions_outcome_check;

ALTER TABLE public.ai_editor_actions
  ADD CONSTRAINT ai_editor_actions_outcome_check
  CHECK (outcome = ANY (ARRAY['accepted', 'modified', 'rejected', 'pending']));