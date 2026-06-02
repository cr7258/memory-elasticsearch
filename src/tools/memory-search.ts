import type { OpenClawTool, ToolDeps } from "../types.js";
import { buildOptions, schema, textResult } from "./helpers.js";

export function createMemorySearchTool(deps: ToolDeps): OpenClawTool {
  const { store, config } = deps;
  return {
    name: "memory_search",
    label: "Memory Search",
    description: "Search Elasticsearch-backed OpenClaw memories with hybrid BM25 + vector retrieval.",
    parameters: schema({
      query: { type: "string" },
      limit: { type: "number" },
      userId: { type: "string" },
      filters: { type: "object" },
    }, ["query"]),
    async execute(_id, params) {
      const results = await store.search(params.query, buildOptions(config, params));
      if (!results.length) return textResult("No relevant memories found.", { count: 0 });
      return textResult(
        `Found ${results.length} memories:\n\n${results.map((item, index) => `${index + 1}. ${item.memory} (score: ${((item.score ?? 0) * 100).toFixed(0)}%, id: ${item.id})`).join("\n")}`,
        { count: results.length, memories: results },
      );
    },
  };
}
