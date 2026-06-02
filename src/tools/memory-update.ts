import type { OpenClawTool, ToolDeps } from "../types.js";
import { schema, textResult } from "./helpers.js";

export function createMemoryUpdateTool({ store }: ToolDeps): OpenClawTool {
  return {
    name: "memory_update",
    label: "Memory Update",
    description: "Update an existing memory and re-embed it.",
    parameters: schema({ memoryId: { type: "string" }, text: { type: "string" }, metadata: { type: "object" } }, ["memoryId", "text"]),
    async execute(_id, params) {
      const memory = await store.update(params.memoryId, params.text, params.metadata ?? {});
      return textResult(`Updated memory ${memory.id}: ${memory.memory}`, { memory });
    },
  };
}
