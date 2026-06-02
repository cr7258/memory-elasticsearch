import { describe, expect, it, vi } from "vitest";
import { parseConfig } from "../../src/config.js";
import { ElasticsearchMemoryStore } from "../../src/stores/elasticsearch.js";

function createStore(): ElasticsearchMemoryStore {
  const config = parseConfig({
    openaiCompatible: {
      apiKey: "test-key",
      llmModel: "test-llm",
      embeddingModel: "test-embedding",
      embeddingDims: 3,
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

describe("ElasticsearchMemoryStore.delete", () => {
  it("deletes one memory document by id", async () => {
    const store = createStore();
    const request = vi.spyOn(store, "request").mockResolvedValue({});

    const result = await store.delete("mem-1");

    expect(request).toHaveBeenCalledWith("/openclaw-memory/_doc/mem-1", {
      method: "DELETE",
      ok: [200, 202, 404],
    });
    expect(result).toEqual({ deleted: 1 });
  });

  it("deletes only literal text matches for query deletes", async () => {
    const store = createStore();
    vi.spyOn(store, "search").mockResolvedValue([
      { id: "mem-1", memory: "User prefers TypeScript for OpenClaw plugins" },
      { id: "mem-2", memory: "User prefers Elasticsearch for long-term memory" },
    ]);
    const deleteOne = vi.spyOn(store, "delete").mockResolvedValue({ deleted: 1 });

    const result = await store.deleteByQuery("TypeScript", { user_id: "alice" });

    expect(deleteOne).toHaveBeenCalledTimes(1);
    expect(deleteOne).toHaveBeenCalledWith("mem-1");
    expect(result).toEqual({ deleted: 1, ids: ["mem-1"] });
  });

  it("bulk deletes memories in the configured user namespace", async () => {
    const store = createStore();
    const request = vi.spyOn(store, "request").mockResolvedValue({ deleted: 3 });

    const result = await store.deleteAll("alice");

    expect(request).toHaveBeenCalledWith("/openclaw-memory/_delete_by_query", {
      method: "POST",
      ok: [200],
      body: {
        query: {
          bool: {
            filter: [{ term: { user_id: "alice" } }],
          },
        },
      },
    });
    expect(result).toEqual({ deleted: 3 });
  });
});
