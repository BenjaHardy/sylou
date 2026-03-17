
CREATE OR REPLACE FUNCTION public.increment_tokens_used(user_uuid UUID, amount BIGINT)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.profiles
  SET tokens_used_this_period = tokens_used_this_period + amount
  WHERE id = user_uuid;
$$;
