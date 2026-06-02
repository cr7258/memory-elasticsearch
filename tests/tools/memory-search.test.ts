import { describe, expect, it, vi } from "vitest";
import { parseConfig } from "../../src/config.js";
import { createMemorySearchTool } from "../../src/tools/memory-search.js";
import type { MemoryStore } from "../../src/types.js";

function fakeStore(overrides: Partial<MemoryStore> = {}): MemoryStore {
  return {
    ensureIndex: async () => false,
    add: async () => ({ results: [] }),
    triage: async () => ({ memories: [] }),
    search: async () => [{ id: "m1", memory: "User prefers TypeScript", score: 0.9 }],
    get: async () => ({ id: "m1", memory: "User prefers TypeScript" }),
    list: async () => [],
    update: async (_id, text) => ({ id: "m1", memory: text }),
    delete: async () => ({ deleted: 1 }),
    deleteByQuery: async () => ({ deleted: 1, ids: ["m1"] }),
    deleteAll: async () => ({ deleted: 1 }),
    ...overrides,
  };
}

describe("memory_search tool", () => {
  it("formats matching memories", async () => {
    const tool = createMemorySearchTool({
      store: fakeStore(),
      config: parseConfig({}, { env: {}, username: "alice" }),
    });

    const result = await tool.execute("call-1", { query: "typescript" });

    expect(result.content[0].text).toContain("User prefers TypeScript");
    expect(result.details?.count).toBe(1);
  });

  it("passes user and limit options to the store search", async () => {
    const search = vi
      .fn()
      .mockResolvedValueOnce([{ id: "m1", memory: "TypeScript preference", score: 0.9 }]);
    const tool = createMemorySearchTool({
      store: fakeStore({ search }),
      config: parseConfig({}, { env: {}, username: "alice" }),
    });

    const result = await tool.execute("call-1", { query: "typescript", limit: 3, userId: "bob" });

    expect(search).toHaveBeenCalledWith("typescript", expect.objectContaining({ user_id: "bob", top_k: 3 }));
    expect((result.details as any).memories.map((memory: any) => memory.id)).toEqual(["m1"]);
  });
});
