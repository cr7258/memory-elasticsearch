import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const PLUGIN_ID = "memory-elasticsearch";
export const OPENCLAW_CONFIG_DIR = join(homedir(), ".openclaw");
export const OPENCLAW_CONFIG_FILE = join(OPENCLAW_CONFIG_DIR, "openclaw.json");
export const OPENCLAW_ENV_FILE = join(OPENCLAW_CONFIG_DIR, ".env");
export const MEMORY_TOOL_ALLOWLIST = [
  "memory_search",
  "memory_add",
  "memory_get",
  "memory_list",
  "memory_update",
  "memory_delete",
  "memory_triage",
];

export interface InitConfigInput {
  userId: string;
  autoRecall: boolean;
  autoCapture: boolean;
  topK: number;
  searchThreshold: number;
  elasticsearchUrl: string;
  elasticsearchIndex: string;
  elasticsearchApiKey?: string;
  elasticsearchUsername?: string;
  elasticsearchPassword?: string;
  llmBaseUrl: string;
  llmApiKeyRef: string;
  llmModel: string;
  embeddingBaseUrl: string;
  embeddingApiKeyRef: string;
  embeddingModel: string;
  embeddingDims: number;
  rerankerEnabled: boolean;
  rerankerBaseUrl: string;
  rerankerApiKeyRef?: string;
  rerankerModel: string;
}

function readJsonObject(path: string): Record<string, any> {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, "utf8");
  if (!text.trim()) return {};
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path} must contain a JSON object`);
  }
  return parsed as Record<string, any>;
}

function writeJsonObject(path: string, value: Record<string, any>): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function mergeStringList(existing: unknown, values: string[], path: string): string[] {
  if (existing !== undefined && !Array.isArray(existing)) {
    throw new Error(`${path} must be an array`);
  }
  const existingValues: unknown[] = Array.isArray(existing) ? existing : [];
  return [...new Set([...existingValues, ...values].map((value) => {
    if (typeof value !== "string" || !value.trim()) throw new Error(`${path} must contain only non-empty strings`);
    return value;
  }))];
}

export function buildPluginConfig(input: InitConfigInput): Record<string, any> {
  return {
    userId: input.userId,
    autoRecall: input.autoRecall,
    autoCapture: input.autoCapture,
    topK: input.topK,
    searchThreshold: input.searchThreshold,
    elasticsearch: {
      url: input.elasticsearchUrl,
      index: input.elasticsearchIndex,
      ...(input.elasticsearchApiKey ? { apiKey: input.elasticsearchApiKey } : {}),
      ...(input.elasticsearchUsername ? { username: input.elasticsearchUsername } : {}),
      ...(input.elasticsearchPassword ? { password: input.elasticsearchPassword } : {}),
    },
    search: {
      mode: "hybrid",
      semanticWeight: 0.6,
      keywordWeight: 0.4,
    },
    openaiCompatible: {
      llm: {
        baseUrl: input.llmBaseUrl,
        apiKey: input.llmApiKeyRef,
        model: input.llmModel,
      },
      embedding: {
        baseUrl: input.embeddingBaseUrl,
        apiKey: input.embeddingApiKeyRef,
        model: input.embeddingModel,
        dims: input.embeddingDims,
      },
    },
    reranker: {
      enabled: input.rerankerEnabled,
      provider: "jina",
      baseUrl: input.rerankerBaseUrl,
      ...(input.rerankerApiKeyRef ? { apiKey: input.rerankerApiKeyRef } : {}),
      model: input.rerankerModel,
    },
  };
}

export function patchOpenClawConfig(input: InitConfigInput, path = OPENCLAW_CONFIG_FILE): void {
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
      allowConversationAccess: true,
    },
  };
  config.plugins.slots.memory = PLUGIN_ID;

  writeJsonObject(path, config);
}

export function readOpenClawPluginConfig(path = OPENCLAW_CONFIG_FILE): Record<string, any> | undefined {
  const config = readJsonObject(path);
  const pluginConfig = config.plugins?.entries?.[PLUGIN_ID]?.config;
  if (!pluginConfig || typeof pluginConfig !== "object" || Array.isArray(pluginConfig)) return undefined;
  return pluginConfig as Record<string, any>;
}

export function upsertEnvVar(name: string, value: string, path = OPENCLAW_ENV_FILE): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const lines = existsSync(path)
    ? readFileSync(path, "utf8").split(/\r?\n/)
    : [];
  const prefix = `${name}=`;
  let replaced = false;
  const next = lines
    .filter((line) => line.length > 0)
    .map((line) => {
      if (line.startsWith(prefix)) {
        replaced = true;
        return `${name}=${value}`;
      }
      return line;
    });
  if (!replaced) next.push(`${name}=${value}`);
  writeFileSync(path, `${next.join("\n")}\n`, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Best effort; writeFileSync mode already covers normal creation.
  }
}
