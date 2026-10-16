import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { lovable } from "@/integrations/lovable/index";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Spine AI HR Intelligence" },
      {
        name: "description",
        content:
          "Sign in to Spine AI, the HR intelligence and workforce management platform that answers and acts.",
      },
      { property: "og:title", content: "Sign in — Spine AI" },
      { property: "og:description", content: "Access your workforce intelligence workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

type Mode = "signin" | "signup" | "forgot";

function AuthPage() {
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && session) void navigate({ to: "/dashboard" });
  }, [loading, session, navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        void navigate({ to: "/dashboard" });
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/dashboard`,
            data: { full_name: fullName },
          },
        });
        if (error) throw error;
        toast.success("Account created. Check your email to confirm, then sign in.");
        setMode("signin");
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        toast.success("If that email exists, a reset link is on its way.");
        setMode("signin");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onGoogle() {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      toast.error("Google sign-in is unavailable right now.");
      return;
    }
    if (result.redirected) return;
    void navigate({ to: "/dashboard" });
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-sidebar p-12 text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <Sparkles className="h-5 w-5" aria-hidden />
          </span>
          <span className="text-lg font-semibold">Spine AI</span>
        </div>
        <div className="max-w-md">
          <h2 className="text-3xl font-semibold leading-tight text-sidebar-accent-foreground">
            From HR chatbot to HR autopilot — AI that answers and acts.
          </h2>
          <p className="mt-4 text-sm opacity-80">
            Workforce data, intelligence, permission-aware answers and approved actions in one
            connected HR platform.
          </p>
          <ul className="mt-8 space-y-2 text-sm opacity-80">
            <li>Role and data-scope aware from the database up</li>
            <li>AI proposals always reviewed by a human</li>
            <li>Every important action recorded in the audit trail</li>
          </ul>
        </div>
        <p className="text-xs opacity-60">Enterprise HR intelligence workspace</p>
      </section>

      <section className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="h-5 w-5" aria-hidden />
            </span>
            <span className="text-lg font-semibold">Spine AI</span>
          </div>

          <h1 className="text-2xl font-semibold">
            {mode === "signin"
              ? "Sign in"
              : mode === "signup"
                ? "Create your account"
                : "Reset password"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "forgot"
              ? "We will email you a link to set a new password."
              : "Use your work account to continue."}
          </p>

          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            {mode === "signup" ? (
              <div className="space-y-2">
                <Label htmlFor="name">Full name</Label>
                <Input
                  id="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="email">Work email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            {mode !== "forgot" ? (
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={6}
                  required
                />
              </div>
            ) : null}

            <Button type="submit" className="w-full" disabled={busy}>
              {busy
                ? "Please wait..."
                : mode === "signin"
                  ? "Sign in"
                  : mode === "signup"
                    ? "Create account"
                    : "Send reset link"}
            </Button>
          </form>

          {mode !== "forgot" ? (
            <>
              <div className="my-5 flex items-center gap-3 text-xs uppercase text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                or
                <span className="h-px flex-1 bg-border" />
              </div>
              <Button variant="outline" className="w-full" onClick={onGoogle} type="button">
                Continue with Google
              </Button>
            </>
          ) : null}

          <div className="mt-6 space-y-2 text-sm text-muted-foreground">
            {mode === "signin" ? (
              <>
                <button
                  className="underline-offset-4 hover:underline"
                  onClick={() => setMode("forgot")}
                >
                  Forgot your password?
                </button>
                <p>
                  New here?{" "}
                  <button
                    className="text-primary underline-offset-4 hover:underline"
                    onClick={() => setMode("signup")}
                  >
                    Create an account
                  </button>
                </p>
              </>
            ) : (
              <button
                className="text-primary underline-offset-4 hover:underline"
                onClick={() => setMode("signin")}
              >
                Back to sign in
              </button>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
