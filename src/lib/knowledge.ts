/**
 * Knowledge retrieval core for Spine AI.
 *
 * Pure, dependency-light helpers so embedding generation, semantic retrieval,
 * ranking and the stored-text fallback can be unit tested without a server runtime.
 * Authorization is NOT re-implemented here: every database call made through this
 * module uses the caller's own Supabase client, so row level security decides what
 * the user may see, both for the vector search RPC and for the text fallback.
 */

export const EMBEDDING_MODEL = "google/gemini-embedding-2";
export const EMBEDDING_DIMENSIONS = 1536;
const EMBEDDINGS_URL = "https://ai.gateway.lovable.dev/v1/embeddings";

export type KnowledgeHit = {
  heading: string;
  content: string;
  documentTitle?: string | null;
  similarity: number | null;
  source: "semantic" | "text";
};

/** Stable fingerprint of a chunk's text, used to avoid duplicate/stale embeddings. */
export function contentFingerprint(content: string, heading?: string | null): string {
  const input = `${heading ?? ""}\u0000${content}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c + 1, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}:${input.length}`;
}

export type EmbeddableChunk = {
  id: string;
  heading: string | null;
  content: string;
  content_hash?: string | null;
  embedding_model?: string | null;
  embedding?: unknown;
};

/** A chunk needs (re)embedding when it has none, was embedded by another model, or its text changed. */
export function needsEmbedding(chunk: EmbeddableChunk, model = EMBEDDING_MODEL): boolean {
  if (!chunk.content?.trim()) return false;
  if (chunk.embedding === null || chunk.embedding === undefined) return true;
  if (chunk.embedding_model !== model) return true;
  return chunk.content_hash !== contentFingerprint(chunk.content, chunk.heading);
}

/** Group identical texts so the same content is embedded only once per sync. */
export function dedupeByFingerprint<T extends EmbeddableChunk>(chunks: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const chunk of chunks) {
    const key = contentFingerprint(chunk.content, chunk.heading);
    const list = groups.get(key);
    if (list) list.push(chunk);
    else groups.set(key, [chunk]);
  }
  return groups;
}

export type FetchLike = typeof fetch;

/** Generate embeddings via the Lovable AI gateway, with bounded retries on transient failures. */
export async function embedTexts(
  texts: string[],
  options: { apiKey: string; fetchImpl?: FetchLike; retries?: number; retryDelayMs?: number } = {
    apiKey: "",
  },
): Promise<number[][]> {
  if (!texts.length) return [];
  if (!options.apiKey) throw new Error("AI is not configured");
  const doFetch = options.fetchImpl ?? fetch;
  const retries = options.retries ?? 2;
  const delay = options.retryDelayMs ?? 400;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await doFetch(EMBEDDINGS_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: texts,
          dimensions: EMBEDDING_DIMENSIONS,
        }),
      });
      if (!res.ok) throw new Error(`Embedding request failed (${res.status})`);
      const json = (await res.json()) as { data?: { embedding: number[] }[] };
      const vectors = (json.data ?? []).map((d) => d.embedding);
      if (vectors.length !== texts.length) throw new Error("Embedding response was incomplete");
      return vectors;
    } catch (error) {
      lastError = error;
      if (attempt < retries) await new Promise((r) => setTimeout(r, delay * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Embedding generation failed");
}

/** Stored-text ranking: the safe fallback when embeddings or vector search are unavailable. */
export function keywordRank(
  chunks: { heading: string | null; content: string }[],
  question: string,
  limit = 3,
): KnowledgeHit[] {
  const terms = question
    .toLowerCase()
    // Digits are meaningful search terms (policy editions/years, day counts,
    // version numbers). Splitting on `[^a-z]+` treated them as delimiters and
    // silently dropped them, so a query naming a year tied every edition and the
    // wrong one could be returned first. Keep digits inside terms.
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3);
  return chunks
    .map((c) => ({
      heading: c.heading ?? "Policy",
      content: c.content,
      similarity: null,
      source: "text" as const,
      score: terms.filter((t) => `${c.heading ?? ""} ${c.content}`.toLowerCase().includes(t))
        .length,
    }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score: _score, ...hit }) => hit);
}

type MatchRow = {
  heading: string | null;
  content: string;
  document_title: string | null;
  similarity: number | null;
};

type MinimalClient = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  from: (table: string) => {
    select: (cols: string) => {
      limit: (n: number) => Promise<{ data: unknown; error: unknown }>;
    };
  };
};

/**
 * Retrieve knowledge for a question.
 * 1. Embed the question, then run the pgvector RPC as the caller (RLS filters the rows).
 * 2. On any failure — no API key, embedding error, RPC error, or no matches — fall back
 *    to stored-text ranking over the same RLS-filtered chunks.
 */
export async function retrieveKnowledge(
  supabase: MinimalClient,
  question: string,
  options: { apiKey?: string; limit?: number; fetchImpl?: FetchLike } = {},
): Promise<KnowledgeHit[]> {
  const limit = options.limit ?? 3;

  if (options.apiKey) {
    try {
      const [vector] = await embedTexts([question], {
        apiKey: options.apiKey,
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
        retries: 1,
      });
      if (vector) {
        const { data, error } = await supabase.rpc("match_kb_chunks", {
          query_embedding: JSON.stringify(vector),
          match_count: limit,
          similarity_threshold: 0.15,
        });
        if (!error && Array.isArray(data) && data.length) {
          return (data as MatchRow[])
            .map((row) => ({
              heading: row.heading ?? row.document_title ?? "Policy",
              content: row.content,
              documentTitle: row.document_title ?? null,
              similarity: typeof row.similarity === "number" ? row.similarity : null,
              source: "semantic" as const,
            }))
            .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
        }
      }
    } catch {
      // fall through to stored-text retrieval
    }
  }

  const { data } = await supabase.from("kb_chunks").select("heading, content").limit(50);
  return keywordRank(
    (data as { heading: string | null; content: string }[]) ?? [],
    question,
    limit,
  );
}
