import { describe, expect, it, vi } from "vitest";
import { ElasticsearchMemoryStore } from "../../src/stores/elasticsearch.js";
import { parseConfig } from "../../src/config.js";

describe("ElasticsearchMemoryStore.add", () => {
  it("stores Mem0-style memory metadata with the current document shape", async () => {
    const config = parseConfig({
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
    vi.spyOn(store, "search").mockResolvedValue([]);
    const request = vi.spyOn(store, "request").mockResolvedValue({});

    const result = await store.add(
      [{ role: "user", content: "User prefers TypeScript for OpenClaw plugin work." }],
      {
        user_id: "alice",
        source: "OPENCLAW_TEST",
        memories: [{
          text: "User prefers TypeScript for OpenClaw plugin work.",
          attributed_to: "user",
          linked_memory_ids: ["mem-old"],
          metadata: { workspace: "slides" },
        }],
        metadata: { agent_id: "agent-main" },
      },
    );

    const write = request.mock.calls.find(([path]) => String(path).includes("/_doc/"));
    const doc = write?.[1]?.body as any;

    expect(result.results).toHaveLength(1);
    expect(doc).toMatchObject({
      memory: "User prefers TypeScript for OpenClaw plugin work.",
      user_id: "alice",
      agent_id: "agent-main",
      source: "OPENCLAW_TEST",
      metadata: {
        agent_id: "agent-main",
        workspace: "slides",
        source: "OPENCLAW_TEST",
        attributed_to: "user",
        linked_memory_ids: ["mem-old"],
      },
    });
    expect(doc).not.toHaveProperty("run_id");
    expect(doc).not.toHaveProperty("category");
    expect(doc).not.toHaveProperty("importance");
    expect(doc.metadata).not.toHaveProperty("category");
    expect(doc.metadata).not.toHaveProperty("importance");
  });

  it("uses existing related memories to skip semantically duplicate direct memories", async () => {
    const config = parseConfig({
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
      completeJson: vi.fn(async () => ({ memory: [] })),
    };
    const store = new ElasticsearchMemoryStore({ config, model: model as any });
    vi.spyOn(store, "ensureIndex").mockResolvedValue(false);
    vi.spyOn(store, "search").mockResolvedValue([
      { id: "mem-old", memory: "User prefers TypeScript for OpenClaw plugin work.", score: 0.92 },
    ]);
    const request = vi.spyOn(store, "request").mockResolvedValue({});

    const result = await store.add(
      [{ role: "user", content: "User likes TypeScript for OpenClaw plugin development." }],
      {
        infer: false,
        deduced_memories: ["User likes TypeScript for OpenClaw plugin development."],
      },
    );

    expect(result.results).toEqual([]);
    expect(model.completeJson).toHaveBeenCalled();
    expect(model.completeJson.mock.calls[0][0].system).toContain("Memory Deduper");
    expect(model.completeJson.mock.calls[0][0].user).toContain("Candidate Memories");
    expect(model.completeJson.mock.calls[0][0].user).not.toContain("New Messages");
    expect(request).not.toHaveBeenCalledWith(expect.stringContaining("/_doc/"), expect.anything());
  });
});
