import { afterEach, describe, expect, it, vi } from "vitest";
import { JinaReranker } from "../../src/retrieval/reranker.js";

describe("JinaReranker", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requires an API key", async () => {
    const reranker = new JinaReranker({
      enabled: true,
      provider: "jina",
      baseUrl: "https://api.jina.ai",
      model: "jina-reranker-v3",
    });

    await expect(
      reranker.rerank({ query: "typescript", documents: ["User prefers TypeScript"], topN: 1 }),
    ).rejects.toThrow(/JINA_API_KEY/);
  });

  it("calls the Jina rerank endpoint and normalizes valid results", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toEqual({
        model: "jina-reranker-v3",
        query: "typescript",
        top_n: 2,
        documents: ["A", "B", "C"],
        return_documents: false,
      });
      return new Response(JSON.stringify({
        results: [
          { index: 2, relevance_score: 0.9 },
          { index: "bad", relevance_score: 0.5 },
          { index: 0, relevance_score: "0.4" },
        ],
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const reranker = new JinaReranker({
      enabled: true,
      provider: "jina",
      baseUrl: "https://api.jina.ai/",
      apiKey: "jina-key",
      model: "jina-reranker-v3",
    });

    const results = await reranker.rerank({ query: "typescript", documents: ["A", "B", "C"], topN: 2 });

    expect(fetchMock).toHaveBeenCalledWith("https://api.jina.ai/v1/rerank", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ authorization: "Bearer jina-key" }),
    }));
    expect(results).toEqual([
      { index: 2, relevance_score: 0.9 },
      { index: 0, relevance_score: 0.4 },
    ]);
  });
});
