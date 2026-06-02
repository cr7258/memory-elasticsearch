import type { MemoryConfig, SearchOptions } from "../types.js";

export function schema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties: false };
}

export function textResult(text: string, details: Record<string, unknown> = {}) {
  return { content: [{ type: "text", text }], details };
}

export function buildOptions(config: MemoryConfig, params: Record<string, any> = {}): SearchOptions {
  const user_id = params.userId ?? config.userId;
  return {
    user_id,
    top_k: params.limit ?? config.topK,
    threshold: params.threshold ?? config.searchThreshold,
    filters: params.filters,
  };
}
