import { describe, expect, it } from "vitest";
import { parseConfig } from "../../src/config.js";
import { createMemoryTriageTool } from "../../src/tools/memory-triage.js";
import type { MemoryStore } from "../../src/types.js";

function fakeStore(overrides: Partial<MemoryStore> = {}): MemoryStore {
  return {
    ensureIndex: async () => false,
    add: async () => ({ results: [] }),
    triage: async () => ({ memories: [{ text: "User prefers TypeScript", attributed_to: "user" }] }),
    search: async () => [],
    get: async () => ({ id: "m1", memory: "User prefers TypeScript" }),
    list: async () => [],
    update: async (_id, text) => ({ id: "m1", memory: text }),
    delete: async () => ({ deleted: 1 }),
    deleteByQuery: async () => ({ deleted: 1, ids: ["m1"] }),
    deleteAll: async () => ({ deleted: 1 }),
    ...overrides,
  };
}

describe("memory_triage tool", () => {
  it("returns extracted candidates without storing", async () => {
    const tool = createMemoryTriageTool({
      store: fakeStore(),
      config: parseConfig({}, { env: {}, username: "alice" }),
    });

    const result = await tool.execute("call-1", { text: "Remember that I prefer TypeScript." });

    expect(result.content[0].text).toContain("Triage candidates");
    expect((result.details as any).memories[0].text).toBe("User prefers TypeScript");
  });

  it("returns a missing text error without calling triage", async () => {
    const tool = createMemoryTriageTool({
      store: fakeStore(),
      config: parseConfig({}, { env: {}, username: "alice" }),
    });

    const result = await tool.execute("call-1", {});

    expect(result.details?.error).toBe("missing_text");
  });
});
