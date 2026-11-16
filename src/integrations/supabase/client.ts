import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { publishableKey, supabaseUrl } from '@/lib/runtime-config';

export const supabase = createClient<Database>(supabaseUrl(), publishableKey(), {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});
