import type { OpenClawTool, ToolDeps } from "../types.js";
import { schema, textResult } from "./helpers.js";

export function createMemoryListTool(deps: ToolDeps): OpenClawTool {
  const { store, config } = deps;
  return {
    name: "memory_list",
    label: "Memory List",
    description: "List memories in the current user namespace.",
    parameters: schema({
      limit: { type: "number" },
      userId: { type: "string" },
      filters: { type: "object" },
    }),
    async execute(_id, params) {
      const memories = await store.list({
        user_id: params.userId ?? config.userId,
        page_size: params.limit ?? 50,
        filters: params.filters,
      });
      return textResult(
        memories.length ? memories.map((m, i) => `${i + 1}. ${m.memory} (id: ${m.id})`).join("\n") : "No memories found.",
        { count: memories.length, memories },
      );
    },
  };
}
