import { describe, expect, it, vi } from "vitest";
import { parseConfig } from "../../src/config.js";
import { createMemoryAddTool } from "../../src/tools/memory-add.js";
import type { MemoryStore } from "../../src/types.js";

function fakeStore(overrides: Partial<MemoryStore> = {}): MemoryStore {
  return {
    ensureIndex: async () => false,
    add: async () => ({ results: [{ id: "m1", memory: "User prefers TypeScript", event: "ADD" }] }),
    triage: async () => ({ memories: [] }),
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

describe("memory_add tool", () => {
  it("exposes the current memories schema", () => {
    const tool = createMemoryAddTool({
      store: fakeStore(),
      config: parseConfig({}, { env: {}, username: "alice" }),
    });
    const properties = (tool.parameters as any).properties;

    expect(properties.memories).toMatchObject({ type: "array" });
    expect(properties.text).toMatchObject({ type: "string" });
    expect(properties).not.toHaveProperty("facts");
    expect(properties).not.toHaveProperty("category");
    expect(properties).not.toHaveProperty("importance");
  });

  it("stores explicit memories with semantic dedupe", async () => {
    const add = vi.fn(async () => ({ results: [{ id: "m1", memory: "User prefers TypeScript", event: "ADD" }] }));
    const tool = createMemoryAddTool({
      store: fakeStore({ add }),
      config: parseConfig({}, { env: {}, username: "alice" }),
    });

    const result = await tool.execute("call-1", {
      memories: ["User prefers TypeScript"],
      metadata: { workspace: "demo" },
    });

    expect(add).toHaveBeenCalledWith([{ role: "user", content: "User prefers TypeScript" }], expect.objectContaining({
      user_id: "alice",
      infer: false,
      deduced_memories: ["User prefers TypeScript"],
      metadata: { workspace: "demo" },
    }));
    expect(result.content[0].text).toContain("Stored 1 memory");
  });
});
