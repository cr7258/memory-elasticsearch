import { afterEach, describe, expect, it, vi } from "vitest";
import { ElasticsearchMemoryStore } from "../../src/stores/elasticsearch.js";
import { parseConfig } from "../../src/config.js";

describe("ElasticsearchMemoryStore.search", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reranks the top-k hybrid candidates when Jina reranker is enabled", async () => {
    const config = parseConfig({
      topK: 2,
      openaiCompatible: {
        baseUrl: "https://api.example/v1",
        apiKey: "test-key",
        llmModel: "test-llm",
        embeddingModel: "test-embedding",
        embeddingDims: 3,
      },
      reranker: {
        enabled: true,
        apiKey: "${JINA_API_KEY}",
      },
    }, {
      env: { JINA_API_KEY: "jina-key" },
      username: "test-user",
    });
    const model = {
      config: config.openaiCompatible,
      embed: vi.fn(async () => [0.1, 0.2, 0.3]),
      completeJson: vi.fn(),
    };
    const store = new ElasticsearchMemoryStore({ config, model: model as any });
    vi.spyOn(store, "ensureIndex").mockResolvedValue(false);
    vi.spyOn(store, "request").mockImplementation(async (_path, options = {}) => {
      const body = options.body as any;
      if (body?.knn) {
        expect(body.knn.k).toBe(2);
        expect(body.size).toBe(2);
        return {
          hits: {
            hits: [
              { _id: "mem-a", _score: 0.9, _source: { memory: "General skincare advice." } },
              { _id: "mem-b", _score: 0.7, _source: { memory: "Sensitive skin products with aloe vera." } },
            ],
          },
        };
      }
      expect(body.size).toBe(2);
      return { hits: { hits: [] } };
    });
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.model).toBe("jina-reranker-v3");
      expect(body.documents).toEqual([
        "General skincare advice.",
        "Sensitive skin products with aloe vera.",
      ]);
      return new Response(JSON.stringify({
        results: [
          { index: 1, relevance_score: 0.99 },
          { index: 0, relevance_score: 0.2 },
        ],
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const results = await store.search("organic skincare for sensitive skin", { top_k: 2 });

    expect(results.map((result) => result.id)).toEqual(["mem-b", "mem-a"]);
    expect(results[0].score).toBe(0.99);
    expect(results[0].components?.rerank).toBe(0.99);
    expect(results[0].components?.original).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns hybrid ranking directly when reranker is disabled", async () => {
    const config = parseConfig({
      topK: 2,
      openaiCompatible: {
        baseUrl: "https://api.example/v1",
        apiKey: "test-key",
        llmModel: "test-llm",
        embeddingModel: "test-embedding",
        embeddingDims: 3,
      },
    }, { env: {}, username: "test-user" });
    const model = {
      config: config.openaiCompatible,
      embed: vi.fn(async () => [0.1, 0.2, 0.3]),
      completeJson: vi.fn(),
    };
    const store = new ElasticsearchMemoryStore({ config, model: model as any });
    vi.spyOn(store, "ensureIndex").mockResolvedValue(false);
    vi.spyOn(store, "request").mockImplementation(async (_path, options = {}) => {
      const body = options.body as any;
      if (body?.knn) {
        return {
          hits: {
            hits: [
              { _id: "mem-a", _score: 0.7, _source: { memory: "Vector match only." } },
              { _id: "mem-b", _score: 0.6, _source: { memory: "Vector and keyword match." } },
            ],
          },
        };
      }
      return {
        hits: {
          hits: [
            { _id: "mem-b", _score: 10, _source: { memory: "Vector and keyword match." } },
          ],
        },
      };
    });
    const fetchMock = vi.fn(async () => {
      throw new Error("reranker should not be called");
    });
    vi.stubGlobal("fetch", fetchMock);

    const results = await store.search("vector keyword", { top_k: 2 });

    expect(results.map((result) => result.id)).toEqual(["mem-b", "mem-a"]);
    expect(results[0].components).toMatchObject({ semantic: 0.6 });
    expect(results[0].components?.bm25).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
