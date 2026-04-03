ALTER TABLE public.flow_reports
  ADD COLUMN IF NOT EXISTS project_name text;

ALTER TABLE public.flow_reports
  ADD CONSTRAINT flow_reports_certificate_id_unique UNIQUE (certificate_id);