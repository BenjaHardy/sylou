
-- ========================================
-- 1. PROFILES TABLE
-- ========================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  email TEXT NOT NULL,
  subscription_tier TEXT NOT NULL DEFAULT 'free',
  monthly_token_budget BIGINT NOT NULL DEFAULT 50000,
  tokens_used_this_period BIGINT NOT NULL DEFAULT 0,
  billing_period_start TIMESTAMPTZ,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  preferred_chat_model TEXT DEFAULT 'mistral-large-latest',
  preferred_language TEXT DEFAULT 'English',
  flow_nudges_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ========================================
-- 2. PROJECTS TABLE
-- ========================================
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'English',
  template TEXT DEFAULT 'general',
  tutor_mode BOOLEAN NOT NULL DEFAULT false,
  tutor_mode_locked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, name)
);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own projects"
  ON public.projects FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own projects"
  ON public.projects FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own projects"
  ON public.projects FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own projects"
  ON public.projects FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- ========================================
-- 3. WRITING_CONTENT TABLE
-- ========================================
CREATE TABLE public.writing_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id)
);

ALTER TABLE public.writing_content ENABLE ROW LEVEL SECURITY;

-- Security definer to check project ownership (avoids recursive RLS)
CREATE OR REPLACE FUNCTION public.owns_project(_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects
    WHERE id = _project_id AND user_id = auth.uid()
  );
$$;

CREATE POLICY "Users access own writing_content"
  ON public.writing_content FOR SELECT
  TO authenticated
  USING (public.owns_project(project_id));

CREATE POLICY "Users insert own writing_content"
  ON public.writing_content FOR INSERT
  TO authenticated
  WITH CHECK (public.owns_project(project_id));

CREATE POLICY "Users update own writing_content"
  ON public.writing_content FOR UPDATE
  TO authenticated
  USING (public.owns_project(project_id))
  WITH CHECK (public.owns_project(project_id));

CREATE POLICY "Users delete own writing_content"
  ON public.writing_content FOR DELETE
  TO authenticated
  USING (public.owns_project(project_id));

-- ========================================
-- 4. WRITING_VERSIONS TABLE
-- ========================================
CREATE TABLE public.writing_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.writing_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users access own writing_versions"
  ON public.writing_versions FOR SELECT
  TO authenticated
  USING (public.owns_project(project_id));

CREATE POLICY "Users insert own writing_versions"
  ON public.writing_versions FOR INSERT
  TO authenticated
  WITH CHECK (public.owns_project(project_id));

CREATE POLICY "Users delete own writing_versions"
  ON public.writing_versions FOR DELETE
  TO authenticated
  USING (public.owns_project(project_id));

-- ========================================
-- 5. CHAT_THREADS TABLE
-- ========================================
CREATE TABLE public.chat_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Main',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users access own chat_threads"
  ON public.chat_threads FOR SELECT
  TO authenticated
  USING (public.owns_project(project_id));

CREATE POLICY "Users insert own chat_threads"
  ON public.chat_threads FOR INSERT
  TO authenticated
  WITH CHECK (public.owns_project(project_id));

CREATE POLICY "Users update own chat_threads"
  ON public.chat_threads FOR UPDATE
  TO authenticated
  USING (public.owns_project(project_id))
  WITH CHECK (public.owns_project(project_id));

CREATE POLICY "Users delete own chat_threads"
  ON public.chat_threads FOR DELETE
  TO authenticated
  USING (public.owns_project(project_id));

-- ========================================
-- 6. CHAT_MESSAGES TABLE
-- ========================================
CREATE OR REPLACE FUNCTION public.owns_thread(_thread_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_threads ct
    JOIN public.projects p ON p.id = ct.project_id
    WHERE ct.id = _thread_id AND p.user_id = auth.uid()
  );
$$;

CREATE TABLE public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES public.chat_threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  model_used TEXT,
  tutor_mode BOOLEAN DEFAULT false,
  concise_mode BOOLEAN DEFAULT false,
  source_type TEXT DEFAULT 'chat',
  flow_flag TEXT DEFAULT 'normal',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_messages_thread_created ON public.chat_messages (thread_id, created_at);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users access own chat_messages"
  ON public.chat_messages FOR SELECT
  TO authenticated
  USING (public.owns_thread(thread_id));

CREATE POLICY "Users insert own chat_messages"
  ON public.chat_messages FOR INSERT
  TO authenticated
  WITH CHECK (public.owns_thread(thread_id));

CREATE POLICY "Users delete own chat_messages"
  ON public.chat_messages FOR DELETE
  TO authenticated
  USING (public.owns_thread(thread_id));

-- ========================================
-- 7. AUTO-CREATE PROFILE ON SIGNUP
-- ========================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'display_name', NEW.raw_user_meta_data ->> 'full_name')
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ========================================
-- 8. AUTO-CREATE WRITING_CONTENT + CHAT_THREAD ON NEW PROJECT
-- ========================================
CREATE OR REPLACE FUNCTION public.handle_new_project()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.writing_content (project_id) VALUES (NEW.id);
  INSERT INTO public.chat_threads (project_id, name) VALUES (NEW.id, 'Main');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_project_created
  AFTER INSERT ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_project();
