alter table public.profiles
  add column if not exists preferred_flow_model text not null default 'claude-sonnet-4-6',
  add column if not exists default_concise_mode boolean not null default false;

alter table public.profiles
  alter column preferred_chat_model set default 'mistral-large-3';

update public.profiles      set preferred_chat_model = 'mistral-large-3' where preferred_chat_model = 'mistral-large-latest';
update public.chat_messages set model_used           = 'mistral-large-3' where model_used = 'mistral-large-latest';
update public.flow_reports  set model_used           = 'mistral-large-3' where model_used = 'mistral-large-latest';
update public.token_usage   set model_used           = 'mistral-large-3' where model_used = 'mistral-large-latest';