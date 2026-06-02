import type { OpenClawTool, ToolDeps } from "../types.js";
import { schema, textResult } from "./helpers.js";

export function createMemoryGetTool({ store }: ToolDeps): OpenClawTool {
  return {
    name: "memory_get",
    label: "Memory Get",
    description: "Retrieve one memory by id.",
    parameters: schema({ memoryId: { type: "string" } }, ["memoryId"]),
    async execute(_id, params) {
      const memory = await store.get(params.memoryId);
      return textResult(`${memory.memory}\n\nid: ${memory.id}`, { memory });
    },
  };
}
