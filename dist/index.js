// src/index.ts
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

// src/config.ts
import { userInfo } from "os";
var DEFAULT_INDEX = "openclaw-memory";
var DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
var DEFAULT_LLM_MODEL = "gpt-4o-mini";
var DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
var DEFAULT_EMBEDDING_DIMS = 1536;
var DEFAULT_RERANKER_BASE_URL = "https://api.jina.ai";
var DEFAULT_RERANKER_MODEL = "jina-reranker-v3";
function boolValue(value, defaultValue) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (["true", "1", "yes", "on"].includes(value.toLowerCase())) return true;
    if (["false", "0", "no", "off"].includes(value.toLowerCase())) return false;
  }
  return defaultValue;
}
function numberValue(value, defaultValue) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return defaultValue;
}
function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function envTemplateValue(value, env) {
  if (typeof value !== "string" || !value.trim()) return void 0;
  const match = value.trim().match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/);
  if (!match) return value;
  return env[match[1]];
}
function username(env = process.env) {
  try {
    return userInfo().username || env.USER || "default";
  } catch {
    return env.USER || "default";
  }
}
function parseConfig(value = {}, opts = {}) {
  const env = opts.env ?? process.env;
  const cfg = objectValue(value);
  const elasticsearch = objectValue(cfg.elasticsearch);
  const openaiCompatible = objectValue(cfg.openaiCompatible);
  const llm = objectValue(openaiCompatible.llm);
  const embedding = objectValue(openaiCompatible.embedding);
  const search = objectValue(cfg.search);
  const reranker = objectValue(cfg.reranker);
  const openaiBaseUrl = openaiCompatible.baseUrl ?? env.OPENAI_BASE_URL ?? DEFAULT_OPENAI_BASE_URL;
  const openaiApiKey = envTemplateValue(openaiCompatible.apiKey, env) ?? env.OPENAI_API_KEY;
  const llmModel = llm.model ?? openaiCompatible.llmModel ?? env.OPENAI_LLM_MODEL ?? DEFAULT_LLM_MODEL;
  const embeddingModel = embedding.model ?? openaiCompatible.embeddingModel ?? env.OPENAI_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL;
  const embeddingDims = numberValue(
    embedding.dims ?? openaiCompatible.embeddingDims ?? env.OPENAI_EMBEDDING_DIMS,
    DEFAULT_EMBEDDING_DIMS
  );
  const llmConfig = {
    baseUrl: llm.baseUrl ?? env.OPENAI_LLM_BASE_URL ?? openaiBaseUrl,
    apiKey: envTemplateValue(llm.apiKey, env) ?? env.OPENAI_LLM_API_KEY ?? openaiApiKey,
    model: llmModel
  };
  const embeddingConfig = {
    baseUrl: embedding.baseUrl ?? env.OPENAI_EMBEDDING_BASE_URL ?? openaiBaseUrl,
    apiKey: envTemplateValue(embedding.apiKey, env) ?? env.OPENAI_EMBEDDING_API_KEY ?? openaiApiKey,
    model: embeddingModel,
    dims: embeddingDims
  };
  const rerankerEnabled = boolValue(reranker.enabled, false);
  const rerankerApiKey = rerankerEnabled ? envTemplateValue(reranker.apiKey, env) ?? env.JINA_API_KEY : void 0;
  return {
    userId: typeof cfg.userId === "string" && cfg.userId ? cfg.userId : opts.username ?? username(env),
    autoRecall: boolValue(cfg.autoRecall, true),
    autoCapture: boolValue(cfg.autoCapture, true),
    topK: numberValue(cfg.topK, 5),
    searchThreshold: numberValue(cfg.searchThreshold, 0.05),
    elasticsearch: {
      url: elasticsearch.url ?? env.ELASTICSEARCH_URL ?? "http://localhost:9200",
      index: elasticsearch.index ?? env.ELASTICSEARCH_INDEX ?? DEFAULT_INDEX,
      apiKey: elasticsearch.apiKey ?? env.ELASTICSEARCH_API_KEY,
      username: elasticsearch.username ?? env.ELASTICSEARCH_USERNAME,
      password: elasticsearch.password ?? env.ELASTICSEARCH_PASSWORD
    },
    openaiCompatible: {
      baseUrl: openaiBaseUrl,
      apiKey: openaiApiKey,
      llmModel,
      embeddingModel,
      embeddingDims,
      llm: llmConfig,
      embedding: embeddingConfig
    },
    search: {
      mode: "hybrid",
      numCandidates: numberValue(search.numCandidates, 100),
      semanticWeight: numberValue(search.semanticWeight, 0.6),
      keywordWeight: numberValue(search.keywordWeight, 0.4)
    },
    reranker: {
      enabled: rerankerEnabled,
      provider: "jina",
      baseUrl: reranker.baseUrl ?? env.JINA_BASE_URL ?? DEFAULT_RERANKER_BASE_URL,
      apiKey: rerankerApiKey,
      model: reranker.model ?? env.JINA_RERANKER_MODEL ?? DEFAULT_RERANKER_MODEL
    }
  };
}
function redactedConfigSummary(config) {
  return {
    userId: config.userId,
    autoRecall: config.autoRecall,
    autoCapture: config.autoCapture,
    topK: config.topK,
    elasticsearch: {
      url: config.elasticsearch.url,
      index: config.elasticsearch.index,
      auth: config.elasticsearch.apiKey ? "apiKey" : config.elasticsearch.username ? "basic" : "none"
    },
    openaiCompatible: {
      baseUrl: config.openaiCompatible.baseUrl,
      llmModel: config.openaiCompatible.llmModel,
      embeddingModel: config.openaiCompatible.embeddingModel,
      embeddingDims: config.openaiCompatible.embeddingDims,
      apiKeyConfigured: Boolean(config.openaiCompatible.apiKey),
      llm: {
        baseUrl: config.openaiCompatible.llm.baseUrl,
        model: config.openaiCompatible.llm.model,
        apiKeyConfigured: Boolean(config.openaiCompatible.llm.apiKey)
      },
      embedding: {
        baseUrl: config.openaiCompatible.embedding.baseUrl,
        model: config.openaiCompatible.embedding.model,
        dims: config.openaiCompatible.embedding.dims,
        apiKeyConfigured: Boolean(config.openaiCompatible.embedding.apiKey)
      }
    },
    search: config.search,
    reranker: {
      enabled: config.reranker.enabled,
      provider: config.reranker.provider,
      baseUrl: config.reranker.baseUrl,
      model: config.reranker.model,
      apiKeyConfigured: Boolean(config.reranker.apiKey)
    }
  };
}

// src/clients/openai-compatible.ts
function urlJoin(baseUrl, path) {
  return `${String(baseUrl).replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
var OpenAICompatibleClient = class {
  constructor(config) {
    this.config = config;
  }
  config;
  headers(endpoint, purpose) {
    if (!endpoint.apiKey) throw new Error(`OpenAI-compatible API key is required for ${purpose}`);
    return {
      "content-type": "application/json",
      authorization: `Bearer ${endpoint.apiKey}`
    };
  }
  async embed(text) {
    const endpoint = this.config.embedding;
    const response = await fetch(urlJoin(endpoint.baseUrl, "/embeddings"), {
      method: "POST",
      headers: this.headers(endpoint, "embeddings"),
      body: JSON.stringify({
        model: endpoint.model,
        input: text
      })
    });
    const bodyText = await response.text();
    if (!response.ok) throw new Error(`OpenAI-compatible embeddings failed: ${response.status} ${bodyText.slice(0, 300)}`);
    const json = JSON.parse(bodyText);
    const embedding = json?.data?.[0]?.embedding;
    if (!Array.isArray(embedding)) throw new Error("OpenAI-compatible embeddings response did not include data[0].embedding");
    return embedding;
  }
  async completeJson({ system, user }) {
    const endpoint = this.config.llm;
    const response = await fetch(urlJoin(endpoint.baseUrl, "/chat/completions"), {
      method: "POST",
      headers: this.headers(endpoint, "chat completions"),
      body: JSON.stringify({
        model: endpoint.model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      })
    });
    const bodyText = await response.text();
    if (!response.ok) throw new Error(`OpenAI-compatible chat failed: ${response.status} ${bodyText.slice(0, 300)}`);
    const json = JSON.parse(bodyText);
    const content = json?.choices?.[0]?.message?.content ?? "{}";
    try {
      return JSON.parse(content);
    } catch {
      throw new Error("OpenAI-compatible chat response was not valid JSON");
    }
  }
};

// src/stores/elasticsearch.ts
import { randomUUID } from "crypto";

// src/retrieval/search.ts
function lemmatizeForSearch(text) {
  return String(text ?? "").toLowerCase().replace(/[`"'“”‘’]/g, " ").replace(/[^\p{L}\p{N}_./:-]+/gu, " ").replace(/\s+/g, " ").trim();
}
function literalMemoryTextMatch(query, text) {
  const normalizedQuery = lemmatizeForSearch(query);
  if (!normalizedQuery) return false;
  return lemmatizeForSearch(text).includes(normalizedQuery);
}
function buildFilterClauses({ userId, filters } = {}) {
  const clauses = [];
  if (userId) clauses.push({ term: { user_id: userId } });
  if (filters && typeof filters === "object" && !Array.isArray(filters)) {
    for (const [key, value] of Object.entries(filters)) {
      if (value === void 0 || value === null) continue;
      if (Array.isArray(value)) clauses.push({ terms: { [`metadata.${key}`]: value } });
      else clauses.push({ term: { [`metadata.${key}`]: value } });
    }
  }
  return clauses;
}
function buildKeywordQuery(query, filters = []) {
  const normalized = lemmatizeForSearch(query);
  const textQuery = normalized ? {
    bool: {
      should: [
        { multi_match: { query, fields: ["memory^3", "text_lemmatized^2", "metadata.summary", "metadata.topic"], type: "best_fields" } },
        { match_phrase: { memory: { query, boost: 2 } } }
      ],
      minimum_should_match: 1
    }
  } : { match_all: {} };
  if (!filters.length) return textQuery;
  return { bool: { must: [textQuery], filter: filters } };
}
function buildKnnSearchBody({ vector, topK, filters = [], numCandidates = 100 }) {
  const knnFilter = filters.length ? { bool: { filter: filters } } : void 0;
  return {
    size: topK,
    knn: {
      field: "vector",
      query_vector: vector,
      k: topK,
      num_candidates: Math.max(numCandidates, topK),
      ...knnFilter ? { filter: knnFilter } : {}
    },
    _source: { excludes: ["vector"] }
  };
}
function buildKeywordSearchBody({ query, topK, filters = [] }) {
  return {
    size: topK,
    query: buildKeywordQuery(query, filters),
    _source: { excludes: ["vector"] }
  };
}
function bm25ParamsForQuery(query, lemmatized = lemmatizeForSearch(query)) {
  const terms = lemmatized ? lemmatized.split(/\s+/).filter(Boolean).length : 1;
  if (terms <= 3) return { midpoint: 5, steepness: 0.7 };
  if (terms <= 6) return { midpoint: 7, steepness: 0.6 };
  if (terms <= 9) return { midpoint: 9, steepness: 0.5 };
  if (terms <= 15) return { midpoint: 10, steepness: 0.5 };
  return { midpoint: 12, steepness: 0.5 };
}
function normalizeBm25Score({ query, rawScore, lemmatized }) {
  const score = Number(rawScore);
  if (!Number.isFinite(score) || score <= 0) return 0;
  const { midpoint, steepness } = bm25ParamsForQuery(query, lemmatized);
  return 1 / (1 + Math.exp(-steepness * (score - midpoint)));
}
function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  if (number >= 1) return 1;
  return number;
}
function mapValue(source, key) {
  if (!source) return void 0;
  if (source instanceof Map) return source.get(key);
  return source[key];
}
function keywordHitsToBm25Scores({ query, hits = [] }) {
  const lemmatized = lemmatizeForSearch(query);
  return new Map(
    hits.map((item) => [String(item.id), normalizeBm25Score({ query, lemmatized, rawScore: item.score ?? 0 })]).filter(([, score]) => score > 0)
  );
}
function hitsToPayloadMap(items = []) {
  return new Map(items.map((item) => [String(item.id), item.payload]).filter(([, payload]) => payload));
}
function scoreHybridResults({
  semantic = [],
  bm25Scores = /* @__PURE__ */ new Map(),
  keywordPayloads = /* @__PURE__ */ new Map(),
  threshold = 0,
  topK = 5,
  weights = {}
}) {
  const semanticWeight = Number.isFinite(weights.semantic) ? weights.semantic : 0.6;
  const keywordWeight = Number.isFinite(weights.keyword) ? weights.keyword : 0.4;
  const maxPossible = Math.max(semanticWeight + keywordWeight, 1);
  const candidates = /* @__PURE__ */ new Map();
  for (const item of semantic) {
    const id = String(item.id);
    const semanticScore = clamp01(item.score);
    if (semanticScore < threshold) continue;
    candidates.set(id, { id, semanticScore, payload: item.payload, semantic: true });
  }
  const keywordEntries = bm25Scores instanceof Map ? bm25Scores.entries() : Object.entries(bm25Scores ?? {});
  for (const [rawId, rawScore] of keywordEntries) {
    const id = String(rawId);
    const bm25Score = clamp01(rawScore);
    if (bm25Score <= 0) continue;
    const existing = candidates.get(id) ?? { id, semanticScore: 0, payload: mapValue(keywordPayloads, id), semantic: false };
    existing.bm25Score = bm25Score;
    existing.keyword = true;
    existing.payload = existing.payload ?? mapValue(keywordPayloads, id);
    candidates.set(id, existing);
  }
  const scored = [];
  for (const candidate of candidates.values()) {
    const rawScore = semanticWeight * (candidate.semanticScore ?? 0) + keywordWeight * (candidate.bm25Score ?? 0);
    if (rawScore <= 0) continue;
    scored.push({
      id: candidate.id,
      score: Math.min(rawScore / maxPossible, 1),
      payload: candidate.payload,
      semantic: Boolean(candidate.semantic),
      keyword: Boolean(candidate.keyword),
      components: {
        semantic: candidate.semanticScore ?? 0,
        bm25: candidate.bm25Score ?? 0
      }
    });
  }
  return scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, topK);
}
function hitsToRankedItems(hits = []) {
  return hits.map((hit) => ({
    id: hit._id ?? hit._source?.id,
    score: hit._score,
    payload: hit._source
  })).filter((item) => item.id);
}

// src/extraction/memory-extraction.ts
function serializeMemories(memories = []) {
  if (!memories.length) return "[]";
  return JSON.stringify(
    memories.map((memory) => ({ id: String(memory.id), text: String(memory.memory ?? "") })).filter((memory) => memory.id && memory.text),
    null,
    2
  );
}
function metadataForMemory(memory) {
  const metadata = typeof memory.metadata === "object" && memory.metadata ? { ...memory.metadata } : {};
  if (memory.attributed_to) metadata.attributed_to = String(memory.attributed_to);
  if (Array.isArray(memory.linked_memory_ids) && memory.linked_memory_ids.length) {
    metadata.linked_memory_ids = memory.linked_memory_ids.map(String);
  }
  return Object.keys(metadata).length ? metadata : void 0;
}
function normalizeExtractedMemories(result) {
  const rawMemories = Array.isArray(result?.memory) ? result.memory : [];
  return rawMemories.map((memory) => ({
    id: memory.id === void 0 ? void 0 : String(memory.id),
    text: String(memory.text ?? "").trim(),
    attributed_to: memory.attributed_to === void 0 ? void 0 : String(memory.attributed_to),
    linked_memory_ids: Array.isArray(memory.linked_memory_ids) ? memory.linked_memory_ids.map(String) : void 0,
    metadata: metadataForMemory(memory)
  })).filter((memory) => memory.text.length > 0);
}
function additiveMemorySystemPrompt() {
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
    "Return JSON only."
  ].join(" ");
}
function memoryDedupeSystemPrompt() {
  return [
    "You are a Memory Deduper. Your sole operation is KEEP or SKIP candidate memories.",
    "Use Existing Memories and Recently Extracted Memories only for deduplication and linking.",
    "Return only candidate memories that are durable and not semantically equivalent to existing memories.",
    "If a candidate memory is related to an Existing Memory but adds meaningful new context, keep it and include that existing ID in linked_memory_ids.",
    "If a candidate memory is already captured and adds no meaningful context, skip it.",
    "Do not create new memories from Existing Memories or Recently Extracted Memories.",
    "Include secrets, API keys, passwords, tokens, or secret webhook URLs when the user explicitly asks to remember or save that exact value.",
    "Return JSON only."
  ].join(" ");
}
function buildAdditiveExtractionPrompt(messages, context = {}) {
  const text = messages.filter((message) => message?.role === "user" || message?.role === "assistant").map((message) => `${message.role}: ${message.content}`).join("\n").slice(-12e3);
  const currentDate = context.currentDate ?? (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  return [
    `Current date: ${currentDate}`,
    "",
    `Recently Extracted Memories:
${serializeMemories(context.recentlyExtractedMemories)}`,
    "",
    `Existing Memories:
${serializeMemories(context.existingMemories)}`,
    "",
    `New Messages:
${text}`,
    "",
    "Return shape:",
    `{"memory":[{"id":"0","text":"self-contained memory","attributed_to":"user|assistant","linked_memory_ids":["existing-memory-id"]}]}`,
    "",
    'If nothing is worth extracting or everything is already captured, return {"memory":[]}.'
  ].join("\n");
}
function serializeCandidateMemories(memories) {
  if (!memories.length) return "[]";
  return JSON.stringify(
    memories.map((memory, index) => ({
      id: memory.id ?? String(index),
      text: memory.text,
      attributed_to: memory.attributed_to,
      linked_memory_ids: memory.linked_memory_ids
    })),
    null,
    2
  );
}
function buildMemoryDedupePrompt({
  candidates,
  existingMemories,
  recentlyExtractedMemories,
  currentDate
}) {
  return [
    `Current date: ${currentDate ?? (/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}`,
    "",
    `Recently Extracted Memories:
${serializeMemories(recentlyExtractedMemories)}`,
    "",
    `Existing Memories:
${serializeMemories(existingMemories)}`,
    "",
    `Candidate Memories:
${serializeCandidateMemories(candidates)}`,
    "",
    "Return shape:",
    `{"memory":[{"id":"0","text":"candidate memory to keep","attributed_to":"user|assistant","linked_memory_ids":["existing-memory-id"]}]}`,
    "",
    'Return only candidate memories that should be stored. If every candidate is duplicate, low-value, or unsafe, return {"memory":[]}.'
  ].join("\n");
}
async function extractMemories(model, messages, context = {}) {
  const text = messages.filter((message) => message?.role === "user" || message?.role === "assistant").map((message) => `${message.role}: ${message.content}`).join("\n").slice(-12e3);
  if (!text.trim()) return [];
  if (!model?.config?.llm?.apiKey) throw new Error("OpenAI-compatible API key is required for memory triage");
  const result = await model.completeJson({
    system: additiveMemorySystemPrompt(),
    user: buildAdditiveExtractionPrompt(messages, context)
  });
  return normalizeExtractedMemories(result);
}
async function dedupeMemories(model, memories, context = {}) {
  if (!memories.length) return [];
  if (!context.existingMemories?.length && !context.recentlyExtractedMemories?.length) return memories;
  if (!model?.config?.llm?.apiKey) throw new Error("OpenAI-compatible API key is required for memory deduplication");
  const result = await model.completeJson({
    system: memoryDedupeSystemPrompt(),
    user: buildMemoryDedupePrompt({
      candidates: memories,
      existingMemories: context.existingMemories,
      recentlyExtractedMemories: context.recentlyExtractedMemories,
      currentDate: context.currentDate
    })
  });
  return normalizeExtractedMemories(result);
}

// src/retrieval/reranker.ts
var JinaReranker = class {
  constructor(config) {
    this.config = config;
  }
  config;
  async rerank({ query, documents, topN }) {
    if (!this.config.apiKey) {
      throw new Error("Jina reranker is enabled but JINA_API_KEY is not configured.");
    }
    const response = await fetch(`${this.config.baseUrl.replace(/\/+$/, "")}/v1/rerank`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify({
        model: this.config.model,
        query,
        top_n: Math.max(1, Math.min(topN, documents.length)),
        documents,
        return_documents: false
      })
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Jina rerank failed: ${response.status} ${text.slice(0, 500)}`);
    }
    const payload = text ? JSON.parse(text) : {};
    const results = Array.isArray(payload.results) ? payload.results : [];
    return results.map((item) => ({
      index: Number(item.index),
      relevance_score: Number(item.relevance_score)
    })).filter(
      (item) => Number.isInteger(item.index) && item.index >= 0 && Number.isFinite(item.relevance_score)
    );
  }
};

// src/stores/elasticsearch.ts
function b64(value) {
  return Buffer.from(value).toString("base64");
}
function normalizeHit(hit) {
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
    updated_at: source.updated_at
  };
}
function normalizeDirectMemory(memory) {
  if (typeof memory === "string") {
    return {
      text: memory
    };
  }
  return {
    id: memory.id,
    text: String(memory.text ?? ""),
    attributed_to: memory.attributed_to,
    linked_memory_ids: memory.linked_memory_ids,
    metadata: memory.metadata
  };
}
function conversationText(messages) {
  return messages.filter((message) => message?.role === "user" || message?.role === "assistant").map((message) => `${message.role}: ${message.content}`).join("\n").slice(-12e3);
}
var ElasticsearchMemoryStore = class {
  constructor(deps) {
    this.deps = deps;
    this.index = deps.config.elasticsearch.index;
  }
  deps;
  index;
  get config() {
    return this.deps.config;
  }
  get model() {
    return this.deps.model;
  }
  authHeaders() {
    const headers = { "content-type": "application/json" };
    const es = this.config.elasticsearch;
    if (es.apiKey) headers.authorization = `ApiKey ${es.apiKey}`;
    else if (es.username && es.password) headers.authorization = `Basic ${b64(`${es.username}:${es.password}`)}`;
    return headers;
  }
  async request(path, { method = "GET", body, ok = [200] } = {}) {
    const url = `${this.config.elasticsearch.url.replace(/\/+$/, "")}${path}`;
    const response = await fetch(url, {
      method,
      headers: this.authHeaders(),
      body: body === void 0 ? void 0 : JSON.stringify(body)
    });
    const text = await response.text();
    if (!ok.includes(response.status)) {
      const err = new Error(`Elasticsearch ${method} ${path} failed: ${response.status} ${text.slice(0, 500)}`);
      err.status = response.status;
      err.body = text;
      throw err;
    }
    if (!text) return void 0;
    return JSON.parse(text);
  }
  async ensureIndex() {
    const exists = await fetch(`${this.config.elasticsearch.url.replace(/\/+$/, "")}/${encodeURIComponent(this.index)}`, {
      method: "HEAD",
      headers: this.authHeaders()
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
              similarity: "cosine"
            },
            user_id: { type: "keyword" },
            agent_id: { type: "keyword" },
            source: { type: "keyword" },
            metadata: { type: "flattened" },
            created_at: { type: "date" },
            updated_at: { type: "date" }
          }
        }
      }
    });
    return true;
  }
  async relatedMemoriesForText(text, userId) {
    if (!String(text ?? "").trim()) return [];
    return this.search(text, {
      user_id: userId,
      top_k: 10,
      threshold: 0
    });
  }
  async storeMemories(memories, {
    userId,
    metadata = {},
    source
  }) {
    const results = [];
    const metadataSource = typeof metadata.source === "string" ? metadata.source : void 0;
    const memorySource = source ?? metadataSource ?? "OPENCLAW";
    for (const memory of memories) {
      const text = String(memory.text ?? "").trim();
      if (!text) continue;
      const id = randomUUID();
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const vector = await this.model.embed(text);
      const memoryMetadata = { ...metadata, ...memory.metadata ?? {}, source: memorySource };
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
        updated_at: now
      };
      await this.request(`/${encodeURIComponent(this.index)}/_doc/${encodeURIComponent(id)}`, {
        method: "PUT",
        ok: [200, 201],
        body: doc
      });
      results.push({ id, memory: text, event: "ADD" });
    }
    return results;
  }
  async add(messages, options = {}) {
    await this.ensureIndex();
    const userId = options.user_id ?? this.config.userId;
    const metadata = options.metadata ?? {};
    const directMemories = options.deduced_memories ?? options.memories;
    let memories;
    if (Array.isArray(directMemories) && directMemories.length) {
      memories = directMemories.map((memory) => normalizeDirectMemory(memory));
      const existingMemories = await this.relatedMemoriesForText(memories.map((memory) => memory.text).join("\n"), userId);
      memories = await dedupeMemories(this.model, memories, { existingMemories });
    } else if (options.infer === false) {
      memories = messages.map((message) => String(message.content ?? "").trim()).filter(Boolean).map((text) => ({ text }));
      const existingMemories = await this.relatedMemoriesForText(memories.map((memory) => memory.text).join("\n"), userId);
      memories = await dedupeMemories(this.model, memories, { existingMemories });
    } else {
      const queryText = conversationText(messages);
      const existingMemories = await this.relatedMemoriesForText(queryText, userId);
      memories = await extractMemories(
        this.model,
        messages,
        { existingMemories }
      );
    }
    return {
      results: await this.storeMemories(memories, {
        userId,
        metadata,
        source: options.source
      })
    };
  }
  async triage(messages, options = {}) {
    const userId = options.user_id ?? this.config.userId;
    const existingMemories = await this.relatedMemoriesForText(conversationText(messages), userId);
    const memories = await extractMemories(this.model, messages, { existingMemories });
    return { memories };
  }
  async search(query, options = {}) {
    await this.ensureIndex();
    const topK = options.top_k ?? this.config.topK;
    const userId = options.user_id ?? this.config.userId;
    const filters = buildFilterClauses({
      userId,
      filters: options.filters
    });
    const vector = await this.model.embed(query);
    const semanticPromise = this.request(`/${encodeURIComponent(this.index)}/_search`, {
      method: "POST",
      body: buildKnnSearchBody({ vector, topK, filters, numCandidates: this.config.search.numCandidates })
    });
    const [semanticResponse, keywordResponse] = await Promise.all([
      semanticPromise,
      this.request(`/${encodeURIComponent(this.index)}/_search`, {
        method: "POST",
        body: buildKeywordSearchBody({ query, topK, filters })
      })
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
        keyword: this.config.search.keywordWeight
      }
    });
    const candidates = ranked.map((item) => normalizeHit({
      _id: item.id,
      _score: item.score,
      _source: { ...item.payload ?? byId.get(item.id) ?? {}, components: item.components }
    }));
    if (!this.config.reranker.enabled || candidates.length <= 1) return candidates.slice(0, topK);
    const reranker = new JinaReranker(this.config.reranker);
    const reranked = await reranker.rerank({
      query,
      documents: candidates.map((candidate) => candidate.memory),
      topN: topK
    });
    const results = [];
    for (const result of reranked) {
      const candidate = candidates[result.index];
      if (!candidate) continue;
      const originalScore = candidate.score ?? 0;
      const rerankScore = Math.max(0, Math.min(result.relevance_score, 1));
      results.push({
        ...candidate,
        score: rerankScore,
        components: {
          ...candidate.components ?? {},
          original: originalScore,
          rerank: rerankScore
        }
      });
    }
    return results;
  }
  async get(memoryId) {
    const response = await this.request(`/${encodeURIComponent(this.index)}/_doc/${encodeURIComponent(memoryId)}`, { ok: [200] });
    return normalizeHit({ _id: response._id, _score: 1, _source: response._source });
  }
  async list(options = {}) {
    await this.ensureIndex();
    const filters = buildFilterClauses({
      userId: options.user_id ?? this.config.userId,
      filters: options.filters
    });
    const response = await this.request(`/${encodeURIComponent(this.index)}/_search`, {
      method: "POST",
      body: {
        size: options.page_size ?? options.limit ?? 50,
        query: filters.length ? { bool: { filter: filters } } : { match_all: {} },
        sort: [{ updated_at: "desc" }],
        _source: { excludes: ["vector"] }
      }
    });
    return (response?.hits?.hits ?? []).map(normalizeHit);
  }
  async update(memoryId, text, metadata = {}) {
    const existing = await this.get(memoryId);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const vector = await this.model.embed(text);
    const doc = {
      memory: text,
      text_lemmatized: lemmatizeForSearch(text),
      vector,
      metadata: { ...existing.metadata ?? {}, ...metadata },
      updated_at: now
    };
    await this.request(`/${encodeURIComponent(this.index)}/_update/${encodeURIComponent(memoryId)}`, { method: "POST", body: { doc } });
    return { ...existing, memory: text, updated_at: now };
  }
  async delete(memoryId) {
    await this.request(`/${encodeURIComponent(this.index)}/_doc/${encodeURIComponent(memoryId)}`, { method: "DELETE", ok: [200, 202, 404] });
    return { deleted: 1 };
  }
  async deleteByQuery(query, options = {}) {
    const matches = (await this.search(query, { ...options, top_k: options.top_k ?? 50 })).filter((match) => literalMemoryTextMatch(query, match.memory));
    for (const match of matches) await this.delete(match.id);
    return { deleted: matches.length, ids: matches.map((match) => match.id) };
  }
  async deleteAll(userId) {
    const filters = buildFilterClauses({ userId: userId ?? this.config.userId });
    const response = await this.request(`/${encodeURIComponent(this.index)}/_delete_by_query`, {
      method: "POST",
      ok: [200],
      body: { query: { bool: { filter: filters } } }
    });
    return { deleted: response.deleted ?? 0 };
  }
};

// src/tools/helpers.ts
function schema(properties, required = []) {
  return { type: "object", properties, required, additionalProperties: false };
}
function textResult(text, details = {}) {
  return { content: [{ type: "text", text }], details };
}
function buildOptions(config, params = {}) {
  const user_id = params.userId ?? config.userId;
  return {
    user_id,
    top_k: params.limit ?? config.topK,
    threshold: params.threshold ?? config.searchThreshold,
    filters: params.filters
  };
}

// src/tools/memory-add.ts
function createMemoryAddTool(deps) {
  const { store, config } = deps;
  return {
    name: "memory_add",
    label: "Memory Add",
    description: "Store durable memories in Elasticsearch memory.",
    parameters: schema({
      text: { type: "string" },
      memories: { type: "array", items: { type: "string" } },
      userId: { type: "string" },
      metadata: { type: "object" }
    }),
    async execute(_id, params) {
      const memories = Array.isArray(params.memories) && params.memories.length ? params.memories : params.text ? [params.text] : [];
      if (!memories.length) return textResult("No memories provided. Pass text or memories.", { error: "missing_memories" });
      const result = await store.add([{ role: "user", content: memories.join("\n") }], {
        user_id: params.userId ?? config.userId,
        infer: false,
        deduced_memories: memories,
        source: "OPENCLAW",
        metadata: params.metadata ?? {}
      });
      return textResult(`Stored ${result.results.length} memor${result.results.length === 1 ? "y" : "ies"}: ${result.results.map((r) => `[${r.event}] ${r.memory}`).join("; ")}`, result);
    }
  };
}

// src/tools/memory-delete.ts
function createMemoryDeleteTool(deps) {
  const { store, config } = deps;
  return {
    name: "memory_delete",
    label: "Memory Delete",
    description: "Delete a memory by id, by search query, or all memories with confirmation.",
    parameters: schema({
      memoryId: { type: "string" },
      query: { type: "string" },
      all: { type: "boolean" },
      confirm: { type: "boolean" },
      userId: { type: "string" }
    }),
    async execute(_id, params) {
      let result;
      if (params.all) {
        if (!params.confirm) return textResult("Bulk delete requires confirm: true.", { error: "confirm_required" });
        result = await store.deleteAll(params.userId ?? config.userId);
      } else if (params.query) {
        result = await store.deleteByQuery(params.query, { user_id: params.userId ?? config.userId, top_k: 20 });
      } else if (params.memoryId) {
        result = await store.delete(params.memoryId);
      } else {
        return textResult("Pass memoryId, query, or all: true.", { error: "missing_target" });
      }
      return textResult(`Deleted ${result.deleted ?? 0} memor${(result.deleted ?? 0) === 1 ? "y" : "ies"}.`, result);
    }
  };
}

// src/tools/memory-get.ts
function createMemoryGetTool({ store }) {
  return {
    name: "memory_get",
    label: "Memory Get",
    description: "Retrieve one memory by id.",
    parameters: schema({ memoryId: { type: "string" } }, ["memoryId"]),
    async execute(_id, params) {
      const memory = await store.get(params.memoryId);
      return textResult(`${memory.memory}

id: ${memory.id}`, { memory });
    }
  };
}

// src/tools/memory-list.ts
function createMemoryListTool(deps) {
  const { store, config } = deps;
  return {
    name: "memory_list",
    label: "Memory List",
    description: "List memories in the current user namespace.",
    parameters: schema({
      limit: { type: "number" },
      userId: { type: "string" },
      filters: { type: "object" }
    }),
    async execute(_id, params) {
      const memories = await store.list({
        user_id: params.userId ?? config.userId,
        page_size: params.limit ?? 50,
        filters: params.filters
      });
      return textResult(
        memories.length ? memories.map((m, i) => `${i + 1}. ${m.memory} (id: ${m.id})`).join("\n") : "No memories found.",
        { count: memories.length, memories }
      );
    }
  };
}

// src/tools/memory-search.ts
function createMemorySearchTool(deps) {
  const { store, config } = deps;
  return {
    name: "memory_search",
    label: "Memory Search",
    description: "Search Elasticsearch-backed OpenClaw memories with hybrid BM25 + vector retrieval.",
    parameters: schema({
      query: { type: "string" },
      limit: { type: "number" },
      userId: { type: "string" },
      filters: { type: "object" }
    }, ["query"]),
    async execute(_id, params) {
      const results = await store.search(params.query, buildOptions(config, params));
      if (!results.length) return textResult("No relevant memories found.", { count: 0 });
      return textResult(
        `Found ${results.length} memories:

${results.map((item, index) => `${index + 1}. ${item.memory} (score: ${((item.score ?? 0) * 100).toFixed(0)}%, id: ${item.id})`).join("\n")}`,
        { count: results.length, memories: results }
      );
    }
  };
}

// src/tools/memory-triage.ts
function parseMessages(params) {
  if (Array.isArray(params.messages)) {
    return params.messages.map((message) => ({
      role: message?.role === "assistant" ? "assistant" : "user",
      content: String(message?.content ?? "").trim()
    })).filter((message) => message.content);
  }
  if (params.text) return [{ role: "user", content: String(params.text) }];
  return [];
}
function createMemoryTriageTool(deps) {
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
            content: { type: "string" }
          }
        }
      },
      userId: { type: "string" }
    }),
    async execute(_id, params) {
      const messages = parseMessages(params);
      if (!messages.length) return textResult("No conversation text provided for triage.", { error: "missing_text" });
      const result = await store.triage(messages, {
        user_id: params.userId ?? config.userId
      });
      if (!result.memories.length) return textResult("Triage found no durable memory candidates.", result);
      const lines = result.memories.map((memory, index) => `${index + 1}. ${memory.text}`);
      return textResult(
        `Triage candidates:

${lines.join("\n")}`,
        result
      );
    }
  };
}

// src/tools/memory-update.ts
function createMemoryUpdateTool({ store }) {
  return {
    name: "memory_update",
    label: "Memory Update",
    description: "Update an existing memory and re-embed it.",
    parameters: schema({ memoryId: { type: "string" }, text: { type: "string" }, metadata: { type: "object" } }, ["memoryId", "text"]),
    async execute(_id, params) {
      const memory = await store.update(params.memoryId, params.text, params.metadata ?? {});
      return textResult(`Updated memory ${memory.id}: ${memory.memory}`, { memory });
    }
  };
}

// src/tools/index.ts
function createMemoryTools(deps) {
  return [
    createMemorySearchTool(deps),
    createMemoryAddTool(deps),
    createMemoryGetTool(deps),
    createMemoryListTool(deps),
    createMemoryUpdateTool(deps),
    createMemoryDeleteTool(deps),
    createMemoryTriageTool(deps)
  ];
}
function registerAllTools(api, deps) {
  for (const tool of createMemoryTools(deps)) api.registerTool(tool, { optional: false });
}

// src/cli/commands.ts
import { userInfo as userInfo2 } from "os";

// src/cli/config-file.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
var PLUGIN_ID = "memory-elasticsearch";
var OPENCLAW_CONFIG_DIR = join(homedir(), ".openclaw");
var OPENCLAW_CONFIG_FILE = join(OPENCLAW_CONFIG_DIR, "openclaw.json");
var OPENCLAW_ENV_FILE = join(OPENCLAW_CONFIG_DIR, ".env");
var MEMORY_TOOL_ALLOWLIST = [
  "memory_search",
  "memory_add",
  "memory_get",
  "memory_list",
  "memory_update",
  "memory_delete",
  "memory_triage"
];
function readJsonObject(path) {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, "utf8");
  if (!text.trim()) return {};
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path} must contain a JSON object`);
  }
  return parsed;
}
function writeJsonObject(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 448 });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}
`, { mode: 384 });
}
function mergeStringList(existing, values, path) {
  if (existing !== void 0 && !Array.isArray(existing)) {
    throw new Error(`${path} must be an array`);
  }
  const existingValues = Array.isArray(existing) ? existing : [];
  return [...new Set([...existingValues, ...values].map((value) => {
    if (typeof value !== "string" || !value.trim()) throw new Error(`${path} must contain only non-empty strings`);
    return value;
  }))];
}
function removeStringListValues(existing, values, path) {
  if (existing !== void 0 && !Array.isArray(existing)) {
    throw new Error(`${path} must be an array`);
  }
  const blocked = new Set(values);
  const next = [];
  const removed = [];
  for (const value of Array.isArray(existing) ? existing : []) {
    if (typeof value !== "string" || !value.trim()) throw new Error(`${path} must contain only non-empty strings`);
    if (blocked.has(value)) {
      removed.push(value);
      continue;
    }
    next.push(value);
  }
  return { next, removed };
}
function buildPluginConfig(input) {
  return {
    userId: input.userId,
    autoRecall: input.autoRecall,
    autoCapture: input.autoCapture,
    topK: input.topK,
    searchThreshold: input.searchThreshold,
    elasticsearch: {
      url: input.elasticsearchUrl,
      index: input.elasticsearchIndex,
      ...input.elasticsearchApiKey ? { apiKey: input.elasticsearchApiKey } : {},
      ...input.elasticsearchUsername ? { username: input.elasticsearchUsername } : {},
      ...input.elasticsearchPassword ? { password: input.elasticsearchPassword } : {}
    },
    search: {
      mode: "hybrid",
      numCandidates: 100,
      semanticWeight: 0.6,
      keywordWeight: 0.4
    },
    openaiCompatible: {
      baseUrl: input.openaiCompatibleBaseUrl,
      apiKey: input.openaiCompatibleApiKeyRef,
      llmModel: input.llmModel,
      embeddingModel: input.embeddingModel,
      embeddingDims: input.embeddingDims,
      llm: {
        baseUrl: input.llmBaseUrl,
        apiKey: input.llmApiKeyRef,
        model: input.llmModel
      },
      embedding: {
        baseUrl: input.embeddingBaseUrl,
        apiKey: input.embeddingApiKeyRef,
        model: input.embeddingModel,
        dims: input.embeddingDims
      }
    },
    reranker: {
      enabled: input.rerankerEnabled,
      provider: "jina",
      baseUrl: input.rerankerBaseUrl,
      ...input.rerankerApiKeyRef ? { apiKey: input.rerankerApiKeyRef } : {},
      model: input.rerankerModel
    }
  };
}
function patchOpenClawConfig(input, path = OPENCLAW_CONFIG_FILE) {
  const config = readJsonObject(path);
  config.tools ??= {};
  if (!config.tools || typeof config.tools !== "object" || Array.isArray(config.tools)) {
    throw new Error("tools must be a JSON object");
  }
  config.tools.alsoAllow = mergeStringList(config.tools.alsoAllow, MEMORY_TOOL_ALLOWLIST, "tools.alsoAllow");
  config.plugins ??= {};
  config.plugins.entries ??= {};
  config.plugins.slots ??= {};
  config.plugins.entries[PLUGIN_ID] = {
    enabled: true,
    config: buildPluginConfig(input),
    hooks: {
      allowConversationAccess: true
    }
  };
  config.plugins.slots.memory = PLUGIN_ID;
  writeJsonObject(path, config);
}
function cleanupOpenClawConfig(path = OPENCLAW_CONFIG_FILE) {
  const config = readJsonObject(path);
  const result = {
    removedTools: [],
    keptTools: [],
    removedAlsoAllow: false,
    removedPluginEntry: false,
    resetMemorySlot: false,
    changed: false
  };
  const tools = config.tools;
  if (tools !== void 0) {
    if (!tools || typeof tools !== "object" || Array.isArray(tools)) throw new Error("tools must be a JSON object");
    if (Object.prototype.hasOwnProperty.call(tools, "alsoAllow")) {
      const { next, removed } = removeStringListValues(tools.alsoAllow, MEMORY_TOOL_ALLOWLIST, "tools.alsoAllow");
      result.removedTools = removed;
      result.keptTools = next;
      if (removed.length > 0) {
        if (next.length > 0) {
          tools.alsoAllow = next;
        } else {
          delete tools.alsoAllow;
          result.removedAlsoAllow = true;
        }
        result.changed = true;
      }
    }
  }
  const plugins = config.plugins;
  if (plugins && typeof plugins === "object" && !Array.isArray(plugins)) {
    const entries = plugins.entries;
    if (entries && typeof entries === "object" && !Array.isArray(entries) && Object.prototype.hasOwnProperty.call(entries, PLUGIN_ID)) {
      delete entries[PLUGIN_ID];
      result.removedPluginEntry = true;
      result.changed = true;
    }
    const slots = plugins.slots;
    if (slots && typeof slots === "object" && !Array.isArray(slots) && slots.memory === PLUGIN_ID) {
      slots.memory = "memory-core";
      result.resetMemorySlot = true;
      result.changed = true;
    }
  }
  if (result.changed) writeJsonObject(path, config);
  return result;
}
function readOpenClawPluginConfig(path = OPENCLAW_CONFIG_FILE) {
  const config = readJsonObject(path);
  const pluginConfig = config.plugins?.entries?.[PLUGIN_ID]?.config;
  if (!pluginConfig || typeof pluginConfig !== "object" || Array.isArray(pluginConfig)) return void 0;
  return pluginConfig;
}
function upsertEnvVar(name, value, path = OPENCLAW_ENV_FILE) {
  mkdirSync(dirname(path), { recursive: true, mode: 448 });
  const lines = existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/) : [];
  const prefix = `${name}=`;
  let replaced = false;
  const next = lines.filter((line) => line.length > 0).map((line) => {
    if (line.startsWith(prefix)) {
      replaced = true;
      return `${name}=${value}`;
    }
    return line;
  });
  if (!replaced) next.push(`${name}=${value}`);
  writeFileSync(path, `${next.join("\n")}
`, { mode: 384 });
  try {
    chmodSync(path, 384);
  } catch {
  }
}

// src/cli/commands.ts
var DEFAULT_BASE_URL = "https://api.openai.com/v1";
var DEFAULT_LLM_MODEL2 = "gpt-4o-mini";
var DEFAULT_EMBEDDING_MODEL2 = "text-embedding-3-small";
var DEFAULT_EMBEDDING_DIMS2 = 1536;
var DEFAULT_RERANKER_BASE_URL2 = "https://api.jina.ai";
var DEFAULT_RERANKER_MODEL2 = "jina-reranker-v3";
var DEFAULT_ELASTICSEARCH_URL = "http://localhost:9200";
var DEFAULT_INDEX2 = "openclaw-memory";
function systemUser() {
  try {
    return userInfo2().username || "default";
  } catch {
    return "default";
  }
}
function numberOption(value, defaultValue) {
  if (!value) return defaultValue;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid number: ${value}`);
  return parsed;
}
function objectValue2(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function stringValue(value) {
  return typeof value === "string" && value.length > 0 ? value : void 0;
}
function numberValue2(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : void 0;
}
function booleanValue(value) {
  return typeof value === "boolean" ? value : void 0;
}
function optionWasSet(command, name) {
  return command?.getOptionValueSource?.(name) === "cli";
}
function reusableOption(opts, command, name, reusedValue, defaultValue) {
  if (optionWasSet(command, name)) return opts[name];
  if (opts.reuseValues && reusedValue !== void 0) return reusedValue;
  return defaultValue;
}
function out(text) {
  process.stdout.write(`${text}
`);
}
function errOut(text) {
  process.stderr.write(`${text}
`);
}
function jsonOut(opts, payload) {
  if (!opts.json) return false;
  out(JSON.stringify(payload, null, 2));
  return true;
}
function searchOptions(config, opts) {
  return {
    user_id: opts.userId ?? config.userId,
    top_k: numberOption(opts.topK, config.topK),
    threshold: "threshold" in opts ? numberOption(opts.threshold, config.searchThreshold) : config.searchThreshold
  };
}
function formatMemories(memories) {
  if (!memories.length) return "No memories found.";
  return memories.map((memory, index) => {
    const score = memory.score === void 0 ? "" : ` score=${memory.score.toFixed(3)}`;
    return `${index + 1}. ${memory.memory} (id=${memory.id}${score})`;
  }).join("\n");
}
function commandText(parts) {
  return Array.isArray(parts) ? parts.join(" ").trim() : String(parts ?? "").trim();
}
function registerCliCommands(api, config, store) {
  if (typeof api.registerCli !== "function") return;
  api.registerCli(({ program }) => {
    const root = program.command("memory-elasticsearch").alias("memory-es").description("Elasticsearch memory plugin commands");
    root.command("init").description("Configure memory-elasticsearch without editing openclaw.json by hand").option("--user-id <id>", "Memory user namespace").option("--base-url <url>", "OpenAI-compatible base URL", DEFAULT_BASE_URL).option("--api-key <key>", "Shared OpenAI-compatible API key; stored in ~/.openclaw/.env").option("--llm-base-url <url>", "LLM OpenAI-compatible base URL; defaults to --base-url").option("--llm-api-key <key>", "LLM API key; defaults to --api-key").option("--llm-model <model>", "LLM model", DEFAULT_LLM_MODEL2).option("--embedding-base-url <url>", "Embedding OpenAI-compatible base URL; defaults to --base-url").option("--embedding-api-key <key>", "Embedding API key; defaults to --api-key").option("--embedding-model <model>", "Embedding model", DEFAULT_EMBEDDING_MODEL2).option("--embedding-dims <n>", "Embedding vector dimensions", String(DEFAULT_EMBEDDING_DIMS2)).option("--reranker", "Enable Jina reranker").option("--reranker-base-url <url>", "Jina reranker base URL", DEFAULT_RERANKER_BASE_URL2).option("--reranker-api-key <key>", "Jina API key; stored in ~/.openclaw/.env").option("--reranker-model <model>", "Reranker model", DEFAULT_RERANKER_MODEL2).option("--elasticsearch-url <url>", "Elasticsearch URL", DEFAULT_ELASTICSEARCH_URL).option("--index <index>", "Elasticsearch index", DEFAULT_INDEX2).option("--elasticsearch-api-key <key>", "Elasticsearch API key").option("--elasticsearch-user <user>", "Elasticsearch basic auth username").option("--elasticsearch-password <password>", "Elasticsearch basic auth password").option("--auto-recall", "Enable automatic memory recall").option("--auto-capture", "Enable automatic memory capture").option("--top-k <n>", "Recall result count", "5").option("--search-threshold <n>", "Recall score threshold", "0.05").option("--reuse-values", "Reuse current memory-elasticsearch config for unspecified options").option("--json", "Machine-readable output").action((opts, command) => {
      try {
        const existingConfig = opts.reuseValues ? readOpenClawPluginConfig() ?? {} : {};
        const existingElasticsearch = objectValue2(existingConfig.elasticsearch);
        const existingOpenaiCompatible = objectValue2(existingConfig.openaiCompatible);
        const existingLlm = objectValue2(existingOpenaiCompatible.llm);
        const existingEmbedding = objectValue2(existingOpenaiCompatible.embedding);
        const existingReranker = objectValue2(existingConfig.reranker);
        const baseUrl = reusableOption(opts, command, "baseUrl", stringValue(existingOpenaiCompatible.baseUrl), DEFAULT_BASE_URL);
        const llmModel = reusableOption(opts, command, "llmModel", stringValue(existingLlm.model) ?? stringValue(existingOpenaiCompatible.llmModel), DEFAULT_LLM_MODEL2);
        const embeddingModel = reusableOption(
          opts,
          command,
          "embeddingModel",
          stringValue(existingEmbedding.model) ?? stringValue(existingOpenaiCompatible.embeddingModel),
          DEFAULT_EMBEDDING_MODEL2
        );
        const embeddingDims = optionWasSet(command, "embeddingDims") ? numberOption(opts.embeddingDims, DEFAULT_EMBEDDING_DIMS2) : opts.reuseValues ? numberValue2(existingEmbedding.dims) ?? numberValue2(existingOpenaiCompatible.embeddingDims) ?? DEFAULT_EMBEDDING_DIMS2 : numberOption(opts.embeddingDims, DEFAULT_EMBEDDING_DIMS2);
        const apiKey = opts.apiKey;
        const apiKeyEnv = "OPENAI_API_KEY";
        const llmApiKeyEnv = opts.llmApiKey ? "OPENAI_LLM_API_KEY" : apiKeyEnv;
        const embeddingApiKeyEnv = opts.embeddingApiKey ? "OPENAI_EMBEDDING_API_KEY" : apiKeyEnv;
        const rerankerApiKeyEnv = "JINA_API_KEY";
        const apiKeyRef = `\${${apiKeyEnv}}`;
        const openaiCompatibleApiKeyRef = optionWasSet(command, "apiKey") ? apiKeyRef : opts.reuseValues ? stringValue(existingOpenaiCompatible.apiKey) ?? apiKeyRef : apiKeyRef;
        const llmBaseUrl = optionWasSet(command, "llmBaseUrl") ? opts.llmBaseUrl ?? baseUrl : optionWasSet(command, "baseUrl") ? baseUrl : opts.reuseValues ? stringValue(existingLlm.baseUrl) ?? baseUrl : baseUrl;
        const embeddingBaseUrl = optionWasSet(command, "embeddingBaseUrl") ? opts.embeddingBaseUrl ?? baseUrl : optionWasSet(command, "baseUrl") ? baseUrl : opts.reuseValues ? stringValue(existingEmbedding.baseUrl) ?? baseUrl : baseUrl;
        const llmApiKeyRef = opts.llmApiKey ? `\${${llmApiKeyEnv}}` : optionWasSet(command, "apiKey") ? openaiCompatibleApiKeyRef : opts.reuseValues ? stringValue(existingLlm.apiKey) ?? openaiCompatibleApiKeyRef : openaiCompatibleApiKeyRef;
        const embeddingApiKeyRef = opts.embeddingApiKey ? `\${${embeddingApiKeyEnv}}` : optionWasSet(command, "apiKey") ? openaiCompatibleApiKeyRef : opts.reuseValues ? stringValue(existingEmbedding.apiKey) ?? openaiCompatibleApiKeyRef : openaiCompatibleApiKeyRef;
        const rerankerApiKeyRef = `\${${rerankerApiKeyEnv}}`;
        if (apiKey) upsertEnvVar(apiKeyEnv, apiKey);
        if (opts.llmApiKey) upsertEnvVar(llmApiKeyEnv, opts.llmApiKey);
        if (opts.embeddingApiKey) upsertEnvVar(embeddingApiKeyEnv, opts.embeddingApiKey);
        if (opts.rerankerApiKey) upsertEnvVar(rerankerApiKeyEnv, opts.rerankerApiKey);
        const rerankerEnabled = optionWasSet(command, "reranker") ? true : opts.reuseValues ? booleanValue(existingReranker.enabled) ?? false : false;
        const rerankerBaseUrl = reusableOption(opts, command, "rerankerBaseUrl", stringValue(existingReranker.baseUrl), DEFAULT_RERANKER_BASE_URL2);
        const resolvedRerankerApiKeyRef = opts.rerankerApiKey ? rerankerApiKeyRef : rerankerEnabled ? opts.reuseValues ? stringValue(existingReranker.apiKey) ?? rerankerApiKeyRef : rerankerApiKeyRef : void 0;
        const rerankerModel = reusableOption(opts, command, "rerankerModel", stringValue(existingReranker.model), DEFAULT_RERANKER_MODEL2);
        const elasticsearchUrl = reusableOption(opts, command, "elasticsearchUrl", stringValue(existingElasticsearch.url), DEFAULT_ELASTICSEARCH_URL);
        const elasticsearchIndex = reusableOption(opts, command, "index", stringValue(existingElasticsearch.index), DEFAULT_INDEX2);
        const elasticsearchApiKey = reusableOption(opts, command, "elasticsearchApiKey", stringValue(existingElasticsearch.apiKey), void 0);
        const elasticsearchUsername = reusableOption(opts, command, "elasticsearchUser", stringValue(existingElasticsearch.username), void 0);
        const elasticsearchPassword = reusableOption(opts, command, "elasticsearchPassword", stringValue(existingElasticsearch.password), void 0);
        const autoRecall = optionWasSet(command, "autoRecall") ? opts.autoRecall ?? true : opts.reuseValues ? booleanValue(existingConfig.autoRecall) ?? true : true;
        const autoCapture = optionWasSet(command, "autoCapture") ? opts.autoCapture ?? true : opts.reuseValues ? booleanValue(existingConfig.autoCapture) ?? true : true;
        const topK = optionWasSet(command, "topK") ? numberOption(opts.topK, 5) : opts.reuseValues ? numberValue2(existingConfig.topK) ?? 5 : numberOption(opts.topK, 5);
        const searchThreshold = optionWasSet(command, "searchThreshold") ? numberOption(opts.searchThreshold, 0.05) : opts.reuseValues ? numberValue2(existingConfig.searchThreshold) ?? 0.05 : numberOption(opts.searchThreshold, 0.05);
        patchOpenClawConfig({
          userId: opts.userId ?? config.userId ?? systemUser(),
          autoRecall,
          autoCapture,
          topK,
          searchThreshold,
          elasticsearchUrl,
          elasticsearchIndex,
          elasticsearchApiKey,
          elasticsearchUsername,
          elasticsearchPassword,
          openaiCompatibleBaseUrl: baseUrl,
          openaiCompatibleApiKeyRef,
          llmBaseUrl,
          llmApiKeyRef,
          llmModel,
          embeddingBaseUrl,
          embeddingApiKeyRef,
          embeddingModel,
          embeddingDims,
          rerankerEnabled,
          rerankerBaseUrl,
          rerankerApiKeyRef: resolvedRerankerApiKeyRef,
          rerankerModel
        });
        const envFileTouched = Boolean(apiKey || opts.llmApiKey || opts.embeddingApiKey || opts.rerankerApiKey);
        const summary = {
          ok: true,
          configFile: OPENCLAW_CONFIG_FILE,
          envFile: envFileTouched ? OPENCLAW_ENV_FILE : void 0,
          plugin: "memory-elasticsearch",
          memorySlot: "memory-elasticsearch",
          reusedValues: opts.reuseValues === true,
          elasticsearch: {
            url: elasticsearchUrl,
            index: elasticsearchIndex
          },
          openaiCompatible: {
            baseUrl,
            apiKey: openaiCompatibleApiKeyRef,
            llm: {
              baseUrl: llmBaseUrl,
              model: llmModel,
              apiKey: llmApiKeyRef
            },
            embedding: {
              baseUrl: embeddingBaseUrl,
              model: embeddingModel,
              dims: embeddingDims,
              apiKey: embeddingApiKeyRef
            },
            llmModel,
            embeddingModel,
            embeddingDims
          },
          reranker: {
            enabled: rerankerEnabled,
            baseUrl: rerankerBaseUrl,
            model: rerankerModel,
            apiKey: resolvedRerankerApiKeyRef
          },
          message: "Configured. Restart the gateway or rerun plugins doctor."
        };
        if (jsonOut(opts, summary)) return;
        out("memory-elasticsearch configured");
        out(`  Config: ${OPENCLAW_CONFIG_FILE}`);
        if (opts.reuseValues) out("  Reused unspecified values from existing memory-elasticsearch config");
        if (apiKey) out(`  API key env: ${OPENCLAW_ENV_FILE} (${apiKeyEnv})`);
        if (opts.llmApiKey) out(`  LLM API key env: ${OPENCLAW_ENV_FILE} (${llmApiKeyEnv})`);
        if (opts.embeddingApiKey) out(`  Embedding API key env: ${OPENCLAW_ENV_FILE} (${embeddingApiKeyEnv})`);
        out(`  Elasticsearch: ${summary.elasticsearch.url}/${summary.elasticsearch.index}`);
        out(`  LLM: ${llmBaseUrl} \xB7 ${llmModel}`);
        out(`  Embedding: ${embeddingBaseUrl} \xB7 ${embeddingModel} (${embeddingDims} dims)`);
        out(`  Reranker: ${rerankerEnabled ? `${summary.reranker.baseUrl} \xB7 ${summary.reranker.model}` : "disabled"}`);
        out("  Restart the gateway: openclaw gateway restart");
      } catch (err) {
        if (opts.json) {
          out(JSON.stringify({ ok: false, error: String(err) }, null, 2));
        } else {
          errOut(`init failed: ${String(err)}`);
        }
      }
    });
    root.command("add").description("Add one or more explicit memories with semantic dedupe").argument("<text...>", "Memory text").option("--user-id <id>", "Override user ID").option("--json", "Machine-readable output").action(async (textParts, opts) => {
      try {
        if (!store) throw new Error("Memory store is not available.");
        const text = commandText(textParts);
        if (!text) throw new Error("Memory text is required.");
        const result = await store.add([{ role: "user", content: text }], {
          user_id: opts.userId ?? config.userId,
          source: "OPENCLAW_CLI",
          infer: false,
          deduced_memories: [text],
          metadata: { captured_by: "cli_add" }
        });
        const payload = { ok: true, count: result.results.length, results: result.results };
        if (jsonOut(opts, payload)) return;
        out(result.results.length ? result.results.map((item) => `[${item.event}] ${item.memory} (id=${item.id})`).join("\n") : "No memories stored.");
      } catch (err) {
        if (opts.json) {
          out(JSON.stringify({ ok: false, error: String(err) }, null, 2));
          return;
        }
        errOut(`add failed: ${String(err)}`);
      }
    });
    root.command("triage").description("Extract durable memory candidates from text").argument("<text...>", "Conversation text").option("--user-id <id>", "Override user ID").option("--json", "Machine-readable output").action(async (textParts, opts) => {
      try {
        if (!store) throw new Error("Memory store is not available.");
        const text = commandText(textParts);
        if (!text) throw new Error("Text is required.");
        const result = await store.triage([{ role: "user", content: text }], {
          user_id: opts.userId ?? config.userId
        });
        const payload = { ok: true, memory: result.memories };
        if (jsonOut(opts, payload)) return;
        if (!result.memories.length) {
          out("No durable memories found.");
          return;
        }
        out(result.memories.map((memory, index) => `${index + 1}. ${memory.text}`).join("\n"));
      } catch (err) {
        if (opts.json) {
          out(JSON.stringify({ ok: false, error: String(err) }, null, 2));
          return;
        }
        errOut(`triage failed: ${String(err)}`);
      }
    });
    root.command("search").description("Search memories").argument("<query>", "Search query").option("--user-id <id>", "Override user ID").option("--top-k <n>", "Max results", String(config.topK)).option("--threshold <n>", "Search score threshold", String(config.searchThreshold)).option("--json", "Machine-readable output").action(async (query, opts) => {
      try {
        if (!store) throw new Error("Memory store is not available.");
        const memories = await store.search(query, searchOptions(config, opts));
        const payload = { ok: true, query, count: memories.length, memories };
        if (opts.json) {
          out(JSON.stringify(payload, null, 2));
          return;
        }
        out(formatMemories(memories));
      } catch (err) {
        if (opts.json) {
          out(JSON.stringify({ ok: false, error: String(err) }, null, 2));
          return;
        }
        errOut(`search failed: ${String(err)}`);
      }
    });
    root.command("list").description("List memories").option("--user-id <id>", "Override user ID").option("--top-k <n>", "Max results", "50").option("--json", "Machine-readable output").action(async (opts) => {
      try {
        if (!store) throw new Error("Memory store is not available.");
        const topK = numberOption(opts.topK, 50);
        const memories = await store.list({
          user_id: opts.userId ?? config.userId,
          page_size: topK,
          limit: topK
        });
        const payload = { ok: true, count: memories.length, memories };
        if (opts.json) {
          out(JSON.stringify(payload, null, 2));
          return;
        }
        out(formatMemories(memories));
      } catch (err) {
        if (opts.json) {
          out(JSON.stringify({ ok: false, error: String(err) }, null, 2));
          return;
        }
        errOut(`list failed: ${String(err)}`);
      }
    });
    root.command("delete").description("Delete memories by id, query, or all user memories").option("--memory-id <id>", "Delete one memory by id").option("--query <query>", "Delete memories matched by search").option("--all", "Delete all memories for the user").option("--confirm", "Required with --all").option("--user-id <id>", "Override user ID").option("--json", "Machine-readable output").action(async (opts) => {
      try {
        if (!store) throw new Error("Memory store is not available.");
        let result;
        if (opts.all) {
          if (!opts.confirm) throw new Error("--all requires --confirm.");
          result = await store.deleteAll(opts.userId ?? config.userId);
        } else if (opts.query) {
          result = await store.deleteByQuery(opts.query, { user_id: opts.userId ?? config.userId, top_k: 20 });
        } else if (opts.memoryId) {
          result = await store.delete(opts.memoryId);
        } else {
          throw new Error("Pass --memory-id, --query, or --all --confirm.");
        }
        const payload = { ok: true, ...result };
        if (jsonOut(opts, payload)) return;
        out(`Deleted ${result.deleted} memor${result.deleted === 1 ? "y" : "ies"}.`);
      } catch (err) {
        if (opts.json) {
          out(JSON.stringify({ ok: false, error: String(err) }, null, 2));
          return;
        }
        errOut(`delete failed: ${String(err)}`);
      }
    });
    root.command("uninstall").description("Remove memory-elasticsearch config and tool allowlist entries").option("--json", "Machine-readable output").action((opts) => {
      try {
        const cleanup = cleanupOpenClawConfig();
        const payload = {
          ok: true,
          plugin: PLUGIN_ID,
          configFile: OPENCLAW_CONFIG_FILE,
          cleanup,
          nextCommand: "openclaw plugins uninstall memory-elasticsearch --force"
        };
        if (jsonOut(opts, payload)) return;
        out("memory-elasticsearch config cleanup complete");
        if (cleanup.removedTools.length) out(`  Removed tools.alsoAllow entries: ${cleanup.removedTools.join(", ")}`);
        if (cleanup.keptTools.length) out(`  Kept tools.alsoAllow entries: ${cleanup.keptTools.join(", ")}`);
        if (cleanup.removedAlsoAllow) out("  Removed empty tools.alsoAllow");
        if (cleanup.removedPluginEntry) out("  Removed plugin config entry");
        if (cleanup.resetMemorySlot) out("  Reset memory slot to memory-core");
        out("  Remove installed plugin package: openclaw plugins uninstall memory-elasticsearch --force");
        out("  Restart the gateway: openclaw gateway restart");
      } catch (err) {
        if (opts.json) {
          out(JSON.stringify({ ok: false, error: String(err) }, null, 2));
          return;
        }
        errOut(`uninstall failed: ${String(err)}`);
      }
    });
    root.command("status").description("Show current memory-elasticsearch runtime config").option("--json", "Machine-readable output").action((opts) => {
      const payload = {
        plugin: "memory-elasticsearch",
        userId: config.userId,
        autoRecall: config.autoRecall,
        autoCapture: config.autoCapture,
        elasticsearch: {
          url: config.elasticsearch.url,
          index: config.elasticsearch.index,
          auth: config.elasticsearch.apiKey ? "apiKey" : config.elasticsearch.username ? "basic" : "none"
        },
        openaiCompatible: {
          baseUrl: config.openaiCompatible.baseUrl,
          llmModel: config.openaiCompatible.llmModel,
          embeddingModel: config.openaiCompatible.embeddingModel,
          embeddingDims: config.openaiCompatible.embeddingDims,
          apiKeyConfigured: Boolean(config.openaiCompatible.apiKey),
          llm: {
            baseUrl: config.openaiCompatible.llm.baseUrl,
            model: config.openaiCompatible.llm.model,
            apiKeyConfigured: Boolean(config.openaiCompatible.llm.apiKey)
          },
          embedding: {
            baseUrl: config.openaiCompatible.embedding.baseUrl,
            model: config.openaiCompatible.embedding.model,
            dims: config.openaiCompatible.embedding.dims,
            apiKeyConfigured: Boolean(config.openaiCompatible.embedding.apiKey)
          }
        },
        search: config.search,
        reranker: {
          enabled: config.reranker.enabled,
          provider: config.reranker.provider,
          baseUrl: config.reranker.baseUrl,
          model: config.reranker.model,
          apiKeyConfigured: Boolean(config.reranker.apiKey)
        }
      };
      if (opts.json) {
        out(JSON.stringify(payload, null, 2));
        return;
      }
      out(JSON.stringify(payload, null, 2));
    });
  }, {
    descriptors: [
      {
        name: "memory-elasticsearch",
        description: "Elasticsearch memory plugin commands",
        hasSubcommands: true
      },
      {
        name: "memory-es",
        description: "Elasticsearch memory plugin commands",
        hasSubcommands: true
      }
    ]
  });
}

// src/hooks/capture.ts
function cleanPrompt(prompt) {
  return String(prompt ?? "").replace(/<relevant-memories>[\s\S]*?<\/relevant-memories>\s*/g, "").replace(/Sender\s*\(untrusted metadata\):\s*```json[\s\S]*?```\s*/gi, "").replace(/^\[[^\]]+\]\s*/g, "").trim();
}
function extractMessages(messages = []) {
  const parsed = [];
  for (const message of messages) {
    if (!message || message.role !== "user" && message.role !== "assistant") continue;
    if (typeof message.content === "string") parsed.push({ role: message.role, content: cleanPrompt(message.content) });
    else if (Array.isArray(message.content)) {
      const text = message.content.map((block) => typeof block?.text === "string" ? block.text : "").filter(Boolean).join("\n");
      if (text) parsed.push({ role: message.role, content: cleanPrompt(text) });
    }
  }
  return parsed.filter((message) => message.content.length > 0).slice(-20);
}

// src/index.ts
function isNonInteractive(trigger) {
  return trigger === "cron" || trigger === "heartbeat" || trigger === "automation";
}
var plugin = definePluginEntry({
  id: "memory-elasticsearch",
  name: "Memory (Elasticsearch)",
  description: "Elasticsearch-backed OpenClaw memory with BM25 + vector hybrid retrieval",
  register(api) {
    const config = parseConfig(api.pluginConfig ?? {});
    const model = new OpenAICompatibleClient(config.openaiCompatible);
    const store = new ElasticsearchMemoryStore({ config, model });
    api.logger?.debug?.(`memory-elasticsearch: registered ${JSON.stringify(redactedConfigSummary(config))}`);
    registerAllTools(api, {
      store,
      config
    });
    registerCliCommands(api, config, store);
    if (config.autoRecall && typeof api.on === "function") {
      api.on("before_prompt_build", async (event, ctx = {}) => {
        if (!event?.prompt || cleanPrompt(event.prompt).length < 5) return;
        if (isNonInteractive(ctx.trigger)) return;
        const query = cleanPrompt(event.prompt);
        const memories = await store.search(query, {
          user_id: config.userId,
          top_k: config.topK,
          threshold: config.searchThreshold
        });
        if (!memories.length) return;
        api.logger?.debug?.(`memory-elasticsearch: recalled ${memories.length} memories for prompt`);
        const body = memories.map((memory) => `- ${memory.memory}`).join("\n");
        return {
          prependContext: `<relevant-memories>
The following memories were retrieved from Elasticsearch for user "${config.userId}". Use them only when relevant.
${body}
</relevant-memories>`
        };
      });
    }
    if (config.autoCapture && typeof api.on === "function") {
      api.on("agent_end", async (event, ctx = {}) => {
        if (!event?.success || !Array.isArray(event.messages) || isNonInteractive(ctx.trigger)) return;
        const messages = extractMessages(event.messages);
        if (!messages.some((message) => message.role === "user")) return;
        try {
          const result = await store.add([
            { role: "system", content: `Current date: ${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}. Extract durable memories only.` },
            ...messages
          ], {
            user_id: config.userId,
            source: "OPENCLAW",
            metadata: { captured_by: "agent_end" }
          });
          api.logger?.info?.(`memory-elasticsearch: captured ${result.results.length} memories`);
        } catch (err) {
          api.logger?.warn?.(`memory-elasticsearch: auto-capture failed: ${String(err)}`);
        }
      });
    }
  }
});
var index_default = plugin;
export {
  index_default as default
};
//# sourceMappingURL=index.js.map