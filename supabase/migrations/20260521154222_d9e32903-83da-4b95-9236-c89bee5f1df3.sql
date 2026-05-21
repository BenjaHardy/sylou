UPDATE public.profiles SET preferred_chat_model = 'mistral-large-latest' WHERE preferred_chat_model = 'mistral-large-3';
UPDATE public.profiles SET preferred_chat_model = 'deepseek-chat' WHERE preferred_chat_model = 'deepseek-v4-flash';
UPDATE public.profiles SET preferred_flow_model = 'deepseek-chat' WHERE preferred_flow_model = 'deepseek-v4-flash';
ALTER TABLE public.profiles ALTER COLUMN preferred_chat_model SET DEFAULT 'mistral-large-latest';