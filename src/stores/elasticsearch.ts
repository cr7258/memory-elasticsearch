import { randomUUID } from "node:crypto";
import {
  buildFilterClauses,
  buildKeywordSearchBody,
  buildKnnSearchBody,
  hitsToPayloadMap,
  hitsToRankedItems,
  keywordHitsToBm25Scores,
  lemmatizeForSearch,
  literalMemoryTextMatch,
  scoreHybridResults,
} from "../retrieval/search.js";
import { dedupeMemories, extractMemories } from "../extraction/memory-extraction.js";
import { JinaReranker } from "../retrieval/reranker.js";
import { OpenAICompatibleClient } from "../clients/openai-compatible.js";
import type { AddOptions, ChatMessage, ExtractedMemory, MemoryConfig, MemoryRecord, SearchOptions, TriageOptions } from "../types.js";

function b64(value: string): string {
  return Buffer.from(value).toString("base64");
}

function normalizeHit(hit: any): MemoryRecord {
  const source = hit?._source ?? {};
  return {
    id: hit?._id ?? source.id,
    memory: source.memory ?? "",
    score: typeof hit?._score === "number" ? hit._score : source.score,
    user_id: source.user_id,
    agent_id: source.agent_id,
    metadata: source.metadata ?? {},
    components: source.components,
    created_at: source.created_at,
    updated_at: source.updated_at,
  };
}

function normalizeDirectMemory(memory: string | ExtractedMemory): ExtractedMemory {
  if (typeof memory === "string") {
    return {
      text: memory,
    };
  }
  return {
    id: memory.id,
    text: String(memory.text ?? ""),
    attributed_to: memory.attributed_to,
    linked_memory_ids: memory.linked_memory_ids,
    metadata: memory.metadata,
  };
}

function conversationText(messages: ChatMessage[]): string {
  return messages
    .filter((message) => message?.role === "user" || message?.role === "assistant")
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n")
    .slice(-12000);
}

export class ElasticsearchMemoryStore {
  private index: string;

  constructor(
    private deps: {
      config: MemoryConfig;
      model: OpenAICompatibleClient;
    },
  ) {
    this.index = deps.config.elasticsearch.index;
  }

  private get config(): MemoryConfig {
    return this.deps.config;
  }

  private get model(): OpenAICompatibleClient {
    return this.deps.model;
  }

  authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const es = this.config.elasticsearch;
    if (es.apiKey) headers.authorization = `ApiKey ${es.apiKey}`;
    else if (es.username && es.password) headers.authorization = `Basic ${b64(`${es.username}:${es.password}`)}`;
    return headers;
  }

  async request(path: string, { method = "GET", body, ok = [200] }: { method?: string; body?: unknown; ok?: number[] } = {}): Promise<any> {
    const url = `${this.config.elasticsearch.url.replace(/\/+$/, "")}${path}`;
    const response = await fetch(url, {
      method,
      headers: this.authHeaders(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!ok.includes(response.status)) {
      const err = new Error(`Elasticsearch ${method} ${path} failed: ${response.status} ${text.slice(0, 500)}`) as Error & { status?: number; body?: string };
      err.status = response.status;
      err.body = text;
      throw err;
    }
    if (!text) return undefined;
    return JSON.parse(text);
  }

  async ensureIndex(): Promise<boolean> {
    const exists = await fetch(`${this.config.elasticsearch.url.replace(/\/+$/, "")}/${encodeURIComponent(this.index)}`, {
      method: "HEAD",
      headers: this.authHeaders(),
    });
    if (exists.status === 200) return false;
    if (exists.status !== 404) throw new Error(`Elasticsearch index check failed: ${exists.status} ${await exists.text()}`);

    await this.request(`/${encodeURIComponent(this.index)}`, {
      method: "PUT",
      ok: [200],
      body: {
        settings: { number_of_shards: 1, number_of_replicas: 0, refresh_interval: "1s" },
        mappings: {
          dynamic: true,
          properties: {
            memory: { type: "text" },
            text_lemmatized: { type: "text" },
            vector: {
              type: "dense_vector",
              dims: this.config.openaiCompatible.embeddingDims,
              index: true,
              similarity: "cosine",
            },
            user_id: { type: "keyword" },
            agent_id: { type: "keyword" },
            source: { type: "keyword" },
            metadata: { type: "flattened" },
            created_at: { type: "date" },
            updated_at: { type: "date" },
          },
        },
      },
    });
    return true;
  }

  private async relatedMemoriesForText(text: string, userId?: string): Promise<MemoryRecord[]> {
    if (!String(text ?? "").trim()) return [];
    return this.search(text, {
      user_id: userId,
      top_k: 10,
      threshold: 0,
    });
  }

  private async storeMemories(memories: ExtractedMemory[], {
    userId,
    metadata = {},
    source,
  }: {
    userId: string;
    metadata?: Record<string, unknown>;
    source?: string;
  }): Promise<Array<{ id: string; memory: string; event: string }>> {
    const results = [];
    const metadataSource = typeof metadata.source === "string" ? metadata.source : undefined;
    const memorySource = source ?? metadataSource ?? "OPENCLAW";
    for (const memory of memories) {
      const text = String(memory.text ?? "").trim();
      if (!text) continue;

      const id = randomUUID();
      const now = new Date().toISOString();
      const vector = await this.model.embed(text);
      const memoryMetadata: Record<string, unknown> = { ...metadata, ...(memory.metadata ?? {}), source: memorySource };
      if (memory.attributed_to) memoryMetadata.attributed_to = memory.attributed_to;
      if (memory.linked_memory_ids?.length) memoryMetadata.linked_memory_ids = memory.linked_memory_ids;
      const doc = {
        id,
        memory: text,
        text_lemmatized: lemmatizeForSearch(text),
        vector,
        user_id: userId,
        agent_id: metadata.agent_id,
        source: memorySource,
        metadata: memoryMetadata,
        created_at: now,
        updated_at: now,
      };
      await this.request(`/${encodeURIComponent(this.index)}/_doc/${encodeURIComponent(id)}`, {
        method: "PUT",
        ok: [200, 201],
        body: doc,
      });
      results.push({ id, memory: text, event: "ADD" });
    }
    return results;
  }

  async add(messages: ChatMessage[], options: AddOptions = {}): Promise<{ results: Array<{ id: string; memory: string; event: string }> }> {
    await this.ensureIndex();
    const userId = options.user_id ?? this.config.userId;
    const metadata = options.metadata ?? {};
    const directMemories = options.deduced_memories ?? options.memories;
    let memories: ExtractedMemory[];

    if (Array.isArray(directMemories) && directMemories.length) {
      memories = directMemories.map((memory) => normalizeDirectMemory(memory));
      const existingMemories = await this.relatedMemoriesForText(memories.map((memory) => memory.text).join("\n"), userId);
      memories = await dedupeMemories(this.model, memories, { existingMemories });
    } else if (options.infer === false) {
      memories = messages
        .map((message) => String(message.content ?? "").trim())
        .filter(Boolean)
        .map((text) => ({ text }));
      const existingMemories = await this.relatedMemoriesForText(memories.map((memory) => memory.text).join("\n"), userId);
      memories = await dedupeMemories(this.model, memories, { existingMemories });
    } else {
      const queryText = conversationText(messages);
      const existingMemories = await this.relatedMemoriesForText(queryText, userId);
      memories = await extractMemories(
        this.model,
        messages,
        { existingMemories },
      );
    }

    return {
      results: await this.storeMemories(memories, {
        userId,
        metadata,
        source: options.source,
      }),
    };
  }

  async triage(messages: ChatMessage[], options: TriageOptions = {}): Promise<{ memories: ExtractedMemory[] }> {
    const userId = options.user_id ?? this.config.userId;
    const existingMemories = await this.relatedMemoriesForText(conversationText(messages), userId);
    const memories = await extractMemories(this.model, messages, { existingMemories });
    return { memories };
  }

  async search(query: string, options: SearchOptions = {}): Promise<MemoryRecord[]> {
    await this.ensureIndex();
    const topK = options.top_k ?? this.config.topK;
    const userId = options.user_id ?? this.config.userId;
    const filters = buildFilterClauses({
      userId,
      filters: options.filters,
    });
    const vector = await this.model.embed(query);

    const semanticPromise = this.request(`/${encodeURIComponent(this.index)}/_search`, {
      method: "POST",
      body: buildKnnSearchBody({ vector, topK, filters, numCandidates: this.config.search.numCandidates }),
    });

    const [semanticResponse, keywordResponse] = await Promise.all([
      semanticPromise,
      this.request(`/${encodeURIComponent(this.index)}/_search`, {
        method: "POST",
        body: buildKeywordSearchBody({ query, topK, filters }),
      }),
    ]);
    const semantic = hitsToRankedItems(semanticResponse?.hits?.hits ?? []);
    const keyword = hitsToRankedItems(keywordResponse?.hits?.hits ?? []);
    const byId = new Map([...semantic, ...keyword].map((item) => [item.id, item.payload]));

    const bm25Scores = keywordHitsToBm25Scores({ query, hits: keyword });
    const ranked = scoreHybridResults({
      semantic,
      bm25Scores,
      keywordPayloads: hitsToPayloadMap(keyword),
      threshold: options.threshold ?? 0,
      topK,
      weights: {
        semantic: this.config.search.semanticWeight,
        keyword: this.config.search.keywordWeight,
      },
    });

    const candidates = ranked.map((item) => normalizeHit({
      _id: item.id,
      _score: item.score,
      _source: { ...(item.payload ?? byId.get(item.id) ?? {}), components: item.components },
    }));

    if (!this.config.reranker.enabled || candidates.length <= 1) return candidates.slice(0, topK);

    const reranker = new JinaReranker(this.config.reranker);
    const reranked = await reranker.rerank({
      query,
      documents: candidates.map((candidate) => candidate.memory),
      topN: topK,
    });

    const results: MemoryRecord[] = [];
    for (const result of reranked) {
      const candidate = candidates[result.index];
      if (!candidate) continue;
      const originalScore = candidate.score ?? 0;
      const rerankScore = Math.max(0, Math.min(result.relevance_score, 1));
      results.push({
        ...candidate,
        score: rerankScore,
        components: {
          ...(candidate.components ?? {}),
          original: originalScore,
          rerank: rerankScore,
        },
      });
    }
    return results;
  }

  async get(memoryId: string): Promise<MemoryRecord> {
    const response = await this.request(`/${encodeURIComponent(this.index)}/_doc/${encodeURIComponent(memoryId)}`, { ok: [200] });
    return normalizeHit({ _id: response._id, _score: 1, _source: response._source });
  }

  async list(options: SearchOptions & { page_size?: number; limit?: number } = {}): Promise<MemoryRecord[]> {
    await this.ensureIndex();
    const filters = buildFilterClauses({
      userId: options.user_id ?? this.config.userId,
      filters: options.filters,
    });
    const response = await this.request(`/${encodeURIComponent(this.index)}/_search`, {
      method: "POST",
      body: {
        size: options.page_size ?? options.limit ?? 50,
        query: filters.length ? { bool: { filter: filters } } : { match_all: {} },
        sort: [{ updated_at: "desc" }],
        _source: { excludes: ["vector"] },
      },
    });
    return (response?.hits?.hits ?? []).map(normalizeHit);
  }

  async update(memoryId: string, text: string, metadata: Record<string, unknown> = {}): Promise<MemoryRecord> {
    const existing = await this.get(memoryId);
    const now = new Date().toISOString();
    const vector = await this.model.embed(text);
    const doc = {
      memory: text,
      text_lemmatized: lemmatizeForSearch(text),
      vector,
      metadata: { ...(existing.metadata ?? {}), ...metadata },
      updated_at: now,
    };
    await this.request(`/${encodeURIComponent(this.index)}/_update/${encodeURIComponent(memoryId)}`, { method: "POST", body: { doc } });
    return { ...existing, memory: text, updated_at: now };
  }

  async delete(memoryId: string): Promise<{ deleted: number }> {
    await this.request(`/${encodeURIComponent(this.index)}/_doc/${encodeURIComponent(memoryId)}`, { method: "DELETE", ok: [200, 202, 404] });
    return { deleted: 1 };
  }

  async deleteByQuery(query: string, options: SearchOptions = {}): Promise<{ deleted: number; ids: string[] }> {
    const matches = (await this.search(query, { ...options, top_k: options.top_k ?? 50 }))
      .filter((match) => literalMemoryTextMatch(query, match.memory));
    for (const match of matches) await this.delete(match.id);
    return { deleted: matches.length, ids: matches.map((match) => match.id) };
  }

  async deleteAll(userId?: string): Promise<{ deleted: number }> {
    const filters = buildFilterClauses({ userId: userId ?? this.config.userId });
    const response = await this.request(`/${encodeURIComponent(this.index)}/_delete_by_query`, {
      method: "POST",
      ok: [200],
      body: { query: { bool: { filter: filters } } },
    });
    return { deleted: response.deleted ?? 0 };
  }
}
