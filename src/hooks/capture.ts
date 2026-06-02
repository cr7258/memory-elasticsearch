import type { ChatMessage } from "../types.js";

export function cleanPrompt(prompt: unknown): string {
  return String(prompt ?? "")
    .replace(/<relevant-memories>[\s\S]*?<\/relevant-memories>\s*/g, "")
    .replace(/Sender\s*\(untrusted metadata\):\s*```json[\s\S]*?```\s*/gi, "")
    .replace(/^\[[^\]]+\]\s*/g, "")
    .trim();
}

export function extractMessages(messages: any[] = []): ChatMessage[] {
  const parsed: ChatMessage[] = [];
  for (const message of messages) {
    if (!message || (message.role !== "user" && message.role !== "assistant")) continue;
    if (typeof message.content === "string") parsed.push({ role: message.role, content: cleanPrompt(message.content) });
    else if (Array.isArray(message.content)) {
      const text = message.content
        .map((block: any) => typeof block?.text === "string" ? block.text : "")
        .filter(Boolean)
        .join("\n");
      if (text) parsed.push({ role: message.role, content: cleanPrompt(text) });
    }
  }
  return parsed.filter((message) => message.content.length > 0).slice(-20);
}
