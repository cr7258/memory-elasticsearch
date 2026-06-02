import type { OpenClawTool, ToolDeps } from "../types.js";
import { schema, textResult } from "./helpers.js";

export function createMemoryDeleteTool(deps: ToolDeps): OpenClawTool {
  const { store, config } = deps;
  return {
    name: "memory_delete",
    label: "Memory Delete",
    description: "Delete a memory by id, by search query, or all memories with confirmation.",
    parameters: schema({
      memoryId: { type: "string" },
      query: { type: "string" },
      all: { type: "boolean" },
      confirm: { type: "boolean" },
      userId: { type: "string" },
    }),
    async execute(_id, params) {
      let result;
      if (params.all) {
        if (!params.confirm) return textResult("Bulk delete requires confirm: true.", { error: "confirm_required" });
        result = await store.deleteAll(params.userId ?? config.userId);
      } else if (params.query) {
        result = await store.deleteByQuery(params.query, { user_id: params.userId ?? config.userId, top_k: 20 });
      } else if (params.memoryId) {
        result = await store.delete(params.memoryId);
      } else {
        return textResult("Pass memoryId, query, or all: true.", { error: "missing_target" });
      }
      return textResult(`Deleted ${result.deleted ?? 0} memor${(result.deleted ?? 0) === 1 ? "y" : "ies"}.`, result);
    },
  };
}
