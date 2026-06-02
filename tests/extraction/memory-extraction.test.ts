import { describe, expect, it, vi } from "vitest";
import { parseConfig } from "../../src/config.js";
import { OpenAICompatibleClient } from "../../src/clients/openai-compatible.js";
import { dedupeMemories, extractMemories } from "../../src/extraction/memory-extraction.js";

function clientWithoutApiKey(): OpenAICompatibleClient {
  const config = parseConfig({}, { env: {}, username: "test-user" });
  return new OpenAICompatibleClient(config.openaiCompatible);
}

function clientWithApiKey(): OpenAICompatibleClient {
  const config = parseConfig({
    openaiCompatible: {
      llm: {
        baseUrl: "https://api.example/v1",
        apiKey: "test-key",
        model: "test-llm",
      },
    },
  }, { env: {}, username: "test-user" });
  return new OpenAICompatibleClient(config.openaiCompatible);
}

describe("extractMemories", () => {
  it("returns no memories without calling the LLM when there is no user or assistant text", async () => {
    const client = clientWithoutApiKey();
    const completeJson = vi.spyOn(client, "completeJson");

    const memories = await extractMemories(client, [{ role: "system", content: "system only" }]);

    expect(memories).toEqual([]);
    expect(completeJson).not.toHaveBeenCalled();
  });

  it("requires an API key for memory triage", async () => {
    await expect(
      extractMemories(clientWithoutApiKey(), [{ role: "user", content: "I prefer Elasticsearch for long-term memory." }]),
    ).rejects.toThrow(/required for memory triage/);
  });

  it("extracts Mem0-style memories and preserves attribution/link metadata", async () => {
    const client = clientWithApiKey();
    const completeJson = vi.spyOn(client, "completeJson").mockResolvedValue({
      memory: [{
        id: "0",
        text: "User prefers TypeScript for OpenClaw plugin work.",
        attributed_to: "user",
        linked_memory_ids: ["mem-old"],
      }],
    });

    const memories = await extractMemories(
      client,
      [{ role: "user", content: "I also like TypeScript when writing OpenClaw plugins." }],
      { existingMemories: [{ id: "mem-old", memory: "User prefers TypeScript for agent plugin projects." }] },
    );

    expect(completeJson).toHaveBeenCalledWith(expect.objectContaining({
      system: expect.stringContaining("sole operation is ADD"),
      user: expect.stringContaining("Existing Memories"),
    }));
    expect(completeJson.mock.calls[0][0].system).toContain("Do not store ordinary questions");
    expect(completeJson.mock.calls[0][0].system).toContain("Include secrets");
    expect(completeJson.mock.calls[0][0].user).toContain("mem-old");
    expect(completeJson.mock.calls[0][0].user).toContain('"memory"');
    expect(completeJson.mock.calls[0][0].user).not.toContain('"facts"');
    expect(completeJson.mock.calls[0][0].user).not.toContain("category");
    expect(completeJson.mock.calls[0][0].user).not.toContain("importance");
    expect(memories).toEqual([{
      id: "0",
      text: "User prefers TypeScript for OpenClaw plugin work.",
      attributed_to: "user",
      linked_memory_ids: ["mem-old"],
      metadata: {
        attributed_to: "user",
        linked_memory_ids: ["mem-old"],
      },
    }]);
  });
});

describe("dedupeMemories", () => {
  it("keeps direct memories without an LLM call when there is no dedupe context", async () => {
    const client = clientWithoutApiKey();
    const completeJson = vi.spyOn(client, "completeJson");
    const candidates = [{ text: "User prefers Elasticsearch memory." }];

    await expect(dedupeMemories(client, candidates)).resolves.toBe(candidates);
    expect(completeJson).not.toHaveBeenCalled();
  });

  it("uses existing memories to keep only non-duplicate candidate memories", async () => {
    const client = clientWithApiKey();
    const completeJson = vi.spyOn(client, "completeJson").mockResolvedValue({
      memory: [{
        id: "1",
        text: "User also wants Jina reranker enabled for memory search.",
        attributed_to: "user",
        linked_memory_ids: ["mem-old"],
      }],
    });

    const memories = await dedupeMemories(
      client,
      [
        { id: "0", text: "User prefers Elasticsearch memory." },
        { id: "1", text: "User also wants Jina reranker enabled for memory search." },
      ],
      { existingMemories: [{ id: "mem-old", memory: "User prefers Elasticsearch memory." }] },
    );

    expect(completeJson).toHaveBeenCalledWith(expect.objectContaining({
      system: expect.stringContaining("Memory Deduper"),
      user: expect.stringContaining("Candidate Memories"),
    }));
    expect(completeJson.mock.calls[0][0].user).not.toContain("New Messages");
    expect(memories.map((memory) => memory.text)).toEqual([
      "User also wants Jina reranker enabled for memory search.",
    ]);
  });
});
