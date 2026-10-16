// Server-side auth gate for `createServerFn` endpoints. Replaces the Supabase
// middleware: the bearer JWT is validated against the Django `/api/v1/auth/claims/`
// endpoint (Django is the source of truth), and a client pinned to that token
// is injected into the request context as `context.supabase`.

import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { SpineClient } from "./core";

export const requireSupabaseAuth = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const request = getRequest();

    if (!request?.headers) {
      throw new Error("Unauthorized: No request headers available");
    }

    const authHeader = request.headers.get("authorization");

    if (!authHeader) {
      throw new Error("Unauthorized: No authorization header provided");
    }

    if (!authHeader.startsWith("Bearer ")) {
      throw new Error("Unauthorized: Only Bearer tokens are supported");
    }

    const token = authHeader.replace("Bearer ", "");
    if (!token) {
      throw new Error("Unauthorized: No token provided");
    }

    if (token.split(".").length !== 3) {
      throw new Error("Unauthorized: Invalid token");
    }

    const client = new SpineClient({ auth: { token, persistSession: false } });

    const { data, error } = await client.auth.getClaims(token);
    if (error || !data?.claims) {
      throw new Error("Unauthorized: Invalid token");
    }

    const claims = data.claims as Record<string, unknown>;
    if (!claims?.["sub"]) {
      throw new Error("Unauthorized: No user ID found in token");
    }

    return next({
      context: {
        supabase: client,
        userId: claims["sub"] as string,
        claims,
      },
    });
  },
);
