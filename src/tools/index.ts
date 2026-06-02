import type { OpenClawTool, ToolDeps } from "../types.js";
import { createMemoryAddTool } from "./memory-add.js";
import { createMemoryDeleteTool } from "./memory-delete.js";
import { createMemoryGetTool } from "./memory-get.js";
import { createMemoryListTool } from "./memory-list.js";
import { createMemorySearchTool } from "./memory-search.js";
import { createMemoryTriageTool } from "./memory-triage.js";
import { createMemoryUpdateTool } from "./memory-update.js";

export function createMemoryTools(deps: ToolDeps): OpenClawTool[] {
  return [
    createMemorySearchTool(deps),
    createMemoryAddTool(deps),
    createMemoryGetTool(deps),
    createMemoryListTool(deps),
    createMemoryUpdateTool(deps),
    createMemoryDeleteTool(deps),
    createMemoryTriageTool(deps),
  ];
}

export function registerAllTools(api: { registerTool(tool: OpenClawTool, metadata?: Record<string, unknown>): void }, deps: ToolDeps): void {
  for (const tool of createMemoryTools(deps)) api.registerTool(tool, { optional: false });
}
