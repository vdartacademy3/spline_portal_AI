import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@/integrations/supabase/session-types";

import { supabase } from "@/integrations/supabase/client";
import { getStoredSession } from "@/integrations/supabase/core";
import { primaryRole, widestScope, type AppRole, type DataScope } from "@/lib/rbac";

export type EmployeeRecord = {
  id: string;
  employee_code: string;
  first_name: string;
  last_name: string;
  designation: string | null;
  department_id: string | null;
  location_id: string | null;
  manager_id: string | null;
  work_email: string | null;
};

type AuthState = {
  loading: boolean;
  session: Session | null;
  user: User | null;
  roles: AppRole[];
  role: AppRole;
  permissions: string[];
  can: (code: string) => boolean;
  scope: DataScope;
  employee: EmployeeRecord | null;
  fullName: string;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

/**
 * True only on positive evidence that the active session moved on. The current
 * identity is the in-memory user id when the provider has observed one, and the
 * stored session only as a fallback when it has not -- storage is unavailable in
 * privacy mode, where the session lives solely in React state. A missing
 * identity proves nothing (nothing known yet, or sign-out already cleared it),
 * so null still fails open and the caller proceeds as before. Module scope is
 * deliberate: this is pure, so it is not a reactive hook dependency.
 */
function isStaleContextLoad(userId: string, currentUserId: string | null): boolean {
  const current = currentUserId ?? getStoredSession()?.user?.id ?? null;
  return current !== null && current !== userId;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [scope, setScope] = useState<DataScope>("SELF");
  const [employee, setEmployee] = useState<EmployeeRecord | null>(null);
  const [fullName, setFullName] = useState("");

  // INITIAL_SESSION and getSession() both report the same user during a single
  // boot (React 18 StrictMode runs the effect twice as well), which used to run
  // the four context queries four times in parallel. Single-flight per user id:
  // concurrent callers share one in-flight load instead of issuing their own.
  const loadInFlight = useRef(new Map<string, Promise<void>>());

  // Same single-flight, one level up: recovery wraps loadContext with retries and
  // a terminal sign-out, and both bootstrap paths (INITIAL_SESSION and
  // getSession()) can trigger it for the same user during one boot. Sharing one
  // recovery promise means they cannot run competing retry loops or fire more
  // than one signOut.
  const recoveryInFlight = useRef(new Map<string, Promise<void>>());

  // Authoritative in-memory identity for the staleness guard, updated from the
  // same events that call setSession. Unlike getStoredSession(), it survives when
  // browser storage is unavailable (privacy mode), where the session lives only
  // in React state. A ref so async callbacks read the latest value synchronously.
  const currentUserIdRef = useRef<string | null>(null);

  async function loadContext(userId: string, email?: string | null) {
    const running = loadInFlight.current.get(userId);
    if (running) return running;

    const task = (async () => {
      const [roleRes, profileRes, empRes] = await Promise.all([
        supabase.from("user_roles").select("role, scope").eq("user_id", userId),
        supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
        supabase
          .from("employees")
          .select(
            "id, employee_code, first_name, last_name, designation, department_id, location_id, manager_id, work_email",
          )
          .eq("user_id", userId)
          .maybeSingle(),
      ]);
      const roleRows = roleRes.data;
      const profile = profileRes.data;
      const emp = empRes.data;

      // A failed read is not the same as "no rows". rawFetch does not catch, so a
      // network fault rejects right here and leaves the previous state untouched;
      // an HTTP fault resolves as {data: null, error}. Either way, treating the
      // result as an empty one would present a transport failure as a
      // successfully initialised, permission-less context -- so raise both.
      const failed = roleRes.error ?? profileRes.error ?? empRes.error;
      if (failed) throw failed;

      // Fetch role permissions after roles, before applying any state, so we
      // never apply a partially populated context. Re-verify identity after
      // every await (post-Promise.all and post-permissions query).
      let permRows: Array<{ permission_code: string }> | null = null;
      if ((roleRows ?? []).length > 0) {
        const permRes = await supabase
          .from("role_permissions")
          .select("permission_code")
          .in("role", (roleRows ?? []).map((r) => r.role) as AppRole[]);
        if (permRes.error) throw permRes.error;
        permRows = (permRes.data ?? []) as Array<{ permission_code: string }>;
      }

      if (isStaleContextLoad(userId, currentUserIdRef.current)) return;

      const nextRoles = ((roleRows ?? []).map((r) => r.role) as AppRole[]) ?? [];
      setRoles(nextRoles);
      setScope(widestScope(((roleRows ?? []).map((r) => r.scope) as DataScope[]) ?? []));
      if (permRows) {
        setPermissions([...new Set(permRows.map((p) => p.permission_code))]);
      } else {
        setPermissions([]);
      }
      setEmployee((emp as EmployeeRecord | null) ?? null);
      setFullName(
        profile?.full_name ?? (emp ? `${emp.first_name} ${emp.last_name}` : (email ?? "User")),
      );
    })();

    loadInFlight.current.set(userId, task);
    try {
      await task;
    } finally {
      if (loadInFlight.current.get(userId) === task) loadInFlight.current.delete(userId);
    }
  }

  // Small, explicit retry budget. A single blip should not cost the user their
  // session, but retrying forever would leave the shell permanently unusable,
  // so the budget is bounded and the terminal action is a full sign-out.
  const CONTEXT_RETRY_LIMIT = 2;
  const CONTEXT_RETRY_DELAY_MS = 500;

  useEffect(() => {
    /**
     * Load the authorization context, retrying briefly, and tear the session
     * down if it cannot be established.
     *
     * loadContext() throws on both a transport rejection and an API error, and
     * it leaves the previous roles/permissions/scope/employee untouched when it
     * throws. That stale context must not stay active in the authenticated
     * shell, so the terminal step is signOut(): it clears the stored session and
     * emits SIGNED_OUT, which drives the signed-out cleanup branch below and
     * lets route.tsx redirect to /auth. That cannot loop -- /auth renders outside
     * the _app layout, so no context load is retried from there.
     */
    async function loadContextWithRecovery(userId: string, email?: string | null) {
      // Single-flight per user id, mirroring loadContext: overlapping callers
      // share one recovery run, so only one of them can reach the terminal
      // signOut. The promise is cleared in finally() so a later recovery (e.g. a
      // genuine reconnect) can still run.
      const running = recoveryInFlight.current.get(userId);
      if (running) return running;

      const task = (async () => {
        for (let attempt = 0; attempt <= CONTEXT_RETRY_LIMIT; attempt++) {
          try {
            await loadContext(userId, email);
            return;
          } catch (err) {
            // The session moved on while this attempt was in flight: stop without
            // retrying and, critically, without signing out the newer session.
            if (isStaleContextLoad(userId, currentUserIdRef.current)) return;
            if (attempt === CONTEXT_RETRY_LIMIT) {
              console.error(
                `[auth] context load failed after ${attempt + 1} attempts; signing out`,
                err,
              );
              await supabase.auth.signOut();
              return;
            }
            await new Promise((resolve) => setTimeout(resolve, CONTEXT_RETRY_DELAY_MS));
            if (isStaleContextLoad(userId, currentUserIdRef.current)) return;
          }
        }
      })();

      recoveryInFlight.current.set(userId, task);
      try {
        await task;
      } finally {
        if (recoveryInFlight.current.get(userId) === task) recoveryInFlight.current.delete(userId);
      }
    }

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      // Record identity synchronously (before the recovery microtask below) so a
      // guard read from an in-flight load for a previous user sees the switch
      // immediately, even when storage is unavailable.
      currentUserIdRef.current = next?.user?.id ?? null;
      if (next?.user) {
        setTimeout(() => {
          void loadContextWithRecovery(next.user.id, next.user.email).finally(() =>
            setLoading(false),
          );
        }, 0);
      } else {
        setRoles([]);
        setPermissions([]);
        setScope("SELF");
        setEmployee(null);
        setFullName("");
        setLoading(false);
      }
    });

    // Mirrors the INITIAL_SESSION branch above: loading must clear even when
    // the context load fails, otherwise a failure during bootstrap leaves the
    // app on the loading shell forever, with no way to reach /auth.
    void supabase.auth
      .getSession()
      .then(async ({ data }) => {
        setSession(data.session);
        currentUserIdRef.current = data.session?.user?.id ?? null;
        if (data.session?.user) {
          await loadContextWithRecovery(data.session.user.id, data.session.user.email);
        }
      })
      .catch((err) => {
        console.error("[auth] session bootstrap failed", err);
      })
      .finally(() => setLoading(false));

    return () => sub.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      loading,
      session,
      user: session?.user ?? null,
      roles,
      role: primaryRole(roles),
      permissions,
      can: (code: string) => roles.includes("super_admin") || permissions.includes(code),
      scope,
      employee,
      fullName,
      signOut: async () => {
        await supabase.auth.signOut();
      },
      refresh: async () => {
        if (session?.user) await loadContext(session.user.id, session.user.email);
      },
    }),
    [loading, session, roles, permissions, scope, employee, fullName],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
