import type { OpenClawTool, ToolDeps } from "../types.js";
import { schema, textResult } from "./helpers.js";

export function createMemoryAddTool(deps: ToolDeps): OpenClawTool {
  const { store, config } = deps;
  return {
    name: "memory_add",
    label: "Memory Add",
    description: "Store durable memories in Elasticsearch memory.",
    parameters: schema({
      text: { type: "string" },
      memories: { type: "array", items: { type: "string" } },
      userId: { type: "string" },
      metadata: { type: "object" },
    }),
    async execute(_id, params) {
      const memories = Array.isArray(params.memories) && params.memories.length ? params.memories : params.text ? [params.text] : [];
      if (!memories.length) return textResult("No memories provided. Pass text or memories.", { error: "missing_memories" });
      const result = await store.add([{ role: "user", content: memories.join("\n") }], {
        user_id: params.userId ?? config.userId,
        infer: false,
        deduced_memories: memories,
        source: "OPENCLAW",
        metadata: params.metadata ?? {},
      });
      return textResult(`Stored ${result.results.length} memor${result.results.length === 1 ? "y" : "ies"}: ${result.results.map((r) => `[${r.event}] ${r.memory}`).join("; ")}`, result);
    },
  };
}
