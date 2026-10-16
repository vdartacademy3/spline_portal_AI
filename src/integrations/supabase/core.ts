/* eslint-disable @typescript-eslint/no-explicit-any */
// Spine API compat core — a small PostgREST/GoTrue-shaped client that speaks to
// the local Django backend (env: VITE_API_URL / API_URL) instead of Supabase.
//
// The public `supabase`/`supabaseAdmin` exports in client.ts / client.server.ts
// are built on top of this. QueryBuilders are thenables: awaiting one produces
// a discriminated `{ data, error, count, status }` union — checking `error`
// narrows `data` to non-null exactly like `@supabase/supabase-js`.

import type { Database } from "./types";
import type { Session, User } from "./session-types";

export type AuthChangeEvent =
  | "INITIAL_SESSION"
  | "SIGNED_IN"
  | "SIGNED_OUT"
  | "TOKEN_REFRESHED"
  | "USER_UPDATED"
  | "PASSWORD_RECOVERY";

type Tables = Database["public"]["Tables"];
export type TableName = keyof Tables & string;
type RowOf<K extends string> = K extends TableName ? Tables[K]["Row"] : Record<string, unknown>;

/** Discriminated result — `if (error) throw error` narrows `data`. */
export type Result<T> =
  | { data: T; error: null; count: number | null; status: number }
  | { data: null; error: ApiError; count: number | null; status: number };

/** Un-typed RPC result (mirrors how the app consumes rpc payloads). */
export type RpcResult =
  | { data: any; error: null; count: null; status: number }
  | { data: null; error: ApiError; count: null; status: number };

export type AdminUser = {
  id: string;
  email: string | null;
  phone?: string | null;
  created_at?: string | null;
  last_sign_in_at?: string | null;
  app_metadata?: Record<string, unknown> | null;
  user_metadata?: Record<string, unknown> | null;
};

const SESSION_KEY = "spine-session";
const SESSION_EPOCH_KEY = "spine-session-epoch";

export function resolveApiBase(): string {
  let base = "";
  if (typeof import.meta !== "undefined" && import.meta.env && import.meta.env["VITE_API_URL"]) {
    base = import.meta.env["VITE_API_URL"] as string;
  } else if (typeof process !== "undefined" && process.env && process.env["API_URL"]) {
    base = process.env["API_URL"] as string;
  }
  return (base || "http://127.0.0.1:8000").replace(/\/+$/, "");
}

export class ApiError extends Error {
  constructor(
    message: string,
    public code = "",
    public details: unknown = null,
    public hint: unknown = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// --------------------------------------------------------------------------
// session persistence (browser only) + auth-state listeners
// --------------------------------------------------------------------------

type AuthListener = (event: AuthChangeEvent, session: Session | null) => void;

const authListeners = new Set<AuthListener>();

function canStore(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function getStoredSession(): Session | null {
  if (!canStore()) return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (!parsed || typeof parsed.access_token !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function storeSession(session: Session): void {
  if (!canStore()) return;
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // storage unavailable (e.g. privacy mode) — session lives in memory only
  }
}

export function clearStoredSession(): void {
  if (!canStore()) return;
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

export function emitAuth(event: AuthChangeEvent, session: Session | null): void {
  for (const listener of authListeners) {
    try {
      listener(event, session);
    } catch {
      // a listener must never break the emitter
    }
  }
}

export function onAuthStateChange(listener: AuthListener): {
  data: { subscription: { unsubscribe: () => void } };
} {
  authListeners.add(listener);
  // mirror supabase: each subscription immediately receives the current state
  queueMicrotask(() => {
    try {
      listener("INITIAL_SESSION", getStoredSession());
    } catch {
      // ignore
    }
  });
  const unsubscribe = () => {
    authListeners.delete(listener);
  };
  return { data: { subscription: { unsubscribe } } };
}

// --------------------------------------------------------------------------
// raw HTTP plumbing
// --------------------------------------------------------------------------

function parseErrorBody(body: unknown, status: number): ApiError {
  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    const message =
      typeof obj["message"] === "string"
        ? (obj["message"] as string)
        : `HTTP ${status}: request failed`;
    return new ApiError(
      message,
      typeof obj["code"] === "string" ? (obj["code"] as string) : "",
      obj["details"] ?? null,
      obj["hint"] ?? null,
    );
  }
  return new ApiError(`HTTP ${status}: request failed`, "", null, null);
}

function encodeQuery(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `(${value.map((v) => String(v)).join(",")})`;
  return String(value);
}

async function rawFetch(method: string, url: string, body?: unknown, headers?: Headers) {
  const init: RequestInit = { method };
  if (headers) init.headers = headers;
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    if (!init.headers) init.headers = new Headers();
    if (!(init.headers as Headers).has("Content-Type")) {
      (init.headers as Headers).set("Content-Type", "application/json");
    }
  }
  return fetch(url, init);
}

export class SpineClient<Db = Database> {
  readonly apiUrl: string;
  readonly persistAuth: boolean;
  readonly auth: AuthApi;
  readonly storage: StorageApi;

  /** Explicit bearer (service role, or a user token pinned by middleware). */
  private bearerToken: string | null;

  constructor(opts: { apiUrl?: string; auth?: { token?: string; persistSession?: boolean } } = {}) {
    this.apiUrl = (opts.apiUrl || resolveApiBase()).replace(/\/+$/, "");
    this.persistAuth = opts.auth?.persistSession !== false;
    this.bearerToken = opts.auth?.token ?? null;
    this.auth = new AuthApi(this);
    this.storage = new StorageApi(this);
  }

  currentToken(): string | null {
    if (this.bearerToken) return this.bearerToken;
    return getStoredSession()?.access_token ?? null;
  }

  from<K extends string>(table: K): QueryBuilder<RowOf<K>, RowOf<K>[]> {
    return new QueryBuilder<RowOf<K>, RowOf<K>[]>(this, table);
  }

  rpc(fn: string, args?: Record<string, unknown>): Promise<RpcResult> {
    return callRpc(this, fn, args);
  }
}

export async function callRpc(
  client: SpineClient,
  fn: string,
  args?: Record<string, unknown>,
): Promise<RpcResult> {
  const headers = new Headers({ "Content-Type": "application/json" });
  const token = client.currentToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  try {
    const res = await fetch(`${client.apiUrl}/api/v1/rpc/${fn}/`, {
      method: "POST",
      headers,
      body: JSON.stringify(args ?? {}),
    });
    if (!res.ok) {
      const text = await res.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }
      return {
        data: null,
        error: parseErrorBody(parsed, res.status),
        count: null,
        status: res.status,
      };
    }
    const body = await res.json().catch(() => null);
    return { data: body, error: null, count: null, status: res.status };
  } catch (err) {
    return {
      data: null,
      error: new ApiError(err instanceof Error ? err.message : String(err)),
      count: null,
      status: 0,
    };
  }
}

// --------------------------------------------------------------------------
// table builder
// --------------------------------------------------------------------------

export class QueryBuilder<TRow = Record<string, unknown>, TResult = TRow[]> {
  private promise: Promise<Result<TResult>> | null = null;

  private opMethod: "GET" | "POST" | "PATCH" | "DELETE" | "HEAD" = "GET";
  private selectCols: string | undefined;
  private payload: unknown;
  private filters: string[] = [];
  private orExprs: string[] = [];
  private andExprs: string[] = [];
  private orderBySpec: string | undefined;
  private offsetValue: number | undefined;
  private limitValue: number | undefined;
  private countExact = false;
  private headOnly = false;
  private rowMode: "array" | "single" | "maybe" = "array";
  private onConflictSpec: string | undefined;
  private preferReturn = false;
  private resolution: string | undefined;

  constructor(
    private client: SpineClient,
    private table: string,
  ) {}

  private fork<TNext>(): QueryBuilder<TRow, TNext> {
    const next = new QueryBuilder<TRow, TNext>(this.client, this.table);
    next.opMethod = this.opMethod;
    next.selectCols = this.selectCols;
    next.payload = this.payload;
    next.filters = [...this.filters];
    next.orExprs = [...this.orExprs];
    next.andExprs = [...this.andExprs];
    next.orderBySpec = this.orderBySpec;
    next.offsetValue = this.offsetValue;
    next.limitValue = this.limitValue;
    next.countExact = this.countExact;
    next.headOnly = this.headOnly;
    next.rowMode = this.rowMode;
    next.onConflictSpec = this.onConflictSpec;
    next.preferReturn = this.preferReturn;
    next.resolution = this.resolution;
    return next;
  }

  // --- chaining (return `this`, keep TResult) ------------------------------

  select(
    columns?: string,
    opts?: { count?: "exact" | "planned"; head?: boolean },
  ): QueryBuilder<TRow, TRow[]> {
    const next = this.fork<TRow[]>();
    if (opts?.head) {
      next.opMethod = "HEAD";
      next.headOnly = true;
    }
    if (opts?.count === "exact") next.countExact = true;
    next.preferReturn = true;
    if (columns) next.selectCols = columns;
    return next;
  }

  eq(column: string, value: unknown): this {
    this.filters.push(`${column}=eq.${encodeQuery(value)}`);
    return this;
  }

  neq(column: string, value: unknown): this {
    this.filters.push(`${column}=neq.${encodeQuery(value)}`);
    return this;
  }

  gt(column: string, value: unknown): this {
    this.filters.push(`${column}=gt.${encodeQuery(value)}`);
    return this;
  }

  gte(column: string, value: unknown): this {
    this.filters.push(`${column}=gte.${encodeQuery(value)}`);
    return this;
  }

  lt(column: string, value: unknown): this {
    this.filters.push(`${column}=lt.${encodeQuery(value)}`);
    return this;
  }

  lte(column: string, value: unknown): this {
    this.filters.push(`${column}=lte.${encodeQuery(value)}`);
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.filters.push(`${column}=in.${encodeQuery(values)}`);
    return this;
  }

  is(column: string, value: unknown): this {
    this.filters.push(`${column}=is.${encodeQuery(value)}`);
    return this;
  }

  ilike(column: string, pattern: string): this {
    this.filters.push(`${column}=ilike.${pattern}`);
    return this;
  }

  like(column: string, pattern: string): this {
    this.filters.push(`${column}=like.${pattern}`);
    return this;
  }

  not(column: string, value: unknown): this {
    this.filters.push(`${column}=not.${encodeQuery(value)}`);
    return this;
  }

  /** PostgREST `or=(...)` — feed the raw filter grammar (e.g. `a.eq.1,b.is.null`). */
  or(exprs: string): this {
    this.orExprs.push(`(${exprs})`);
    return this;
  }

  /** Grouped AND — maps to an `and=` parameter (harmless if unsupported). */
  and(exprs: string): this {
    this.andExprs.push(`(${exprs})`);
    return this;
  }

  order(column: string, opts?: { ascending?: boolean; nullsFirst?: boolean }): this {
    const asc = opts?.ascending !== false;
    const parts = [column, asc ? "asc" : "desc"];
    if (opts?.nullsFirst) parts.push("nullsfirst");
    this.orderBySpec = parts.join(".");
    return this;
  }

  limit(count: number): this {
    this.limitValue = count;
    return this;
  }

  offset(start: number): this {
    this.offsetValue = start;
    return this;
  }

  range(from: number, to: number): this {
    this.offsetValue = from;
    this.limitValue = to - from + 1;
    return this;
  }

  onConflict(columns: string): this {
    this.onConflictSpec = columns;
    return this;
  }

  returns(_format?: string): this {
    this.preferReturn = true;
    return this;
  }

  // --- terminal chain steps (change TResult) ------------------------------

  insert(payload: unknown): QueryBuilder<TRow, null> {
    const next = this.fork<null>();
    next.opMethod = "POST";
    next.payload = payload;
    next.onConflictSpec = undefined;
    next.resolution = undefined;
    return next;
  }

  update(payload: unknown): QueryBuilder<TRow, null> {
    const next = this.fork<null>();
    next.opMethod = "PATCH";
    next.payload = payload;
    next.onConflictSpec = undefined;
    next.resolution = undefined;
    return next;
  }

  upsert(
    payload: unknown,
    opts?: { onConflict?: string; ignoreDuplicates?: boolean },
  ): QueryBuilder<TRow, null> {
    const next = this.fork<null>();
    next.opMethod = "POST";
    next.payload = payload;
    next.onConflictSpec = opts?.onConflict;
    next.resolution = opts?.ignoreDuplicates ? "ignore-duplicates" : "merge-duplicates";
    return next;
  }

  delete(): QueryBuilder<TRow, null> {
    const next = this.fork<null>();
    next.opMethod = "DELETE";
    next.onConflictSpec = undefined;
    next.resolution = undefined;
    return next;
  }

  single(): QueryBuilder<TRow, TRow> {
    const next = this.fork<TRow>();
    next.rowMode = "single";
    next.preferReturn = true;
    return next;
  }

  maybeSingle(): QueryBuilder<TRow, TRow | null> {
    const next = this.fork<TRow | null>();
    next.rowMode = "maybe";
    next.preferReturn = true;
    return next;
  }

  // --- execution ----------------------------------------------------------

  private buildParams(): URLSearchParams {
    const params = new URLSearchParams();
    if (this.selectCols) params.set("select", this.selectCols);
    for (const f of this.filters) {
      const idx = f.indexOf("=");
      params.append(f.slice(0, idx), f.slice(idx + 1));
    }
    for (const expr of this.orExprs) params.append("or", expr);
    for (const expr of this.andExprs) params.append("and", expr);
    if (this.orderBySpec) params.set("order", this.orderBySpec);
    if (this.limitValue != null) params.set("limit", String(this.limitValue));
    if (this.offsetValue != null) params.set("offset", String(this.offsetValue));
    if (this.opMethod === "POST" && this.onConflictSpec)
      params.set("on_conflict", this.onConflictSpec);
    return params;
  }

  private headers(): Headers {
    const headers = new Headers();
    const prefer: string[] = [];
    if (this.countExact) prefer.push("count=exact");
    if (this.preferReturn) prefer.push("return=representation");
    if (this.resolution) prefer.push(`resolution=${this.resolution}`);
    if (prefer.length) headers.set("Prefer", prefer.join(", "));
    return headers;
  }

  private async rawCall(method: string, path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    const token = this.client.currentToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const payload = init.body as string | undefined;
    let res = await rawFetch(method, path, payload, headers);

    if (res.status === 401 && this.client.persistAuth && getStoredSession()?.refresh_token) {
      // Capture the session generation at the time we saw 401 for the token that
      // sent this request. If the session changes while awaiting refresh, we must
      // not retry this request under the new session.
      const epochBefore = (this.client.auth as any).loadStoredEpoch();
      const alreadyRefreshed = this.client.currentToken() !== token;
      const refreshed = alreadyRefreshed || (await this.client.auth.refreshSession());
      // Session changed during/after refresh — do not retry this stale request.
      const epochAfter = (this.client.auth as any).loadStoredEpoch();
      if (epochBefore !== epochAfter) {
        return res;
      }
      if (refreshed) {
        const retryHeaders = new Headers(headers);
        const tok = this.client.currentToken();
        if (tok) retryHeaders.set("Authorization", `Bearer ${tok}`);
        res = await rawFetch(method, path, payload, retryHeaders);
      }
    }
    return res;
  }

  private async run(): Promise<Result<TResult>> {
    const qs = this.buildParams().toString();
    const path = `${this.client.apiUrl}/api/v1/public/${this.table}/${qs ? `?${qs}` : ""}`;
    const headers = this.headers();
    const init: RequestInit = { headers };
    if (this.payload !== undefined) init.body = JSON.stringify(this.payload);

    const res = await this.rawCall(this.opMethod, path, init);

    if (!res.ok) {
      const text = await res.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }
      return {
        data: null,
        error: parseErrorBody(parsed, res.status),
        count: null,
        status: res.status,
      };
    }

    let count: number | null = null;
    const contentRange = res.headers.get("content-range");
    if (this.countExact && contentRange) {
      const total = contentRange.split("/")[1];
      if (total && total !== "*") count = Number(total);
    }

    if (this.opMethod === "HEAD") {
      return { data: null, error: null, count, status: res.status } as Result<TResult>;
    }

    const text = await res.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    const rows = (Array.isArray(body) ? body : []) as TRow[];

    if (this.rowMode === "single" || this.rowMode === "maybe") {
      if (rows.length > 1) {
        return {
          data: null,
          error: new ApiError(
            "JSON object requested, multiple (or no) rows returned",
            "PGRST116",
            null,
            null,
          ),
          count,
          status: res.status,
        };
      }
      return { data: (rows[0] ?? null) as TResult, error: null, count, status: res.status };
    }

    return { data: rows as TResult, error: null, count, status: res.status };
  }

  private result(): Promise<Result<TResult>> {
    if (!this.promise) this.promise = this.run();
    return this.promise;
  }

  then<R1 = Result<TResult>, R2 = never>(
    onfulfilled?: ((value: Result<TResult>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return this.result().then(onfulfilled, onrejected);
  }

  catch<R2 = never>(
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<Result<TResult> | R2> {
    return this.result().then(undefined, onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<Result<TResult>> {
    return this.result().finally(onfinally);
  }

  [Symbol.toStringTag] = "SpineQueryBuilder";
}

// --------------------------------------------------------------------------
// auth (GoTrue-compatible surface)
// --------------------------------------------------------------------------

export type SignInResult = Result<{ session: Session; user: User }>;
export type SignUpResult =
  { data: Record<string, unknown>; error: null } | { data: null; error: ApiError };
export type SessionResult = { data: { session: Session | null }; error: null };

export class AuthApi {
  /**
   * Monotonic session generation. Incremented whenever the active session is
   * replaced or ends (sign-in, sign-out, session replacement) -- never on a
   * normal token refresh, so a refresh cannot invalidate its own operation.
   * Async work captures this value and re-checks it after awaiting: if it moved,
   * the session that began the work is no longer current and must not store,
   * clear, or emit against the session that replaced it.
   */
  private sessionEpoch = 0;

  private loadStoredEpoch(): number {
    if (!canStore()) return this.sessionEpoch;
    try {
      const raw = window.localStorage.getItem(SESSION_EPOCH_KEY);
      if (!raw) return this.sessionEpoch;
      const n = parseInt(raw, 10);
      if (Number.isFinite(n) && n >= 0) return n;
    } catch {
      // ignore
    }
    return this.sessionEpoch;
  }

  private persistEpoch(n: number): void {
    this.sessionEpoch = n;
    if (!canStore()) return;
    try {
      window.localStorage.setItem(SESSION_EPOCH_KEY, String(n));
    } catch {
      // ignore
    }
  }

  private bumpEpoch(): void {
    // Base the increment on the *stored* generation, not this tab's cached copy:
    // another tab may already have advanced it, and writing `self.sessionEpoch + 1`
    // would move the shared counter backwards and defeat cross-tab detection.
    const current = this.loadStoredEpoch();
    const n = (this.sessionEpoch > current ? this.sessionEpoch : current) + 1;
    this.persistEpoch(n);
  }

  /**
   * In-flight refresh, shared by every concurrent 401 retry *for the same
   * session generation*. Guarantees one POST /auth/refresh/ per expiry event
   * instead of one per failed request, and never lets a refresh started for one
   * session be reused as the refresh for another.
   */
  private refreshInFlight: { epoch: number; promise: Promise<boolean> } | null = null;

  constructor(private client: SpineClient) {}

  async signInWithPassword(creds: { email: string; password: string }): Promise<SignInResult> {
    const res = await rawFetch("POST", `${this.client.apiUrl}/api/v1/auth/token/`, {
      grant_type: "password",
      email: creds.email,
      password: creds.password,
    });
    if (!res.ok) {
      const text = await res.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }
      return {
        data: null,
        error: parseErrorBody(parsed, res.status),
        count: null,
        status: res.status,
      };
    }
    const body = (await res.json()) as Record<string, unknown>;
    const session = this.sessionFromBody(body);
    if (!session) {
      return {
        data: null,
        error: new ApiError("The sign-in response did not include a session.", "", null, null),
        count: null,
        status: res.status,
      };
    }
    this.bumpEpoch();
    if (this.client.persistAuth) storeSession(session);
    emitAuth("SIGNED_IN", session);
    return { data: { session, user: session.user }, error: null, count: null, status: res.status };
  }

  async signUp(creds: {
    email: string;
    password: string;
    options?: { emailRedirectTo?: string; data?: Record<string, unknown> };
  }): Promise<SignUpResult> {
    const res = await rawFetch("POST", `${this.client.apiUrl}/api/v1/auth/signup/`, {
      email: creds.email,
      password: creds.password,
      email_redirect_to: creds.options?.emailRedirectTo,
      user_metadata: creds.options?.data ?? {},
    });
    if (!res.ok) {
      const text = await res.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }
      return { data: null, error: parseErrorBody(parsed, res.status) };
    }
    // Dev auto-confirm signs the user in immediately (matches Django signup flow).
    const body = (await res.json()) as Record<string, unknown>;
    const session = this.sessionFromBody(body);
    if (session) {
      this.bumpEpoch();
      if (this.client.persistAuth) storeSession(session);
      emitAuth("SIGNED_IN", session);
    }
    return { data: body, error: null };
  }

  async signOut(): Promise<{ error: ApiError | null }> {
    const token = this.client.currentToken();
    // Identity and generation this logout belongs to, captured before the
    // request. The generation catches a re-login by the same user (which an id
    // comparison alone cannot); the stored id catches a different user signing
    // in from another tab (which this tab's in-memory generation cannot see).
    const epoch = this.loadStoredEpoch();
    const userId = getStoredSession()?.user?.id ?? null;
    if (token) {
      try {
        await rawFetch("POST", `${this.client.apiUrl}/api/v1/auth/logout/`, {}, this.authHeaders());
      } catch {
        // ignore network problems — still clear locally
      }
      // A session established or ended while the request was in flight is not
      // this logout's to clear. Check both in-memory and persisted epoch.
      if (this.loadStoredEpoch() !== epoch) {
        this.sessionEpoch = epoch;
        return { error: null };
      }
      const current = getStoredSession();
      if (current && (current.user?.id ?? null) !== userId) {
        return { error: null };
      }
    }
    clearStoredSession();
    this.bumpEpoch();
    emitAuth("SIGNED_OUT", null);
    return { error: null };
  }

  async getSession(): Promise<SessionResult> {
    return { data: { session: getStoredSession() }, error: null };
  }

  async getClaims(
    token?: string,
  ): Promise<{ data: { claims: Record<string, unknown> | null }; error: ApiError | null }> {
    const useToken = token ?? this.client.currentToken();
    if (!useToken) return { data: { claims: null }, error: new ApiError("No token provided") };
    const res = await rawFetch("POST", `${this.client.apiUrl}/api/v1/auth/claims/`, {
      token: useToken,
    });
    if (!res.ok) {
      const text = await res.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }
      return { data: { claims: null }, error: parseErrorBody(parsed, res.status) };
    }
    const body = (await res.json()) as Record<string, unknown>;
    return { data: { claims: (body["claims"] as Record<string, unknown>) ?? null }, error: null };
  }

  async resetPasswordForEmail(
    email: string,
    opts?: { redirectTo?: string },
  ): Promise<{ data: Record<string, never> | null; error: ApiError | null }> {
    const res = await rawFetch("POST", `${this.client.apiUrl}/api/v1/auth/reset-password/`, {
      email,
      redirect_to: opts?.redirectTo,
    });
    if (!res.ok) {
      const text = await res.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }
      return { data: null, error: parseErrorBody(parsed, res.status) };
    }
    return { data: {}, error: null };
  }

  async setSession(
    session: Session,
  ): Promise<{ data: { session: Session }; error: null } | { data: null; error: ApiError }> {
    if (!session?.access_token) {
      return { data: null, error: new ApiError("Missing access_token") };
    }
    const sess = this.sessionFromBody(session as unknown as Record<string, unknown>) ?? session;
    this.bumpEpoch();
    if (this.client.persistAuth) storeSession(sess);
    emitAuth("SIGNED_IN", sess);
    return { data: { session: sess }, error: null };
  }

  async refreshSession(): Promise<boolean> {
    const epoch = this.loadStoredEpoch();
    const inFlight = this.refreshInFlight;
    if (inFlight && inFlight.epoch === epoch) {
      return inFlight.promise;
    }
    const promise = this.performRefresh(epoch);
    this.refreshInFlight = { epoch, promise };
    void promise.finally(() => {
      if (this.refreshInFlight?.promise === promise) this.refreshInFlight = null;
    });
    return promise;
  }

  /** Single caller. Uses rawFetch, so it can never recurse into the 401 retry. */
  private async performRefresh(epoch: number): Promise<boolean> {
    const session = getStoredSession();
    if (!session?.refresh_token) return false;
    // Any failure leaves a session we cannot use, so drop it rather than leaving
    // callers retrying with a dead token. Never throws: every caller sees false.
    // Every post-await step re-checks the generation: if the session was
    // replaced while the request was in flight, this refresh must not store its
    // credentials, emit a terminal event, or discard the newer session.
    try {
      const res = await rawFetch("POST", `${this.client.apiUrl}/api/v1/auth/refresh/`, {
        refresh_token: session.refresh_token,
      });
      const now = this.loadStoredEpoch();
      if (now !== epoch) {
        this.sessionEpoch = now;
        return false;
      }
      if (!res.ok) {
        this.discardSession();
        return false;
      }
      const body = (await res.json()) as Record<string, unknown>;
      const now2 = this.loadStoredEpoch();
      if (now2 !== epoch) {
        this.sessionEpoch = now2;
        return false;
      }
      const next = this.sessionFromBody(body);
      if (!next) {
        this.discardSession();
        return false;
      }
      if (this.client.persistAuth) storeSession(next);
      emitAuth("TOKEN_REFRESHED", next);
      return true;
    } catch {
      const nowC = this.loadStoredEpoch();
      if (nowC === epoch) this.discardSession();
      return false;
    }
  }

  private discardSession(): void {
    clearStoredSession();
    this.bumpEpoch();
    emitAuth("SIGNED_OUT", null);
  }

  getUser(): Promise<{ data: { user: User | null }; error: ApiError | null }> {
    return Promise.resolve({ data: { user: getStoredSession()?.user ?? null }, error: null });
  }

  onAuthStateChange(listener: (event: AuthChangeEvent, session: Session | null) => void): {
    data: { subscription: { unsubscribe: () => void } };
  } {
    return onAuthStateChange(listener);
  }

  admin = {
    listUsers: async (opts?: {
      page?: number;
      perPage?: number;
    }): Promise<{
      data: { users: AdminUser[]; total: number; page: number; perPage: number } | null;
      error: ApiError | null;
    }> => {
      const qs = new URLSearchParams();
      qs.set("page", String(opts?.page ?? 1));
      qs.set("per_page", String(opts?.perPage ?? 50));
      const res = await rawFetch(
        "GET",
        `${this.client.apiUrl}/api/v1/auth/admin/users/?${qs}`,
        undefined,
        this.authHeaders(),
      );
      if (!res.ok) {
        const text = await res.text();
        let parsed: unknown = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = null;
        }
        return { data: null, error: parseErrorBody(parsed, res.status) };
      }
      const body = (await res.json()) as {
        users: AdminUser[];
        total: number;
        page?: number;
        per_page?: number;
      };
      return {
        data: {
          users: Array.isArray(body.users) ? body.users : [],
          total: Number(body.total ?? body.users?.length ?? 0),
          page: Number(body.page ?? opts?.page ?? 1),
          perPage: Number(body.per_page ?? opts?.perPage ?? 50),
        },
        error: null,
      };
    },

    createUser: async (
      payload: Record<string, unknown>,
    ): Promise<{
      data: { user: AdminUser } | null;
      error: ApiError | null;
    }> => {
      const res = await rawFetch(
        "POST",
        `${this.client.apiUrl}/api/v1/auth/admin/users/`,
        payload,
        this.authHeaders(),
      );
      if (!res.ok) {
        const text = await res.text();
        let parsed: unknown = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = null;
        }
        return { data: null, error: parseErrorBody(parsed, res.status) };
      }
      const body = (await res.json()) as { user: AdminUser };
      return { data: { user: body.user }, error: null };
    },

    updateUserById: async (
      id: string,
      payload: Record<string, unknown>,
    ): Promise<{
      data: { user: AdminUser } | null;
      error: ApiError | null;
    }> => {
      const res = await rawFetch(
        "PUT",
        `${this.client.apiUrl}/api/v1/auth/admin/users/${encodeURIComponent(id)}/`,
        payload,
        this.authHeaders(),
      );
      if (!res.ok) {
        const text = await res.text();
        let parsed: unknown = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = null;
        }
        return { data: null, error: parseErrorBody(parsed, res.status) };
      }
      const body = (await res.json()) as { user: AdminUser };
      return { data: { user: body.user }, error: null };
    },

    deleteUser: async (id: string): Promise<{ error: ApiError | null }> => {
      const res = await rawFetch(
        "DELETE",
        `${this.client.apiUrl}/api/v1/auth/admin/users/${encodeURIComponent(id)}/`,
        undefined,
        this.authHeaders(),
      );
      if (!res.ok) {
        const text = await res.text();
        let parsed: unknown = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = null;
        }
        return { error: parseErrorBody(parsed, res.status) };
      }
      return { error: null };
    },
  };

  private authHeaders(): Headers {
    const headers = new Headers({ "Content-Type": "application/json" });
    const token = this.client.currentToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return headers;
  }

  private sessionFromBody(body: Record<string, unknown>): Session | null {
    if (!body || typeof body["access_token"] !== "string") return null;
    return {
      access_token: body["access_token"] as string,
      refresh_token: (body["refresh_token"] as string) ?? "",
      token_type: (body["token_type"] as string) ?? "bearer",
      expires_in: Number(body["expires_in"] ?? 3600),
      expires_at: typeof body["expires_at"] === "number" ? (body["expires_at"] as number) : null,
      user: (body["user"] as User) ?? ({ id: "" } as User),
    };
  }
}

// --------------------------------------------------------------------------
// storage (Supabase Storage client shape)
// --------------------------------------------------------------------------

type UploadResult = { data: { path: string }; error: null } | { data: null; error: ApiError };
type RemoveItem = { name: string; id: string; bucket_id: string };
type RemoveResult = { data: RemoveItem[]; error: null } | { data: null; error: ApiError };

export class StorageApi {
  constructor(private client: SpineClient) {}

  from(bucket: string): StorageBucket {
    return new StorageBucket(this.client, bucket);
  }
}

async function storageReq(
  client: SpineClient,
  path: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const headers = new Headers(init.headers ?? {});
  const token = client.currentToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let res: Response;
  try {
    res = await fetch(`${client.apiUrl}${path}`, { ...init, headers });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: { message: err instanceof Error ? err.message : String(err) },
    };
  }
  const text = await res.text().catch(() => "");
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { ok: res.ok, status: res.status, body: parsed };
}

export class StorageBucket {
  constructor(
    private client: SpineClient,
    private bucket: string,
  ) {}

  async upload(
    path: string,
    body: ArrayBuffer | Uint8Array | Blob | File | string,
    opts?: { contentType?: string; upsert?: boolean; cacheControl?: string },
  ): Promise<UploadResult> {
    const qs = new URLSearchParams({ upsert: opts?.upsert ? "true" : "false" });
    const headers = new Headers();
    if (opts?.contentType) headers.set("Content-Type", opts.contentType);
    if (opts?.cacheControl) headers.set("Cache-Control", opts.cacheControl);
    const res = await storageReq(
      this.client,
      `/api/v1/storage/object/${this.bucket}/${path}?${qs}`,
      { method: "PUT", headers, body: body as BodyInit },
    );
    if (!res.ok) return { data: null, error: parseErrorBody(res.body, res.status) };
    return { data: { path }, error: null };
  }

  async update(
    path: string,
    body: ArrayBuffer | Uint8Array | Blob | File | string,
    opts?: { contentType?: string },
  ): Promise<UploadResult> {
    return this.upload(path, body, { ...opts, upsert: true });
  }

  async remove(paths: string[]): Promise<RemoveResult> {
    const res = await storageReq(this.client, `/api/v1/storage/object/${this.bucket}/`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: paths }),
    });
    if (!res.ok) return { data: null, error: parseErrorBody(res.body, res.status) };
    const list = Array.isArray(res.body) ? res.body : [];
    return {
      data: list.map((b) => {
        const item = b as Record<string, unknown>;
        return {
          name: String(item["name"] ?? ""),
          id: String(item["id"] ?? ""),
          bucket_id: String(item["bucket_id"] ?? this.bucket),
        } satisfies RemoveItem;
      }),
      error: null,
    };
  }

  async createSignedUrl(
    path: string,
    expiresIn: number,
  ): Promise<
    | { data: { signedUrl: string; error: string | null }; error: null }
    | { data: null; error: ApiError }
  > {
    const res = await storageReq(
      this.client,
      `/api/v1/storage/object/sign/${this.bucket}/${path}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiresIn }),
      },
    );
    if (!res.ok) return { data: null, error: parseErrorBody(res.body, res.status) };
    const body = res.body as Record<string, unknown>;
    const relative = body["signedURL"];
    const signedUrl =
      typeof relative === "string" && relative.startsWith("/")
        ? `${this.client.apiUrl}${relative}`
        : String(relative ?? "");
    return { data: { signedUrl, error: null }, error: null };
  }

  async getPublicUrl(_path: string): Promise<{
    data: { publicUrl: string | null };
    error: ApiError | null;
  }> {
    // anonymous public access is intentionally disabled in this deployment
    return { data: { publicUrl: null }, error: null };
  }

  async download(path: string): Promise<{ data: Blob | null; error: ApiError | null }> {
    const res = await storageReq(this.client, `/api/v1/storage/object/${this.bucket}/${path}`);
    if (!res.ok) return { data: null, error: parseErrorBody(res.body, res.status) };
    try {
      const blobRes = await fetch(
        `${this.client.apiUrl}/api/v1/storage/object/${this.bucket}/${path}`,
      );
      if (!blobRes.ok)
        return { data: null, error: new ApiError(`download failed: ${blobRes.status}`) };
      return { data: await blobRes.blob(), error: null };
    } catch (err) {
      return { data: null, error: new ApiError(err instanceof Error ? err.message : String(err)) };
    }
  }

  async list(_opts?: unknown): Promise<{ data: unknown[]; error: ApiError | null }> {
    return { data: [], error: null };
  }
}
