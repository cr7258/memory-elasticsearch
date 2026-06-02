import { describe, expect, it } from "vitest";
import {
  buildFilterClauses,
  literalMemoryTextMatch,
  normalizeBm25Score,
  scoreHybridResults,
} from "../../src/retrieval/search.js";

describe("search helpers", () => {
  it("buildFilterClauses filters by user and metadata", () => {
    const filters = buildFilterClauses({
      userId: "u1",
      filters: { source: "OPENCLAW", workspace: "demo" },
    });

    expect(filters).toEqual([
      { term: { user_id: "u1" } },
      { term: { "metadata.source": "OPENCLAW" } },
      { term: { "metadata.workspace": "demo" } },
    ]);
  });

  it("normalizes BM25 scores", () => {
    const weak = normalizeBm25Score({ query: "openclaw memory", rawScore: 1 });
    const strong = normalizeBm25Score({ query: "openclaw memory", rawScore: 12 });

    expect(weak).toBeGreaterThan(0);
    expect(strong).toBeLessThan(1);
    expect(strong).toBeGreaterThan(weak);
  });

  it("requires literal text matches for destructive query deletes", () => {
    expect(literalMemoryTextMatch("memory-es-cli-test-1780165165", "memory-es-cli-test-1780165165 direct add memory")).toBe(true);
    expect(literalMemoryTextMatch("memory-es-cli-test-1780165165", "The Elasticsearch-only test passphrase is sapphire-lake-904")).toBe(false);
  });

  it("combines semantic and BM25 signals", () => {
    const ranked = scoreHybridResults({
      semantic: [
        { id: "semantic-only", score: 0.82, payload: { memory: "semantic" } },
        { id: "hybrid", score: 0.78, payload: { memory: "hybrid" } },
        { id: "below-threshold", score: 0.01, payload: { memory: "low" } },
      ],
      bm25Scores: new Map([
        ["hybrid", 0.85],
        ["keyword-only", 0.9],
      ]),
      keywordPayloads: new Map([
        ["keyword-only", { memory: "keyword" }],
      ]),
      threshold: 0.05,
      topK: 3,
    });

    expect(ranked.map((item) => item.id)).toEqual(["hybrid", "semantic-only", "keyword-only"]);
    expect(ranked[0].semantic).toBe(true);
    expect(ranked[0].keyword).toBe(true);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score ?? 0);
    expect(ranked[2].score).toBeGreaterThan(0);
  });
});
