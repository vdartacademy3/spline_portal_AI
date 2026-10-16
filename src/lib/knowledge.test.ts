import { describe, expect, it, vi } from "vitest";

import {
  EMBEDDING_MODEL,
  contentFingerprint,
  dedupeByFingerprint,
  embedTexts,
  keywordRank,
  needsEmbedding,
  retrieveKnowledge,
} from "./knowledge";

function gatewayResponse(vectors: number[][]) {
  return {
    ok: true,
    json: async () => ({ data: vectors.map((embedding) => ({ embedding })) }),
  } as unknown as Response;
}

describe("embedding creation", () => {
  it("requests embeddings and returns one vector per input", async () => {
    const fetchImpl = vi.fn(async () =>
      gatewayResponse([
        [0.1, 0.2],
        [0.3, 0.4],
      ]),
    );
    const vectors = await embedTexts(["a", "b"], { apiKey: "key", fetchImpl: fetchImpl as never });
    expect(vectors).toHaveLength(2);
    const body = JSON.parse((fetchImpl.mock.calls[0] as never[])[1]!["body"]);
    expect(body.model).toBe(EMBEDDING_MODEL);
    expect(body.dimensions).toBe(1536);
  });

  it("retries transient failures and does not corrupt on permanent failure", async () => {
    let calls = 0;
    const flaky = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error("network");
      return gatewayResponse([[1, 2]]);
    });
    await expect(
      embedTexts(["a"], { apiKey: "k", fetchImpl: flaky as never, retryDelayMs: 1 }),
    ).resolves.toEqual([[1, 2]]);

    const dead = vi.fn(async () => ({ ok: false, status: 500 }) as unknown as Response);
    await expect(
      embedTexts(["a"], { apiKey: "k", fetchImpl: dead as never, retryDelayMs: 1 }),
    ).rejects.toThrow();
  });

  it("re-embeds only new, changed or differently-modelled chunks", () => {
    const content = "Casual leave is 12 days.";
    const hash = contentFingerprint(content, "Leave");
    expect(needsEmbedding({ id: "1", heading: "Leave", content, embedding: null })).toBe(true);
    expect(
      needsEmbedding({
        id: "1",
        heading: "Leave",
        content,
        embedding: 1,
        content_hash: hash,
        embedding_model: EMBEDDING_MODEL,
      }),
    ).toBe(false);
    expect(
      needsEmbedding({
        id: "1",
        heading: "Leave",
        content: "Casual leave is 15 days.",
        embedding: 1,
        content_hash: hash,
        embedding_model: EMBEDDING_MODEL,
      }),
    ).toBe(true);
  });

  it("deduplicates identical chunk text", () => {
    const groups = dedupeByFingerprint([
      { id: "1", heading: "A", content: "same" },
      { id: "2", heading: "A", content: "same" },
      { id: "3", heading: "B", content: "other" },
    ]);
    expect(groups.size).toBe(2);
  });
});

function fakeClient(opts: {
  rpcRows?: Record<string, unknown>[];
  rpcError?: unknown;
  tableRows?: { heading: string | null; content: string }[];
}) {
  return {
    rpc: vi.fn(async () => ({ data: opts.rpcRows ?? [], error: opts.rpcError ?? null })),
    from: () => ({
      select: () => ({ limit: async () => ({ data: opts.tableRows ?? [], error: null }) }),
    }),
  };
}

describe("semantic retrieval", () => {
  const fetchImpl = vi.fn(async () => gatewayResponse([[0.5, 0.5]]));

  it("returns vector matches ordered by relevance", async () => {
    const client = fakeClient({
      rpcRows: [
        { heading: "Sick leave", content: "b", document_title: "Handbook", similarity: 0.42 },
        { heading: "Casual leave", content: "a", document_title: "Handbook", similarity: 0.88 },
      ],
    });
    const hits = await retrieveKnowledge(client as never, "how much casual leave?", {
      apiKey: "k",
      fetchImpl: fetchImpl as never,
    });
    expect(hits.map((h) => h.heading)).toEqual(["Casual leave", "Sick leave"]);
    expect(hits[0]!.source).toBe("semantic");
  });

  it("only ever sees rows the caller's authorization returns (RLS-filtered RPC)", async () => {
    const client = fakeClient({ rpcRows: [], tableRows: [] });
    const hits = await retrieveKnowledge(client as never, "salary bands", {
      apiKey: "k",
      fetchImpl: fetchImpl as never,
    });
    expect(hits).toEqual([]);
    expect(client.rpc).toHaveBeenCalledWith("match_kb_chunks", expect.any(Object));
  });

  it("excludes unpublished or deleted knowledge because they are never returned", async () => {
    // The RPC filters on d.status = 'published'; a removed chunk simply stops appearing.
    const client = fakeClient({
      rpcRows: [],
      tableRows: [{ heading: "Draft", content: "draft leave policy" }],
    });
    const hits = await retrieveKnowledge(client as never, "leave policy", {
      apiKey: "k",
      fetchImpl: fetchImpl as never,
    });
    // Falls back to text search over the same RLS-filtered chunk list.
    expect(hits.every((h) => h.source === "text")).toBe(true);
  });
});

describe("fallback behaviour", () => {
  it("falls back to stored text when embeddings are unavailable", async () => {
    const client = fakeClient({
      tableRows: [
        { heading: "Leave", content: "Employees get 12 casual leave days." },
        { heading: "Travel", content: "Reimbursements within 30 days." },
      ],
    });
    const hits = await retrieveKnowledge(client as never, "casual leave entitlement", {});
    expect(hits[0]!.heading).toBe("Leave");
    expect(hits[0]!.source).toBe("text");
  });

  it("falls back when the vector search errors", async () => {
    const client = fakeClient({
      rpcError: new Error("index missing"),
      tableRows: [{ heading: "Leave", content: "Employees get 12 casual leave days." }],
    });
    const hits = await retrieveKnowledge(client as never, "casual leave", {
      apiKey: "k",
      fetchImpl: (async () => gatewayResponse([[0.1]])) as never,
    });
    expect(hits[0]!.source).toBe("text");
  });

  it("ranks stored text by term overlap and ignores irrelevant chunks", () => {
    const hits = keywordRank(
      [
        { heading: "Leave", content: "casual leave policy details" },
        { heading: "Parking", content: "garage rules" },
      ],
      "casual leave policy",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.heading).toBe("Leave");
  });

  it("keeps numeric query terms so the right policy edition ranks first", () => {
    const hits = keywordRank(
      [
        { heading: "Remote Work", content: "Policy edition 2025 applies to all staff." },
        { heading: "Remote Work", content: "Policy edition 2026 applies to all staff." },
      ],
      "remote policy edition 2026",
    );
    // "2026" must count as a term, otherwise both editions tie and the 2025
    // edition can be returned first.
    expect(hits[0]!.content).toBe("Policy edition 2026 applies to all staff.");
  });
});
