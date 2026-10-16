import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SpineClient, getStoredSession } from "./core";
import type { AuthChangeEvent } from "./core";
import type { Session } from "./session-types";

function makeSession(userId: string, tag: string): Session {
  return {
    access_token: `access-${tag}`,
    refresh_token: `refresh-${tag}`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: null,
    user: { id: userId, email: `${userId}@example.com` },
  };
}

function memoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => {
      store.clear();
    },
  };
}

function okResponse(body: unknown = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function errResponse(status = 401) {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => JSON.stringify({ message: "request failed" }),
  };
}

describe("auth session-race regression (6H.17)", () => {
  let fetchCalls: Array<{ url: string; body: unknown }>;
  let logoutResolvers: Array<(v: unknown) => void>;
  let refreshQueue: Array<{ resolve: (v: unknown) => void; reject: (e: unknown) => void }>;
  let events: Array<{ event: AuthChangeEvent; session: Session | null }>;
  let unsubscribe: (() => void) | null;

  beforeEach(() => {
    fetchCalls = [];
    logoutResolvers = [];
    refreshQueue = [];
    events = [];
    unsubscribe = null;

    vi.stubGlobal("window", { localStorage: memoryStorage() });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: { body?: unknown }) => {
        let body: unknown;
        try {
          body = init?.body ? JSON.parse(init.body as string) : undefined;
        } catch {
          body = init?.body;
        }
        const u = String(url);
        fetchCalls.push({ url: u, body });
        if (u.includes("/api/v1/auth/logout/")) {
          return new Promise((resolve) => {
            logoutResolvers.push(resolve);
          });
        }
        if (u.includes("/api/v1/auth/refresh/")) {
          return new Promise((resolve, reject) => {
            refreshQueue.push({ resolve, reject });
          });
        }
        throw new Error(`unexpected fetch in test: ${u}`);
      }),
    );
  });

  afterEach(() => {
    unsubscribe?.();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function newClient() {
    const client = new SpineClient({ apiUrl: "http://test.local", auth: { persistSession: true } });
    const sub = client.auth.onAuthStateChange((event, session) => {
      events.push({ event, session });
    });
    unsubscribe = () => sub.data.subscription.unsubscribe();
    return client;
  }

  it("same-user re-login during a pending logout keeps the newer session", async () => {
    const client = newClient();
    await client.auth.setSession(makeSession("user-a", "a1"));

    const pending = client.auth.signOut();
    expect(fetchCalls.filter((c) => c.url.includes("/auth/logout/"))).toHaveLength(1);

    // Same user signs in again with fresh tokens while the logout is in flight.
    await client.auth.setSession(makeSession("user-a", "a2"));
    events.length = 0;

    logoutResolvers[0]!(okResponse());
    const result = await pending;

    expect(result.error).toBeNull();
    expect(getStoredSession()?.access_token).toBe("access-a2");
    expect(events.some((e) => e.event === "SIGNED_OUT")).toBe(false);
  });

  it("stale refresh success does not overwrite a newer session", async () => {
    const client = newClient();
    await client.auth.setSession(makeSession("user-a", "a1"));

    const pending = client.auth.refreshSession();
    expect(refreshQueue).toHaveLength(1);

    await client.auth.setSession(makeSession("user-b", "b1"));
    events.length = 0;

    // Old refresh for A succeeds after B signed in.
    refreshQueue[0]!.resolve(okResponse(makeSession("user-a", "a2")));
    const refreshed = await pending;

    expect(refreshed).toBe(false);
    expect(getStoredSession()?.access_token).toBe("access-b1");
    expect(getStoredSession()?.user?.id).toBe("user-b");
    expect(events.some((e) => e.event === "TOKEN_REFRESHED")).toBe(false);
    expect(events.some((e) => e.event === "SIGNED_OUT")).toBe(false);
  });

  it("stale refresh failure does not sign out a newer session", async () => {
    const client = newClient();
    await client.auth.setSession(makeSession("user-a", "a1"));

    const pending = client.auth.refreshSession();
    expect(refreshQueue).toHaveLength(1);

    await client.auth.setSession(makeSession("user-b", "b1"));
    events.length = 0;

    // Old refresh for A fails after B signed in.
    refreshQueue[0]!.resolve(errResponse(401));
    const refreshed = await pending;

    expect(refreshed).toBe(false);
    expect(getStoredSession()?.access_token).toBe("access-b1");
    expect(getStoredSession()?.user?.id).toBe("user-b");
    expect(events.some((e) => e.event === "SIGNED_OUT")).toBe(false);
  });

  it("concurrent refreshes for different generations do not share a promise", async () => {
    const client = newClient();
    await client.auth.setSession(makeSession("user-a", "a1"));

    const first = client.auth.refreshSession();
    expect(refreshQueue).toHaveLength(1);

    // Session changes; a second refresh must start its own operation.
    await client.auth.setSession(makeSession("user-b", "b1"));
    const second = client.auth.refreshSession();

    expect(second).not.toBe(first);
    expect(refreshQueue).toHaveLength(2);
    expect(fetchCalls.filter((c) => c.url.includes("/auth/refresh/"))).toHaveLength(2);
    expect(
      fetchCalls
        .filter((c) => c.url.includes("/auth/refresh/"))
        .map((c) => (c.body as { refresh_token?: string })?.refresh_token),
    ).toEqual(["refresh-a1", "refresh-b1"]);

    refreshQueue[0]!.resolve(okResponse(makeSession("user-a", "a2")));
    await expect(first).resolves.toBe(false);

    refreshQueue[1]!.resolve(okResponse(makeSession("user-b", "b2")));
    await expect(second).resolves.toBe(true);
    expect(getStoredSession()?.access_token).toBe("access-b2");
  });

  it("a stale tab cannot clear a session a second tab signed in during its logout", async () => {
    // Two independent clients share one localStorage, standing in for two tabs.
    const shared = memoryStorage();
    vi.stubGlobal("window", { localStorage: shared });
    const tabA = new SpineClient({ apiUrl: "http://test.local", auth: { persistSession: true } });
    const tabB = new SpineClient({ apiUrl: "http://test.local", auth: { persistSession: true } });

    await tabA.auth.setSession(makeSession("user-a", "a1"));
    const epochAfterA = parseInt(shared.getItem("spine-session-epoch") as string, 10);

    // Tab A begins logging out; the request is left in flight.
    const pendingLogout = tabA.auth.signOut();
    expect(fetchCalls.filter((c) => c.url.includes("/auth/logout/"))).toHaveLength(1);

    // Tab B signs in while tab A is still waiting on the network.
    await tabB.auth.setSession(makeSession("user-b", "b1"));
    const epochAfterB = parseInt(shared.getItem("spine-session-epoch") as string, 10);
    expect(epochAfterB).toBeGreaterThan(epochAfterA);

    // Tab A's logout resumes; it must observe the newer generation and stand down.
    logoutResolvers[0]!(okResponse());
    await pendingLogout;

    expect(getStoredSession()?.access_token).toBe("access-b1");
    expect(getStoredSession()?.user?.id).toBe("user-b");
  });
});
