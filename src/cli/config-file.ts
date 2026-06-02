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
  openaiCompatibleBaseUrl: string;
  openaiCompatibleApiKeyRef: string;
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

export interface CleanupOpenClawConfigResult {
  removedTools: string[];
  keptTools: string[];
  removedAlsoAllow: boolean;
  removedPluginEntry: boolean;
  resetMemorySlot: boolean;
  changed: boolean;
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

function removeStringListValues(existing: unknown, values: string[], path: string): { next: string[]; removed: string[] } {
  if (existing !== undefined && !Array.isArray(existing)) {
    throw new Error(`${path} must be an array`);
  }
  const blocked = new Set(values);
  const next: string[] = [];
  const removed: string[] = [];
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
      numCandidates: 100,
      semanticWeight: 0.6,
      keywordWeight: 0.4,
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

export function cleanupOpenClawConfig(path = OPENCLAW_CONFIG_FILE): CleanupOpenClawConfigResult {
  const config = readJsonObject(path);
  const result: CleanupOpenClawConfigResult = {
    removedTools: [],
    keptTools: [],
    removedAlsoAllow: false,
    removedPluginEntry: false,
    resetMemorySlot: false,
    changed: false,
  };

  const tools = config.tools;
  if (tools !== undefined) {
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
