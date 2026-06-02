import { describe, expect, it, vi } from "vitest";
import { parseConfig } from "../../src/config.js";
import { createMemoryDeleteTool } from "../../src/tools/memory-delete.js";
import type { MemoryStore } from "../../src/types.js";

function fakeStore(overrides: Partial<MemoryStore> = {}): MemoryStore {
  return {
    ensureIndex: async () => false,
    add: async () => ({ results: [] }),
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

describe("memory_delete tool", () => {
  it("requires confirmation for bulk delete", async () => {
    const deleteAll = vi.fn();
    const tool = createMemoryDeleteTool({
      store: fakeStore({ deleteAll }),
      config: parseConfig({}, { env: {}, username: "alice" }),
    });

    const result = await tool.execute("call-1", { all: true });

    expect(result.details?.error).toBe("confirm_required");
    expect(deleteAll).not.toHaveBeenCalled();
  });

  it("deletes by query in the configured user namespace", async () => {
    const deleteByQuery = vi.fn(async () => ({ deleted: 1, ids: ["m1"] }));
    const tool = createMemoryDeleteTool({
      store: fakeStore({ deleteByQuery }),
      config: parseConfig({}, { env: {}, username: "alice" }),
    });

    const result = await tool.execute("call-1", { query: "typescript" });

    expect(deleteByQuery).toHaveBeenCalledWith("typescript", { user_id: "alice", top_k: 20 });
    expect(result.content[0].text).toContain("Deleted 1 memory");
  });
});
