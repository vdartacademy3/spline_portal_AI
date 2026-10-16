// Lovable cloud-auth bridge has been removed. Google sign-in is intentionally
// unavailable in this deployment — the callers (routes/auth.tsx) surface the
// returned error as a toast and fall back to email/password (which goes straight
// to the Django auth endpoints).

type OAuthProvider = "google" | "microsoft";

function unavailableError(): Error {
  return new Error("Google sign-in is not enabled in this deployment.");
}

export const lovable = {
  auth: {
    signInWithOAuth: async (_provider: OAuthProvider, _opts?: { redirect_uri?: string }) => {
      return { redirected: false, error: unavailableError() };
    },
  },
};
