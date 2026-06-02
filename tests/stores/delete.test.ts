import { describe, expect, it, vi } from "vitest";
import { parseConfig } from "../../src/config.js";
import { ElasticsearchMemoryStore } from "../../src/stores/elasticsearch.js";

function createStore(): { store: ElasticsearchMemoryStore; model: { embed: ReturnType<typeof vi.fn>; completeJson: ReturnType<typeof vi.fn> } } {
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
  const model = {
    config: config.openaiCompatible,
    embed: vi.fn(async () => [0.1, 0.2, 0.3]),
    completeJson: vi.fn(),
  };
  return {
    store: new ElasticsearchMemoryStore({
    config,
      model: model as any,
    }),
    model,
  };
}

describe("ElasticsearchMemoryStore.delete", () => {
  it("deletes one memory document by id", async () => {
    const { store } = createStore();
    const request = vi.spyOn(store, "request").mockResolvedValue({});

    const result = await store.delete("mem-1");

    expect(request).toHaveBeenCalledWith("/openclaw-memory/_doc/mem-1", {
      method: "DELETE",
      ok: [200, 202, 404],
    });
    expect(result).toEqual({ deleted: 1 });
  });

  it("uses hybrid search candidates and LLM selection for query deletes without reranking", async () => {
    const { store, model } = createStore();
    vi.spyOn(store, "search").mockResolvedValue([
      { id: "mem-1", memory: "User prefers TypeScript for OpenClaw plugins" },
      { id: "mem-2", memory: "User wants to remove Elasticsearch preference memories" },
    ]);
    model.completeJson.mockResolvedValue({ delete_memory_ids: ["mem-2", "not-a-candidate"] });
    const deleteOne = vi.spyOn(store, "delete").mockResolvedValue({ deleted: 1 });

    const result = await store.deleteByQuery("delete Elasticsearch preference", { user_id: "alice" });

    expect(store.search).toHaveBeenCalledWith("delete Elasticsearch preference", {
      user_id: "alice",
      top_k: 50,
      reranker: false,
    });
    expect(model.completeJson).toHaveBeenCalledTimes(1);
    expect(deleteOne).toHaveBeenCalledTimes(1);
    expect(deleteOne).toHaveBeenCalledWith("mem-2");
    expect(result).toEqual({ deleted: 1, ids: ["mem-2"] });
  });

  it("bulk deletes memories in the configured user namespace", async () => {
    const { store } = createStore();
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
