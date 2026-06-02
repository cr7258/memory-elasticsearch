import { describe, expect, it, vi } from "vitest";
import { parseConfig } from "../../src/config.js";
import { ElasticsearchMemoryStore } from "../../src/stores/elasticsearch.js";

function createStore() {
  const config = parseConfig({
    openaiCompatible: {
      apiKey: "test-key",
      llmModel: "test-llm",
      embeddingModel: "test-embedding",
      embeddingDims: 3,
    },
  }, { env: {}, username: "alice" });
  const model = {
    config: config.openaiCompatible,
    embed: vi.fn(async () => [0.1, 0.2, 0.3]),
    completeJson: vi.fn(),
  };
  return {
    model,
    store: new ElasticsearchMemoryStore({ config, model: model as any }),
  };
}

describe("ElasticsearchMemoryStore.update", () => {
  it("re-embeds updated text and merges metadata", async () => {
    const { model, store } = createStore();
    vi.spyOn(store, "get").mockResolvedValue({
      id: "mem-1",
      memory: "Old memory",
      metadata: { source: "OPENCLAW", workspace: "demo" },
    });
    const request = vi.spyOn(store, "request").mockResolvedValue({});

    const memory = await store.update("mem-1", "Updated memory", { workspace: "new-demo" });

    expect(model.embed).toHaveBeenCalledWith("Updated memory");
    expect(request).toHaveBeenCalledWith("/openclaw-memory/_update/mem-1", {
      method: "POST",
      body: {
        doc: expect.objectContaining({
          memory: "Updated memory",
          vector: [0.1, 0.2, 0.3],
          metadata: { source: "OPENCLAW", workspace: "new-demo" },
        }),
      },
    });
    expect(memory).toMatchObject({
      id: "mem-1",
      memory: "Updated memory",
    });
  });
});
