import { OpenAICompatibleClient } from "../clients/openai-compatible.js";
import type { MemoryRecord } from "../types.js";

function serializeDeletionCandidates(candidates: Array<Pick<MemoryRecord, "id" | "memory">>): string {
  if (!candidates.length) return "[]";
  return JSON.stringify(
    candidates.map((candidate) => ({
      id: String(candidate.id),
      text: String(candidate.memory ?? ""),
    })),
    null,
    2,
  );
}

function deletionJudgeSystemPrompt(): string {
  return [
    "You are a Memory Delete Judge.",
    "The user provided a deletion query and a list of candidate memories found by search.",
    "Select only candidate memory IDs that the deletion query clearly asks to delete.",
    "Do not delete a memory merely because it is semantically related.",
    "Do not invent IDs. Return IDs only from Candidate Memories.",
    "Return JSON only.",
  ].join(" ");
}

function buildDeletionJudgePrompt(query: string, candidates: Array<Pick<MemoryRecord, "id" | "memory">>): string {
  return [
    `Deletion Query:\n${query}`,
    "",
    `Candidate Memories:\n${serializeDeletionCandidates(candidates)}`,
    "",
    "Return shape:",
    `{"delete_memory_ids":["candidate-memory-id"]}`,
    "",
    "If no candidate should be deleted, return {\"delete_memory_ids\":[]}.",
  ].join("\n");
}

export async function selectMemoryIdsForDeletion(
  model: OpenAICompatibleClient,
  query: string,
  candidates: Array<Pick<MemoryRecord, "id" | "memory">>,
): Promise<string[]> {
  if (!candidates.length) return [];
  if (!model?.config?.llm?.apiKey) throw new Error("OpenAI-compatible API key is required for memory deletion judgment");

  const result = await model.completeJson({
    system: deletionJudgeSystemPrompt(),
    user: buildDeletionJudgePrompt(query, candidates),
  });
  const candidateIds = new Set(candidates.map((candidate) => String(candidate.id)));
  const ids = Array.isArray(result.delete_memory_ids) ? result.delete_memory_ids : [];
  return [...new Set(ids.map(String).filter((id) => candidateIds.has(id)))];
}
