import type { ChatMessage, OpenClawTool, ToolDeps } from "../types.js";
import { schema, textResult } from "./helpers.js";

function parseMessages(params: Record<string, any>): ChatMessage[] {
  if (Array.isArray(params.messages)) {
    return params.messages
      .map((message): ChatMessage => ({
        role: message?.role === "assistant" ? "assistant" as const : "user" as const,
        content: String(message?.content ?? "").trim(),
      }))
      .filter((message) => message.content);
  }
  if (params.text) return [{ role: "user", content: String(params.text) }];
  return [];
}

export function createMemoryTriageTool(deps: ToolDeps): OpenClawTool {
  const { store, config } = deps;
  return {
    name: "memory_triage",
    label: "Memory Triage",
    description: "Evaluate conversation text for durable memory-worthy candidates without storing them.",
    parameters: schema({
      text: { type: "string" },
      messages: {
        type: "array",
        items: {
          type: "object",
          properties: {
            role: { type: "string", enum: ["user", "assistant"] },
            content: { type: "string" },
          },
        },
      },
      userId: { type: "string" },
    }),
    async execute(_id, params) {
      const messages = parseMessages(params);
      if (!messages.length) return textResult("No conversation text provided for triage.", { error: "missing_text" });
      const result = await store.triage(messages, {
        user_id: params.userId ?? config.userId,
      });
      if (!result.memories.length) return textResult("Triage found no durable memory candidates.", result as any);
      const lines = result.memories.map((memory, index) => `${index + 1}. ${memory.text}`);
      return textResult(
        `Triage candidates:\n\n${lines.join("\n")}`,
        result as any,
      );
    },
  };
}
