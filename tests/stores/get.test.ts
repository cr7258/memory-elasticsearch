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

describe("ElasticsearchMemoryStore.get", () => {
  it("reads one memory document by id", async () => {
    const store = createStore();
    const request = vi.spyOn(store, "request").mockResolvedValue({
      _id: "mem-1",
      _source: {
        memory: "User prefers TypeScript",
        user_id: "alice",
        metadata: { source: "OPENCLAW" },
      },
    });

    const memory = await store.get("mem-1");

    expect(request).toHaveBeenCalledWith("/openclaw-memory/_doc/mem-1", { ok: [200] });
    expect(memory).toMatchObject({
      id: "mem-1",
      memory: "User prefers TypeScript",
      user_id: "alice",
      metadata: { source: "OPENCLAW" },
    });
  });
});
