import { userInfo } from "node:os";
import { createInterface } from "node:readline/promises";
import type { MemoryConfig, MemoryRecord, MemoryStore, SearchOptions } from "../types.js";
import { OPENCLAW_CONFIG_FILE, OPENCLAW_ENV_FILE, patchOpenClawConfig, readOpenClawPluginConfig, upsertEnvVar } from "./config-file.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_LLM_MODEL = "gpt-4o-mini";
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_EMBEDDING_DIMS = 1536;
const DEFAULT_RERANKER_BASE_URL = "https://api.jina.ai";
const DEFAULT_RERANKER_MODEL = "jina-reranker-v3";
const DEFAULT_ELASTICSEARCH_URL = "http://localhost:9200";
const DEFAULT_INDEX = "openclaw-memory";

interface InitOptions {
  userId?: string;
  baseUrl?: string;
  apiKey?: string;
  llmBaseUrl?: string;
  llmApiKey?: string;
  llmModel?: string;
  embeddingBaseUrl?: string;
  embeddingApiKey?: string;
  embeddingModel?: string;
  embeddingDims?: string;
  reranker?: boolean;
  rerankerBaseUrl?: string;
  rerankerApiKey?: string;
  rerankerModel?: string;
  elasticsearchUrl?: string;
  index?: string;
  elasticsearchApiKey?: string;
  elasticsearchUser?: string;
  elasticsearchPassword?: string;
  autoRecall?: boolean;
  autoCapture?: boolean;
  topK?: string;
  searchThreshold?: string;
  reuseValues?: boolean;
  json?: boolean;
}

interface SearchCliOptions {
  userId?: string;
  topK?: string;
  threshold?: string;
  json?: boolean;
}

interface ListCliOptions {
  userId?: string;
  topK?: string;
  json?: boolean;
}

interface AddCliOptions {
  userId?: string;
  json?: boolean;
}

interface TriageCliOptions {
  userId?: string;
  json?: boolean;
}

interface DeleteCliOptions {
  memoryId?: string;
  query?: string;
  all?: boolean;
  confirm?: boolean;
  userId?: string;
  json?: boolean;
}

interface CliCommandDeps {
  confirmDeleteAll?: (userId: string) => Promise<boolean>;
}

async function confirmDeleteAll(userId: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  try {
    const answer = await rl.question(`Delete all memories for user "${userId}"? [y/N] `);
    return /^(y|yes)$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

function systemUser(): string {
  try {
    return userInfo().username || "default";
  } catch {
    return "default";
  }
}

function numberOption(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid number: ${value}`);
  return parsed;
}

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function optionWasSet(command: any, name: keyof InitOptions): boolean {
  return command?.getOptionValueSource?.(name) === "cli";
}

function reusableOption<T>(opts: InitOptions, command: any, name: keyof InitOptions, reusedValue: T | undefined, defaultValue: T): T {
  if (optionWasSet(command, name)) return opts[name] as T;
  if (opts.reuseValues && reusedValue !== undefined) return reusedValue;
  return defaultValue;
}

function out(text: string): void {
  process.stdout.write(`${text}\n`);
}

function errOut(text: string): void {
  process.stderr.write(`${text}\n`);
}

function jsonOut(opts: { json?: boolean }, payload: Record<string, unknown>): boolean {
  if (!opts.json) return false;
  out(JSON.stringify(payload, null, 2));
  return true;
}

function searchOptions(config: MemoryConfig, opts: SearchCliOptions | ListCliOptions): SearchOptions {
  return {
    user_id: opts.userId ?? config.userId,
    top_k: numberOption(opts.topK, config.topK),
    threshold: "threshold" in opts ? numberOption(opts.threshold, config.searchThreshold) : config.searchThreshold,
  };
}

function formatMemories(memories: MemoryRecord[]): string {
  if (!memories.length) return "No memories found.";
  return memories.map((memory, index) => {
    const score = memory.score === undefined ? "" : ` score=${memory.score.toFixed(3)}`;
    return `${index + 1}. ${memory.memory} (id=${memory.id}${score})`;
  }).join("\n");
}

function commandText(parts: string | string[]): string {
  return Array.isArray(parts) ? parts.join(" ").trim() : String(parts ?? "").trim();
}

export function registerCliCommands(api: any, config: MemoryConfig, store?: MemoryStore, deps: CliCommandDeps = {}): void {
  if (typeof api.registerCli !== "function") return;

  api.registerCli(({ program }: { program: any }) => {
    const root = program
      .command("memory-elasticsearch")
      .alias("memory-es")
      .description("Elasticsearch memory plugin commands");

    root
      .command("init")
      .description("Configure memory-elasticsearch without editing openclaw.json by hand")
      .option("--user-id <id>", "Memory user namespace")
      .option("--base-url <url>", "OpenAI-compatible base URL", DEFAULT_BASE_URL)
      .option("--api-key <key>", "Shared OpenAI-compatible API key; stored in ~/.openclaw/.env")
      .option("--llm-base-url <url>", "LLM OpenAI-compatible base URL; defaults to --base-url")
      .option("--llm-api-key <key>", "LLM API key; defaults to --api-key")
      .option("--llm-model <model>", "LLM model", DEFAULT_LLM_MODEL)
      .option("--embedding-base-url <url>", "Embedding OpenAI-compatible base URL; defaults to --base-url")
      .option("--embedding-api-key <key>", "Embedding API key; defaults to --api-key")
      .option("--embedding-model <model>", "Embedding model", DEFAULT_EMBEDDING_MODEL)
      .option("--embedding-dims <n>", "Embedding vector dimensions", String(DEFAULT_EMBEDDING_DIMS))
      .option("--reranker", "Enable Jina reranker")
      .option("--reranker-base-url <url>", "Jina reranker base URL", DEFAULT_RERANKER_BASE_URL)
      .option("--reranker-api-key <key>", "Jina API key; stored in ~/.openclaw/.env")
      .option("--reranker-model <model>", "Reranker model", DEFAULT_RERANKER_MODEL)
      .option("--elasticsearch-url <url>", "Elasticsearch URL", DEFAULT_ELASTICSEARCH_URL)
      .option("--index <index>", "Elasticsearch index", DEFAULT_INDEX)
      .option("--elasticsearch-api-key <key>", "Elasticsearch API key")
      .option("--elasticsearch-user <user>", "Elasticsearch basic auth username")
      .option("--elasticsearch-password <password>", "Elasticsearch basic auth password")
      .option("--auto-recall", "Enable automatic memory recall")
      .option("--auto-capture", "Enable automatic memory capture")
      .option("--top-k <n>", "Recall result count", "5")
      .option("--search-threshold <n>", "Recall score threshold", "0.05")
      .option("--reuse-values", "Reuse current memory-elasticsearch config for unspecified options")
      .option("--json", "Machine-readable output")
      .action((opts: InitOptions, command: any) => {
        try {
          const existingConfig = opts.reuseValues ? readOpenClawPluginConfig() ?? {} : {};
          const existingElasticsearch = objectValue(existingConfig.elasticsearch);
          const existingOpenaiCompatible = objectValue(existingConfig.openaiCompatible);
          const existingLlm = objectValue(existingOpenaiCompatible.llm);
          const existingEmbedding = objectValue(existingOpenaiCompatible.embedding);
          const existingReranker = objectValue(existingConfig.reranker);

          const baseUrl = optionWasSet(command, "baseUrl") ? opts.baseUrl ?? DEFAULT_BASE_URL : DEFAULT_BASE_URL;
          const llmModel = reusableOption(opts, command, "llmModel", stringValue(existingLlm.model), DEFAULT_LLM_MODEL);
          const embeddingModel = reusableOption(
            opts,
            command,
            "embeddingModel",
            stringValue(existingEmbedding.model),
            DEFAULT_EMBEDDING_MODEL,
          );
          const embeddingDims = optionWasSet(command, "embeddingDims")
            ? numberOption(opts.embeddingDims, DEFAULT_EMBEDDING_DIMS)
            : opts.reuseValues
              ? numberValue(existingEmbedding.dims) ?? DEFAULT_EMBEDDING_DIMS
              : numberOption(opts.embeddingDims, DEFAULT_EMBEDDING_DIMS);
          const apiKey = opts.apiKey;
          const apiKeyEnv = "OPENAI_API_KEY";
          const llmApiKeyEnv = opts.llmApiKey ? "OPENAI_LLM_API_KEY" : apiKeyEnv;
          const embeddingApiKeyEnv = opts.embeddingApiKey ? "OPENAI_EMBEDDING_API_KEY" : apiKeyEnv;
          const rerankerApiKeyEnv = "JINA_API_KEY";
          const apiKeyRef = `\${${apiKeyEnv}}`;
          const llmBaseUrl = optionWasSet(command, "llmBaseUrl")
            ? opts.llmBaseUrl ?? baseUrl
            : optionWasSet(command, "baseUrl")
              ? baseUrl
              : opts.reuseValues
                ? stringValue(existingLlm.baseUrl) ?? baseUrl
                : baseUrl;
          const embeddingBaseUrl = optionWasSet(command, "embeddingBaseUrl")
            ? opts.embeddingBaseUrl ?? baseUrl
            : optionWasSet(command, "baseUrl")
              ? baseUrl
              : opts.reuseValues
                ? stringValue(existingEmbedding.baseUrl) ?? baseUrl
                : baseUrl;
          const llmApiKeyRef = opts.llmApiKey
            ? `\${${llmApiKeyEnv}}`
            : optionWasSet(command, "apiKey")
              ? apiKeyRef
              : opts.reuseValues
                ? stringValue(existingLlm.apiKey) ?? apiKeyRef
                : apiKeyRef;
          const embeddingApiKeyRef = opts.embeddingApiKey
            ? `\${${embeddingApiKeyEnv}}`
            : optionWasSet(command, "apiKey")
              ? apiKeyRef
              : opts.reuseValues
                ? stringValue(existingEmbedding.apiKey) ?? apiKeyRef
                : apiKeyRef;
          const rerankerApiKeyRef = `\${${rerankerApiKeyEnv}}`;
          if (apiKey) upsertEnvVar(apiKeyEnv, apiKey);
          if (opts.llmApiKey) upsertEnvVar(llmApiKeyEnv, opts.llmApiKey);
          if (opts.embeddingApiKey) upsertEnvVar(embeddingApiKeyEnv, opts.embeddingApiKey);
          if (opts.rerankerApiKey) upsertEnvVar(rerankerApiKeyEnv, opts.rerankerApiKey);
          const rerankerEnabled = optionWasSet(command, "reranker")
            ? true
            : opts.reuseValues
              ? booleanValue(existingReranker.enabled) ?? false
              : false;
          const rerankerBaseUrl = reusableOption(opts, command, "rerankerBaseUrl", stringValue(existingReranker.baseUrl), DEFAULT_RERANKER_BASE_URL);
          const resolvedRerankerApiKeyRef = opts.rerankerApiKey
            ? rerankerApiKeyRef
            : rerankerEnabled
              ? opts.reuseValues
                ? stringValue(existingReranker.apiKey) ?? rerankerApiKeyRef
                : rerankerApiKeyRef
              : undefined;
          const rerankerModel = reusableOption(opts, command, "rerankerModel", stringValue(existingReranker.model), DEFAULT_RERANKER_MODEL);
          const elasticsearchUrl = reusableOption(opts, command, "elasticsearchUrl", stringValue(existingElasticsearch.url), DEFAULT_ELASTICSEARCH_URL);
          const elasticsearchIndex = reusableOption(opts, command, "index", stringValue(existingElasticsearch.index), DEFAULT_INDEX);
          const elasticsearchApiKey = reusableOption(opts, command, "elasticsearchApiKey", stringValue(existingElasticsearch.apiKey), undefined);
          const elasticsearchUsername = reusableOption(opts, command, "elasticsearchUser", stringValue(existingElasticsearch.username), undefined);
          const elasticsearchPassword = reusableOption(opts, command, "elasticsearchPassword", stringValue(existingElasticsearch.password), undefined);
          const autoRecall = optionWasSet(command, "autoRecall")
            ? opts.autoRecall ?? true
            : opts.reuseValues
              ? booleanValue(existingConfig.autoRecall) ?? true
              : true;
          const autoCapture = optionWasSet(command, "autoCapture")
            ? opts.autoCapture ?? true
            : opts.reuseValues
              ? booleanValue(existingConfig.autoCapture) ?? true
              : true;
          const topK = optionWasSet(command, "topK")
            ? numberOption(opts.topK, 5)
            : opts.reuseValues
              ? numberValue(existingConfig.topK) ?? 5
              : numberOption(opts.topK, 5);
          const searchThreshold = optionWasSet(command, "searchThreshold")
            ? numberOption(opts.searchThreshold, 0.05)
            : opts.reuseValues
              ? numberValue(existingConfig.searchThreshold) ?? 0.05
              : numberOption(opts.searchThreshold, 0.05);

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
            rerankerModel,
          });
          const envFileTouched = Boolean(apiKey || opts.llmApiKey || opts.embeddingApiKey || opts.rerankerApiKey);

          const summary = {
            ok: true,
            configFile: OPENCLAW_CONFIG_FILE,
            envFile: envFileTouched ? OPENCLAW_ENV_FILE : undefined,
            plugin: "memory-elasticsearch",
            memorySlot: "memory-elasticsearch",
            reusedValues: opts.reuseValues === true,
            elasticsearch: {
              url: elasticsearchUrl,
              index: elasticsearchIndex,
            },
            openaiCompatible: {
              llm: {
                baseUrl: llmBaseUrl,
                model: llmModel,
                apiKey: llmApiKeyRef,
              },
              embedding: {
                baseUrl: embeddingBaseUrl,
                model: embeddingModel,
                dims: embeddingDims,
                apiKey: embeddingApiKeyRef,
              },
            },
            reranker: {
              enabled: rerankerEnabled,
              baseUrl: rerankerBaseUrl,
              model: rerankerModel,
              apiKey: resolvedRerankerApiKeyRef,
            },
            message: "Configured. Restart the gateway or rerun plugins doctor.",
          };
          if (jsonOut(opts, summary)) return;

          out("memory-elasticsearch configured");
          out(`  Config: ${OPENCLAW_CONFIG_FILE}`);
          if (opts.reuseValues) out("  Reused unspecified values from existing memory-elasticsearch config");
          if (apiKey) out(`  API key env: ${OPENCLAW_ENV_FILE} (${apiKeyEnv})`);
          if (opts.llmApiKey) out(`  LLM API key env: ${OPENCLAW_ENV_FILE} (${llmApiKeyEnv})`);
          if (opts.embeddingApiKey) out(`  Embedding API key env: ${OPENCLAW_ENV_FILE} (${embeddingApiKeyEnv})`);
          out(`  Elasticsearch: ${summary.elasticsearch.url}/${summary.elasticsearch.index}`);
          out(`  LLM: ${llmBaseUrl} · ${llmModel}`);
          out(`  Embedding: ${embeddingBaseUrl} · ${embeddingModel} (${embeddingDims} dims)`);
          out(`  Reranker: ${rerankerEnabled ? `${summary.reranker.baseUrl} · ${summary.reranker.model}` : "disabled"}`);
          out("  Restart the gateway: openclaw gateway restart");
        } catch (err) {
          if (opts.json) {
            out(JSON.stringify({ ok: false, error: String(err) }, null, 2));
          } else {
            errOut(`init failed: ${String(err)}`);
          }
        }
      });

    root
      .command("add")
      .description("Add one or more explicit memories with semantic dedupe")
      .argument("<text...>", "Memory text")
      .option("--user-id <id>", "Override user ID")
      .option("--json", "Machine-readable output")
      .action(async (textParts: string[], opts: AddCliOptions) => {
        try {
          if (!store) throw new Error("Memory store is not available.");
          const text = commandText(textParts);
          if (!text) throw new Error("Memory text is required.");
          const result = await store.add([{ role: "user", content: text }], {
            user_id: opts.userId ?? config.userId,
            source: "OPENCLAW_CLI",
            infer: false,
            deduced_memories: [text],
            metadata: { captured_by: "cli_add" },
          });
          const payload = { ok: true, count: result.results.length, results: result.results };
          if (jsonOut(opts, payload)) return;
          out(result.results.length
            ? result.results.map((item) => `[${item.event}] ${item.memory} (id=${item.id})`).join("\n")
            : "Duplicate memory found; no new memory stored.");
        } catch (err) {
          if (opts.json) {
            out(JSON.stringify({ ok: false, error: String(err) }, null, 2));
            return;
          }
          errOut(`add failed: ${String(err)}`);
        }
      });

    root
      .command("triage")
      .description("Extract durable memory candidates from text")
      .argument("<text...>", "Conversation text")
      .option("--user-id <id>", "Override user ID")
      .option("--json", "Machine-readable output")
      .action(async (textParts: string[], opts: TriageCliOptions) => {
        try {
          if (!store) throw new Error("Memory store is not available.");
          const text = commandText(textParts);
          if (!text) throw new Error("Text is required.");
          const result = await store.triage([{ role: "user", content: text }], {
            user_id: opts.userId ?? config.userId,
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

    root
      .command("search")
      .description("Search memories")
      .argument("<query>", "Search query")
      .option("--user-id <id>", "Override user ID")
      .option("--top-k <n>", "Max results", String(config.topK))
      .option("--threshold <n>", "Search score threshold", String(config.searchThreshold))
      .option("--json", "Machine-readable output")
      .action(async (query: string, opts: SearchCliOptions) => {
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

    root
      .command("list")
      .description("List memories")
      .option("--user-id <id>", "Override user ID")
      .option("--top-k <n>", "Max results", "50")
      .option("--json", "Machine-readable output")
      .action(async (opts: ListCliOptions) => {
        try {
          if (!store) throw new Error("Memory store is not available.");
          const topK = numberOption(opts.topK, 50);
          const memories = await store.list({
            user_id: opts.userId ?? config.userId,
            page_size: topK,
            limit: topK,
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

    root
      .command("delete")
      .description("Delete memories by id, query, or all user memories")
      .option("--memory-id <id>", "Delete one memory by id")
      .option("--query <query>", "Delete memories matched by search")
      .option("--all", "Delete all memories for the user")
      .option("--confirm", "Skip confirmation prompt with --all")
      .option("--user-id <id>", "Override user ID")
      .option("--json", "Machine-readable output")
      .action(async (opts: DeleteCliOptions) => {
        try {
          if (!store) throw new Error("Memory store is not available.");
          let result: { deleted: number; ids?: string[] };
          if (opts.all) {
            const userId = opts.userId ?? config.userId;
            if (!opts.confirm) {
              if (opts.json) throw new Error("--all requires --confirm when --json is used.");
              const confirmed = await (deps.confirmDeleteAll ?? confirmDeleteAll)(userId);
              if (!confirmed) {
                out("Delete cancelled.");
                return;
              }
            }
            result = await store.deleteAll(userId);
          } else if (opts.query) {
            result = await store.deleteByQuery(opts.query, { user_id: opts.userId ?? config.userId, top_k: 20 });
          } else if (opts.memoryId) {
            result = await store.delete(opts.memoryId);
          } else {
            throw new Error("Pass --memory-id, --query, or --all.");
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

    root
      .command("status")
      .description("Show current memory-elasticsearch runtime config")
      .option("--json", "Machine-readable output")
      .action((opts: { json?: boolean }) => {
        const payload = {
          plugin: "memory-elasticsearch",
          userId: config.userId,
          autoRecall: config.autoRecall,
          autoCapture: config.autoCapture,
          elasticsearch: {
            url: config.elasticsearch.url,
            index: config.elasticsearch.index,
            auth: config.elasticsearch.apiKey ? "apiKey" : config.elasticsearch.username ? "basic" : "none",
          },
          openaiCompatible: {
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
        hasSubcommands: true,
      },
      {
        name: "memory-es",
        description: "Elasticsearch memory plugin commands",
        hasSubcommands: true,
      },
    ],
  });
}
