import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPluginConfig, type InitConfigInput, patchOpenClawConfig, readOpenClawPluginConfig } from "../../src/cli/config-file.js";

function initInput(overrides: Partial<InitConfigInput> = {}): InitConfigInput {
  return {
    userId: "alice",
    autoRecall: true,
    autoCapture: true,
    topK: 5,
    searchThreshold: 0.05,
    elasticsearchUrl: "http://localhost:9200",
    elasticsearchIndex: "openclaw-memory",
    llmBaseUrl: "https://llm.example/v1",
    llmApiKeyRef: "${OPENAI_LLM_API_KEY}",
    llmModel: "qwen/qwen3.6-plus",
    embeddingBaseUrl: "https://embedding.example/v1",
    embeddingApiKeyRef: "${OPENAI_EMBEDDING_API_KEY}",
    embeddingModel: "qwen/qwen3-embedding-8b",
    embeddingDims: 4096,
    rerankerEnabled: false,
    rerankerBaseUrl: "https://api.jina.ai",
    rerankerModel: "jina-reranker-v3",
    ...overrides,
  };
}

describe("buildPluginConfig", () => {
  it("writes separate llm and embedding endpoint blocks", () => {
    const pluginConfig = buildPluginConfig(initInput({
      llmBaseUrl: "https://llm.example/v1",
      llmApiKeyRef: "${OPENAI_LLM_API_KEY}",
      llmModel: "llm-model",
      embeddingBaseUrl: "https://embedding.example/v1",
      embeddingApiKeyRef: "${OPENAI_EMBEDDING_API_KEY}",
      embeddingModel: "embedding-model",
      embeddingDims: 4096,
      rerankerEnabled: true,
      rerankerBaseUrl: "https://api.jina.ai",
      rerankerApiKeyRef: "${JINA_API_KEY}",
      rerankerModel: "jina-reranker-v3",
    }));

    expect(pluginConfig.openaiCompatible).toMatchObject({
      llm: {
        baseUrl: "https://llm.example/v1",
        apiKey: "${OPENAI_LLM_API_KEY}",
        model: "llm-model",
      },
      embedding: {
        baseUrl: "https://embedding.example/v1",
        apiKey: "${OPENAI_EMBEDDING_API_KEY}",
        model: "embedding-model",
        dims: 4096,
      },
    });
    expect(pluginConfig.openaiCompatible).not.toHaveProperty("baseUrl");
    expect(pluginConfig.openaiCompatible).not.toHaveProperty("apiKey");
    expect(pluginConfig.openaiCompatible).not.toHaveProperty("llmModel");
    expect(pluginConfig.openaiCompatible).not.toHaveProperty("embeddingModel");
    expect(pluginConfig.openaiCompatible).not.toHaveProperty("embeddingDims");
    expect(pluginConfig.reranker).toMatchObject({
      enabled: true,
      provider: "jina",
      baseUrl: "https://api.jina.ai",
      apiKey: "${JINA_API_KEY}",
      model: "jina-reranker-v3",
    });
  });
});

describe("readOpenClawPluginConfig", () => {
  it("reads existing raw plugin config for init --reuse-values", () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-es-config-"));
    const path = join(dir, "openclaw.json");
    try {
      patchOpenClawConfig(initInput({
        topK: 7,
        searchThreshold: 0.12,
        elasticsearchUrl: "http://es:9200",
        elasticsearchIndex: "openclaw-memory-existing",
      }), path);

      const pluginConfig = readOpenClawPluginConfig(path);

      expect(pluginConfig?.elasticsearch.index).toBe("openclaw-memory-existing");
      expect(pluginConfig?.openaiCompatible.llm.model).toBe("qwen/qwen3.6-plus");
      expect(pluginConfig?.openaiCompatible.embedding.dims).toBe(4096);
      expect(pluginConfig?.openaiCompatible).not.toHaveProperty("apiKey");
      expect(pluginConfig?.openaiCompatible).not.toHaveProperty("embeddingDims");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("merges all memory tools into tools.alsoAllow without removing existing tools", () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-es-config-"));
    const path = join(dir, "openclaw.json");
    try {
      writeFileSync(path, JSON.stringify({
        tools: {
          alsoAllow: ["web_search", "memory_add"],
        },
      }));

      patchOpenClawConfig(initInput(), path);

      const config = JSON.parse(readFileSync(path, "utf8"));
      expect(config.tools.alsoAllow).toEqual([
        "web_search",
        "memory_add",
        "memory_search",
        "memory_get",
        "memory_list",
        "memory_update",
        "memory_delete",
        "memory_triage",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

});
