// Server-side Spine admin client — uses the Django service-role key so server
// functions can bypass RLS. Import only from server functions.
//
// Service key env: `SERVICE_ROLE_KEY` (must equal the backend setting), API base
// via `API_URL` (or `VITE_API_URL` from the build overlay).

import { SpineClient } from "./core";

function resolveServiceRoleKey(): string {
  return process.env["SERVICE_ROLE_KEY"] || process.env["SUPABASE_SERVICE_ROLE_KEY"] || "";
}

function createServerSpineClient(): SpineClient {
  const key = resolveServiceRoleKey();
  if (!key) {
    throw new Error(
      "Missing SERVICE_ROLE_KEY. Set it in the server environment to match the Django backend.",
    );
  }
  return new SpineClient({ auth: { token: key, persistSession: false } });
}

let _supabaseAdmin: SpineClient | null = null;

/** Import this as `supabaseAdmin` — usable server-side only. */
export const supabaseAdmin = new Proxy({} as SpineClient, {
  get(_, prop, receiver) {
    if (!_supabaseAdmin) _supabaseAdmin = createServerSpineClient();
    return Reflect.get(_supabaseAdmin, prop, receiver);
  },
});
