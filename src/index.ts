import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { parseConfig, redactedConfigSummary } from "./config.js";
import { OpenAICompatibleClient } from "./clients/openai-compatible.js";
import { ElasticsearchMemoryStore } from "./stores/elasticsearch.js";
import { registerAllTools } from "./tools/index.js";
import { registerCliCommands } from "./cli/commands.js";
import { cleanPrompt, extractMessages } from "./hooks/capture.js";

function isNonInteractive(trigger: unknown): boolean {
  return trigger === "cron" || trigger === "heartbeat" || trigger === "automation";
}

const plugin = definePluginEntry({
  id: "memory-elasticsearch",
  name: "Memory (Elasticsearch)",
  description: "Elasticsearch-backed OpenClaw memory with BM25 + vector hybrid retrieval",

  register(api: any) {
    const config = parseConfig(api.pluginConfig ?? {});
    const model = new OpenAICompatibleClient(config.openaiCompatible);
    const store = new ElasticsearchMemoryStore({ config, model });

    api.logger?.debug?.(`memory-elasticsearch: registered ${JSON.stringify(redactedConfigSummary(config))}`);

    registerAllTools(api, {
      store,
      config,
    });

    registerCliCommands(api, config, store);

    if (config.autoRecall && typeof api.on === "function") {
      api.on("before_prompt_build", async (event: any, ctx: Record<string, any> = {}) => {
        if (!event?.prompt || cleanPrompt(event.prompt).length < 5) return;
        if (isNonInteractive(ctx.trigger)) return;
        const query = cleanPrompt(event.prompt);
        const memories = await store.search(query, {
          user_id: config.userId,
          top_k: config.topK,
          threshold: config.searchThreshold,
        });
        if (!memories.length) return;
        api.logger?.debug?.(`memory-elasticsearch: recalled ${memories.length} memories for prompt`);
        const body = memories.map((memory) => `- ${memory.memory}`).join("\n");
        return {
          prependContext: `<relevant-memories>\nThe following memories were retrieved from Elasticsearch for user "${config.userId}". Use them only when relevant.\n${body}\n</relevant-memories>`,
        };
      });
    }

    if (config.autoCapture && typeof api.on === "function") {
      api.on("agent_end", async (event: any, ctx: Record<string, any> = {}) => {
        if (!event?.success || !Array.isArray(event.messages) || isNonInteractive(ctx.trigger)) return;
        const messages = extractMessages(event.messages);
        if (!messages.some((message) => message.role === "user")) return;
        try {
          const result = await store.add([
            { role: "system", content: `Current date: ${new Date().toISOString().slice(0, 10)}. Extract durable memories only.` },
            ...messages,
          ], {
            user_id: config.userId,
            source: "OPENCLAW",
            metadata: { captured_by: "agent_end" },
          });
          api.logger?.info?.(`memory-elasticsearch: captured ${result.results.length} memories`);
        } catch (err) {
          api.logger?.warn?.(`memory-elasticsearch: auto-capture failed: ${String(err)}`);
        }
      });
    }
  },
});

export default plugin;
