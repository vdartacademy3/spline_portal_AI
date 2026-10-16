// Browser-side Spine API client — talks to the local Django backend instead of
// Supabase. Shape-compatible with the old `@supabase/supabase-js` client so the
// rest of the app is untouched.
//
// Uses `VITE_API_URL` (client build) or `API_URL` (SSR/dev overlay). User
// sessions live in localStorage under `spine-session`.

import { SpineClient } from "./core";

function createSpineClient(): SpineClient {
  return new SpineClient({ auth: { persistSession: true } });
}

let _supabase: SpineClient | null = null;

/** Import this as `supabase` — e.g. `import { supabase } from "@/integrations/supabase/client"`. */
export const supabase = new Proxy({} as SpineClient, {
  get(_, prop, receiver) {
    if (!_supabase) _supabase = createSpineClient();
    return Reflect.get(_supabase, prop, receiver);
  },
});
