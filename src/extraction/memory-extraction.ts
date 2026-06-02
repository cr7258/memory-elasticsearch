import { OpenAICompatibleClient } from "../clients/openai-compatible.js";
import type { ChatMessage, ExtractedMemory, MemoryRecord } from "../types.js";

export interface MemoryExtractionContext {
  existingMemories?: Array<Pick<MemoryRecord, "id" | "memory">>;
  recentlyExtractedMemories?: Array<Pick<MemoryRecord, "id" | "memory">>;
  currentDate?: string;
}

function serializeMemories(memories: Array<Pick<MemoryRecord, "id" | "memory">> = []): string {
  if (!memories.length) return "[]";
  return JSON.stringify(
    memories.map((memory) => ({ id: String(memory.id), text: String(memory.memory ?? "") })).filter((memory) => memory.id && memory.text),
    null,
    2,
  );
}

function metadataForMemory(memory: Record<string, any>): Record<string, unknown> | undefined {
  const metadata: Record<string, unknown> = typeof memory.metadata === "object" && memory.metadata ? { ...memory.metadata } : {};
  if (memory.attributed_to) metadata.attributed_to = String(memory.attributed_to);
  if (Array.isArray(memory.linked_memory_ids) && memory.linked_memory_ids.length) {
    metadata.linked_memory_ids = memory.linked_memory_ids.map(String);
  }
  return Object.keys(metadata).length ? metadata : undefined;
}

function normalizeExtractedMemories(result: Record<string, any>): ExtractedMemory[] {
  const rawMemories = Array.isArray(result?.memory) ? result.memory : [];
  return rawMemories
    .map((memory): ExtractedMemory => ({
      id: memory.id === undefined ? undefined : String(memory.id),
      text: String(memory.text ?? "").trim(),
      attributed_to: memory.attributed_to === undefined ? undefined : String(memory.attributed_to),
      linked_memory_ids: Array.isArray(memory.linked_memory_ids) ? memory.linked_memory_ids.map(String) : undefined,
      metadata: metadataForMemory(memory),
    }))
    .filter((memory) => memory.text.length > 0);
}

function additiveMemorySystemPrompt(): string {
  return [
    "You are a Memory Extractor. Your sole operation is ADD.",
    "Extract durable, self-contained memories from New Messages only.",
    "Use Existing Memories only for deduplication and linking; do not extract new memories from them.",
    "If a new memory is semantically equivalent to an Existing Memory and adds no meaningful context, skip it.",
    "If a new memory is related to an Existing Memory but adds new context, include that existing ID in linked_memory_ids.",
    "Do not merge details from Existing Memories into a new memory unless New Messages explicitly mention them.",
    "Store durable memories about the user, their projects, preferences, decisions, configuration, relationships, or long-running tasks.",
    "Do not store ordinary questions, generic factual answers, one-off command help, transient troubleshooting output, or general knowledge unless it creates durable user/project context.",
    "When in doubt, extract; a slightly redundant memory is less costly than a missing useful memory, but true duplicates already captured should be skipped.",
    "Include secrets, API keys, passwords, tokens, or secret webhook URLs when the user explicitly asks to remember or save that exact value.",
    "Return JSON only.",
  ].join(" ");
}

function memoryDedupeSystemPrompt(): string {
  return [
    "You are a Memory Deduper. Your sole operation is KEEP or SKIP candidate memories.",
    "Use Existing Memories and Recently Extracted Memories only for deduplication and linking.",
    "Return only candidate memories that are durable and not semantically equivalent to existing memories.",
    "If a candidate memory is related to an Existing Memory but adds meaningful new context, keep it and include that existing ID in linked_memory_ids.",
    "If a candidate memory is already captured and adds no meaningful context, skip it.",
    "Do not create new memories from Existing Memories or Recently Extracted Memories.",
    "Include secrets, API keys, passwords, tokens, or secret webhook URLs when the user explicitly asks to remember or save that exact value.",
    "Return JSON only.",
  ].join(" ");
}

function buildAdditiveExtractionPrompt(messages: ChatMessage[], context: MemoryExtractionContext = {}): string {
  const text = messages
    .filter((message) => message?.role === "user" || message?.role === "assistant")
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n")
    .slice(-12000);
  const currentDate = context.currentDate ?? new Date().toISOString().slice(0, 10);
  return [
    `Current date: ${currentDate}`,
    "",
    `Recently Extracted Memories:\n${serializeMemories(context.recentlyExtractedMemories)}`,
    "",
    `Existing Memories:\n${serializeMemories(context.existingMemories)}`,
    "",
    `New Messages:\n${text}`,
    "",
    "Return shape:",
    `{"memory":[{"id":"0","text":"self-contained memory","attributed_to":"user|assistant","linked_memory_ids":["existing-memory-id"]}]}`,
    "",
    "If nothing is worth extracting or everything is already captured, return {\"memory\":[]}.",
  ].join("\n");
}

function serializeCandidateMemories(memories: ExtractedMemory[]): string {
  if (!memories.length) return "[]";
  return JSON.stringify(
    memories.map((memory, index) => ({
      id: memory.id ?? String(index),
      text: memory.text,
      attributed_to: memory.attributed_to,
      linked_memory_ids: memory.linked_memory_ids,
    })),
    null,
    2,
  );
}

function buildMemoryDedupePrompt({
  candidates,
  existingMemories,
  recentlyExtractedMemories,
  currentDate,
}: {
  candidates: ExtractedMemory[];
  existingMemories?: Array<Pick<MemoryRecord, "id" | "memory">>;
  recentlyExtractedMemories?: Array<Pick<MemoryRecord, "id" | "memory">>;
  currentDate?: string;
}): string {
  return [
    `Current date: ${currentDate ?? new Date().toISOString().slice(0, 10)}`,
    "",
    `Recently Extracted Memories:\n${serializeMemories(recentlyExtractedMemories)}`,
    "",
    `Existing Memories:\n${serializeMemories(existingMemories)}`,
    "",
    `Candidate Memories:\n${serializeCandidateMemories(candidates)}`,
    "",
    "Return shape:",
    `{"memory":[{"id":"0","text":"candidate memory to keep","attributed_to":"user|assistant","linked_memory_ids":["existing-memory-id"]}]}`,
    "",
    "Return only candidate memories that should be stored. If every candidate is duplicate, low-value, or unsafe, return {\"memory\":[]}.",
  ].join("\n");
}

export async function extractMemories(
  model: OpenAICompatibleClient,
  messages: ChatMessage[],
  context: MemoryExtractionContext = {},
): Promise<ExtractedMemory[]> {
  const text = messages
    .filter((message) => message?.role === "user" || message?.role === "assistant")
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n")
    .slice(-12000);

  if (!text.trim()) return [];
  if (!model?.config?.llm?.apiKey) throw new Error("OpenAI-compatible API key is required for memory triage");

  const result = await model.completeJson({
    system: additiveMemorySystemPrompt(),
    user: buildAdditiveExtractionPrompt(messages, context),
  });

  return normalizeExtractedMemories(result);
}

export async function dedupeMemories(
  model: OpenAICompatibleClient,
  memories: ExtractedMemory[],
  context: MemoryExtractionContext = {},
): Promise<ExtractedMemory[]> {
  if (!memories.length) return [];
  if (!context.existingMemories?.length && !context.recentlyExtractedMemories?.length) return memories;
  if (!model?.config?.llm?.apiKey) throw new Error("OpenAI-compatible API key is required for memory deduplication");

  const result = await model.completeJson({
    system: memoryDedupeSystemPrompt(),
    user: buildMemoryDedupePrompt({
      candidates: memories,
      existingMemories: context.existingMemories,
      recentlyExtractedMemories: context.recentlyExtractedMemories,
      currentDate: context.currentDate,
    }),
  });
  return normalizeExtractedMemories(result);
}
