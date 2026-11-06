// The two users the database tests act as. setup.ts gives each of them a
// project and one row in every table, with the ids below.

export interface User {
  name: string;
  user: string;
  email: string;
  project: string;
  thread: string;
  message: string;
  /** Table name → id of this user's row in it. */
  rows: Record<string, string>;
}

function fixtureUser(letter: "a" | "b"): User {
  const id = (n: number) => `${letter.repeat(8)}-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const user = id(0);
  return {
    name: letter.toUpperCase(),
    user,
    email: `user-${letter}@example.test`,
    project: id(1),
    thread: id(2),
    message: id(3),
    rows: {
      profiles: user,
      projects: id(1),
      chat_threads: id(2),
      chat_messages: id(3),
      writing_content: id(4),
      project_stats: id(5),
      chat_thread_summaries: id(6),
      chat_bookmarks: id(7),
      writing_versions: id(8),
      writing_summary_log: id(9),
      provenance_events: id(10),
      ai_editor_actions: id(11),
      flow_reports: id(12),
      imported_documents: id(13),
      post_its: id(14),
      project_creative_data: id(15),
      token_usage: id(16),
    },
  };
}

export const A = fixtureUser("a");
export const B = fixtureUser("b");

/** The rows of one user, inserted as the database owner. The profile, a
 * "Main" chat thread and the writing_content, project_stats and
 * provenance_events rows come from the sign-up and new-project triggers, as
 * in the app; the seed gives the last three known ids. */
export function seedSql(u: User): string {
  const r = u.rows;
  return `
INSERT INTO auth.users (id, email) VALUES ('${u.user}', '${u.email}');
INSERT INTO public.projects (id, user_id, name) VALUES ('${u.project}', '${u.user}', 'Project ${u.name}');
UPDATE public.writing_content SET id = '${r.writing_content}', content = '<p>Text by ${u.name}</p>'
  WHERE project_id = '${u.project}';
UPDATE public.project_stats SET id = '${r.project_stats}' WHERE project_id = '${u.project}';
UPDATE public.provenance_events SET id = '${r.provenance_events}' WHERE project_id = '${u.project}';
INSERT INTO public.chat_threads (id, project_id, name) VALUES ('${u.thread}', '${u.project}', 'Thread ${u.name}');
INSERT INTO public.chat_messages (id, thread_id, role, content)
  VALUES ('${u.message}', '${u.thread}', 'user', 'Question from ${u.name}');
INSERT INTO public.chat_thread_summaries (id, thread_id, summary_text, covers_through)
  VALUES ('${r.chat_thread_summaries}', '${u.thread}', 'Summary for ${u.name}', now());
INSERT INTO public.chat_bookmarks (id, project_id, thread_id, message_id)
  VALUES ('${r.chat_bookmarks}', '${u.project}', '${u.thread}', '${u.message}');
INSERT INTO public.writing_versions (id, project_id, content)
  VALUES ('${r.writing_versions}', '${u.project}', '<p>Draft by ${u.name}</p>');
INSERT INTO public.writing_summary_log (id, project_id, summary_text)
  VALUES ('${r.writing_summary_log}', '${u.project}', 'Writing summary for ${u.name}');
INSERT INTO public.ai_editor_actions (id, project_id, action_type, outcome)
  VALUES ('${r.ai_editor_actions}', '${u.project}', 'rewrite', 'accepted');
INSERT INTO public.flow_reports (id, project_id, ai_summary, ai_find, ai_lead, ai_organize, ai_write, model_used)
  VALUES ('${r.flow_reports}', '${u.project}', 'Report for ${u.name}', '{}', '{}', '{}', '{}', 'test-model');
INSERT INTO public.imported_documents (id, project_id, file_name, file_path)
  VALUES ('${r.imported_documents}', '${u.project}', 'notes.txt', '${u.user}/notes.txt');
INSERT INTO public.post_its (id, project_id, content)
  VALUES ('${r.post_its}', '${u.project}', 'Note by ${u.name}');
INSERT INTO public.project_creative_data (id, project_id, tool_type)
  VALUES ('${r.project_creative_data}', '${u.project}', 'characters');
INSERT INTO public.token_usage (id, user_id, function_name, model_used)
  VALUES ('${r.token_usage}', '${u.user}', 'chat', 'test-model');
`;
}
