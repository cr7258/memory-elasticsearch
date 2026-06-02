import { userInfo } from "node:os";
import type { MemoryConfig } from "./types.js";

const DEFAULT_INDEX = "openclaw-memory";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_LLM_MODEL = "gpt-4o-mini";
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_EMBEDDING_DIMS = 1536;
const DEFAULT_RERANKER_BASE_URL = "https://api.jina.ai";
const DEFAULT_RERANKER_MODEL = "jina-reranker-v3";

function boolValue(value: unknown, defaultValue: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (["true", "1", "yes", "on"].includes(value.toLowerCase())) return true;
    if (["false", "0", "no", "off"].includes(value.toLowerCase())) return false;
  }
  return defaultValue;
}

function numberValue(value: unknown, defaultValue: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return defaultValue;
}

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function envTemplateValue(value: unknown, env: Record<string, string | undefined>): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const match = value.trim().match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/);
  if (!match) return value;
  return env[match[1]];
}

function username(env: Record<string, string | undefined> = process.env): string {
  try {
    return userInfo().username || env.USER || "default";
  } catch {
    return env.USER || "default";
  }
}

export function parseConfig(value: unknown = {}, opts: { env?: Record<string, string | undefined>; username?: string } = {}): MemoryConfig {
  const env = opts.env ?? process.env;
  const cfg = objectValue(value);
  const elasticsearch = objectValue(cfg.elasticsearch);
  const openaiCompatible = objectValue(cfg.openaiCompatible);
  const llm = objectValue(openaiCompatible.llm);
  const embedding = objectValue(openaiCompatible.embedding);
  const search = objectValue(cfg.search);
  const reranker = objectValue(cfg.reranker);
  const openaiBaseUrl =
    openaiCompatible.baseUrl ??
    env.OPENAI_BASE_URL ??
    DEFAULT_OPENAI_BASE_URL;
  const openaiApiKey =
    envTemplateValue(openaiCompatible.apiKey, env) ??
    env.OPENAI_API_KEY;
  const llmModel =
    llm.model ??
    openaiCompatible.llmModel ??
    env.OPENAI_LLM_MODEL ??
    DEFAULT_LLM_MODEL;
  const embeddingModel =
    embedding.model ??
    openaiCompatible.embeddingModel ??
    env.OPENAI_EMBEDDING_MODEL ??
    DEFAULT_EMBEDDING_MODEL;
  const embeddingDims = numberValue(
    embedding.dims ??
      openaiCompatible.embeddingDims ??
      env.OPENAI_EMBEDDING_DIMS,
    DEFAULT_EMBEDDING_DIMS,
  );
  const llmConfig = {
    baseUrl:
      llm.baseUrl ??
      env.OPENAI_LLM_BASE_URL ??
      openaiBaseUrl,
    apiKey:
      envTemplateValue(llm.apiKey, env) ??
      env.OPENAI_LLM_API_KEY ??
      openaiApiKey,
    model: llmModel,
  };
  const embeddingConfig = {
    baseUrl: embedding.baseUrl ?? env.OPENAI_EMBEDDING_BASE_URL ?? openaiBaseUrl,
    apiKey:
      envTemplateValue(embedding.apiKey, env) ??
      env.OPENAI_EMBEDDING_API_KEY ??
      openaiApiKey,
    model: embeddingModel,
    dims: embeddingDims,
  };
  const rerankerEnabled = boolValue(reranker.enabled, false);
  const rerankerApiKey = rerankerEnabled
    ? envTemplateValue(reranker.apiKey, env) ?? env.JINA_API_KEY
    : undefined;

  return {
    userId: typeof cfg.userId === "string" && cfg.userId ? cfg.userId : (opts.username ?? username(env)),
    autoRecall: boolValue(cfg.autoRecall, true),
    autoCapture: boolValue(cfg.autoCapture, true),
    topK: numberValue(cfg.topK, 5),
    searchThreshold: numberValue(cfg.searchThreshold, 0.05),
    elasticsearch: {
      url: elasticsearch.url ?? env.ELASTICSEARCH_URL ?? "http://localhost:9200",
      index: elasticsearch.index ?? env.ELASTICSEARCH_INDEX ?? DEFAULT_INDEX,
      apiKey: elasticsearch.apiKey ?? env.ELASTICSEARCH_API_KEY,
      username: elasticsearch.username ?? env.ELASTICSEARCH_USERNAME,
      password: elasticsearch.password ?? env.ELASTICSEARCH_PASSWORD,
    },
    openaiCompatible: {
      baseUrl: openaiBaseUrl,
      apiKey: openaiApiKey,
      llmModel,
      embeddingModel,
      embeddingDims,
      llm: llmConfig,
      embedding: embeddingConfig,
    },
    search: {
      mode: "hybrid",
      numCandidates: numberValue(search.numCandidates, 100),
      semanticWeight: numberValue(search.semanticWeight, 0.6),
      keywordWeight: numberValue(search.keywordWeight, 0.4),
    },
    reranker: {
      enabled: rerankerEnabled,
      provider: "jina",
      baseUrl: reranker.baseUrl ?? env.JINA_BASE_URL ?? DEFAULT_RERANKER_BASE_URL,
      apiKey: rerankerApiKey,
      model: reranker.model ?? env.JINA_RERANKER_MODEL ?? DEFAULT_RERANKER_MODEL,
    },
  };
}

export function redactedConfigSummary(config: MemoryConfig): Record<string, unknown> {
  return {
    userId: config.userId,
    autoRecall: config.autoRecall,
    autoCapture: config.autoCapture,
    topK: config.topK,
    elasticsearch: {
      url: config.elasticsearch.url,
      index: config.elasticsearch.index,
      auth: config.elasticsearch.apiKey ? "apiKey" : config.elasticsearch.username ? "basic" : "none",
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
        apiKeyConfigured: Boolean(config.openaiCompatible.llm.apiKey),
      },
      embedding: {
        baseUrl: config.openaiCompatible.embedding.baseUrl,
        model: config.openaiCompatible.embedding.model,
        dims: config.openaiCompatible.embedding.dims,
        apiKeyConfigured: Boolean(config.openaiCompatible.embedding.apiKey),
      },
    },
    search: config.search,
    reranker: {
      enabled: config.reranker.enabled,
      provider: config.reranker.provider,
      baseUrl: config.reranker.baseUrl,
      model: config.reranker.model,
      apiKeyConfigured: Boolean(config.reranker.apiKey),
    },
  };
}
