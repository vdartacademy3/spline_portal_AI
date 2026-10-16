import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  EMBEDDING_MODEL,
  contentFingerprint,
  dedupeByFingerprint,
  embedTexts,
  needsEmbedding,
  type EmbeddableChunk,
} from "@/lib/knowledge";

async function assertKnowledgeManager(context: { supabase: any; userId: string }) {
  const { data: roleRows } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId);
  const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
  if (roles.includes("super_admin")) return;
  const { data: perms } = await context.supabase
    .from("role_permissions")
    .select("permission_code")
    .in("role", (roles.length ? roles : ["employee"]) as string[]);
  const granted = new Set((perms ?? []).map((p: { permission_code: string }) => p.permission_code));
  if (!granted.has("manage_knowledge")) {
    throw new Error("You are not authorised to manage the knowledge base.");
  }
}

/** Indexing status for the knowledge base (admin-facing only). */
export const knowledgeIndexStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertKnowledgeManager(context as never);
    const { data, error } = await context.supabase
      .from("kb_chunks")
      .select("id, heading, content, content_hash, embedding_model, embedded_at");
    if (error) throw new Error("Unable to read the knowledge index.");
    const chunks = (data ?? []) as (EmbeddableChunk & { embedded_at: string | null })[];
    const pending = chunks.filter((c) =>
      needsEmbedding({ ...c, embedding: c.embedded_at ? 1 : null }),
    ).length;
    return {
      total: chunks.length,
      indexed: chunks.length - pending,
      pending,
      model: EMBEDDING_MODEL,
    };
  });

/**
 * Generate or refresh embeddings for knowledge chunks.
 * Retryable and idempotent: identical text is embedded once, a failed batch leaves the
 * knowledge record untouched (only the embedding columns are ever written), and rerunning
 * picks up whatever is still missing or stale.
 */
export const syncKnowledgeEmbeddings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({ documentId: z.string().uuid().optional(), force: z.boolean().default(false) })
      .default({ force: false })
      .parse(data ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertKnowledgeManager(context as never);

    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("AI is not configured, so knowledge cannot be indexed.");

    let query = context.supabase
      .from("kb_chunks")
      .select("id, heading, content, content_hash, embedding_model, embedded_at");
    if (data.documentId) query = query.eq("document_id", data.documentId);
    const { data: rows, error } = await query;
    if (error) throw new Error("Unable to read the knowledge base.");

    const chunks = ((rows ?? []) as (EmbeddableChunk & { embedded_at: string | null })[]).map(
      (c) => ({
        ...c,
        embedding: c.embedded_at ? 1 : null,
      }),
    );
    const todo = data.force
      ? chunks.filter((c) => c.content?.trim())
      : chunks.filter((c) => needsEmbedding(c));
    if (!todo.length) return { embedded: 0, failed: 0, pending: 0, model: EMBEDDING_MODEL };

    const groups = [...dedupeByFingerprint(todo).entries()];
    let embedded = 0;
    let failed = 0;

    for (let i = 0; i < groups.length; i += 16) {
      const batch = groups.slice(i, i + 16);
      let vectors: number[][];
      try {
        vectors = await embedTexts(
          batch.map(([, group]) =>
            `${group[0]!.heading ?? ""}\n${group[0]!.content}`.slice(0, 8000),
          ),
          { apiKey },
        );
      } catch {
        failed += batch.reduce((n, [, group]) => n + group.length, 0);
        continue;
      }

      for (let b = 0; b < batch.length; b += 1) {
        const [hash, group] = batch[b]!;
        const vector = vectors[b];
        if (!vector) {
          failed += group.length;
          continue;
        }
        for (const chunk of group) {
          const { error: updateError } = await context.supabase
            .from("kb_chunks")
            .update({
              embedding: JSON.stringify(vector),
              embedding_model: EMBEDDING_MODEL,
              content_hash: contentFingerprint(chunk.content, chunk.heading),
              embedded_at: new Date().toISOString(),
            } as never)
            .eq("id", chunk.id);
          if (updateError) failed += 1;
          else embedded += 1;
        }
      }
    }

    return {
      embedded,
      failed,
      pending: Math.max(0, todo.length - embedded),
      model: EMBEDDING_MODEL,
    };
  });
