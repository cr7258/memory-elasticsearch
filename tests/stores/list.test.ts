import { describe, expect, it, vi } from "vitest";
import { parseConfig } from "../../src/config.js";
import { ElasticsearchMemoryStore } from "../../src/stores/elasticsearch.js";

function createStore(): ElasticsearchMemoryStore {
  const config = parseConfig({
    openaiCompatible: {
      llm: {
        apiKey: "test-key",
        model: "test-llm",
      },
      embedding: {
        apiKey: "test-key",
        model: "test-embedding",
        dims: 3,
      },
    },
  }, { env: {}, username: "alice" });
  return new ElasticsearchMemoryStore({
    config,
    model: {
      config: config.openaiCompatible,
      embed: vi.fn(async () => [0.1, 0.2, 0.3]),
      completeJson: vi.fn(),
    } as any,
  });
}

describe("ElasticsearchMemoryStore.list", () => {
  it("lists memories using user and metadata filters", async () => {
    const store = createStore();
    vi.spyOn(store, "ensureIndex").mockResolvedValue(false);
    const request = vi.spyOn(store, "request").mockResolvedValue({
      hits: {
        hits: [
          {
            _id: "mem-1",
            _source: {
              memory: "User prefers TypeScript",
              user_id: "alice",
              metadata: { workspace: "demo" },
            },
          },
        ],
      },
    });

    const memories = await store.list({
      user_id: "alice",
      filters: { workspace: "demo" },
      page_size: 10,
    });

    expect(request).toHaveBeenCalledWith("/openclaw-memory/_search", expect.objectContaining({
      method: "POST",
      body: expect.objectContaining({
        size: 10,
        query: {
          bool: {
            filter: [
              { term: { user_id: "alice" } },
              { term: { "metadata.workspace": "demo" } },
            ],
          },
        },
        sort: [{ updated_at: "desc" }],
        _source: { excludes: ["vector"] },
      }),
    }));
    expect(memories).toEqual([expect.objectContaining({
      id: "mem-1",
      memory: "User prefers TypeScript",
    })]);
  });
});
