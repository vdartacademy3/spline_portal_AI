// Structural stand-ins for the `@supabase/supabase-js` types. The real package
// stays installed (rollback path), but the compat client is typed against these
// loose shapes so nothing imports the Supabase runtime.

export type Session = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  expires_at: number | null;
  user: User;
  provider_token?: string | null;
  provider_refresh_token?: string | null;
};

export type User = {
  id: string;
  aud?: string | null;
  role?: string | null;
  email?: string | null;
  email_confirmed_at?: string | null;
  confirmed_at?: string | null;
  last_sign_in_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  phone?: string | null;
  is_anonymous?: boolean;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
};
