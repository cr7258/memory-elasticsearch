import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";

describe("parseConfig", () => {
  it("fills practical defaults", () => {
    const cfg = parseConfig({
      elasticsearch: { url: "http://es:9200" },
      openaiCompatible: {
        llm: { apiKey: "test-key" },
        embedding: { apiKey: "test-key" },
      },
    }, {
      env: {},
      username: "alice",
    });

    expect(cfg.elasticsearch.url).toBe("http://es:9200");
    expect(cfg.elasticsearch.index).toBe("openclaw-memory");
    expect(cfg.userId).toBe("alice");
    expect(cfg.topK).toBe(5);
    expect(cfg.search.mode).toBe("hybrid");
    expect(cfg.search.semanticWeight).toBe(0.6);
    expect(cfg.search.keywordWeight).toBe(0.4);
    expect(cfg.search).not.toHaveProperty("numCandidates");
    expect(cfg.reranker.enabled).toBe(false);
    expect(cfg.reranker.model).toBe("jina-reranker-v3");
    expect(cfg.openaiCompatible.llm).toEqual({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "gpt-4o-mini",
    });
    expect(cfg.openaiCompatible.embedding).toEqual({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-key",
      model: "text-embedding-3-small",
      dims: 1536,
    });
  });

  it("can read environment defaults without leaking secret shape", () => {
    const cfg = parseConfig({}, {
      env: {
        ELASTICSEARCH_URL: "http://localhost:9200",
        OPENAI_API_KEY: "sk-test-secret",
        OPENAI_BASE_URL: "https://proxy.example/v1",
      },
      username: "default-user",
    });

    expect(cfg.elasticsearch.url).toBe("http://localhost:9200");
    expect(cfg.openaiCompatible.llm.apiKey).toBe("sk-test-secret");
    expect(cfg.openaiCompatible.llm.baseUrl).toBe("https://proxy.example/v1");
    expect(cfg.openaiCompatible.embedding.apiKey).toBe("sk-test-secret");
    expect(cfg.openaiCompatible.embedding.baseUrl).toBe("https://proxy.example/v1");
    expect(cfg.userId).toBe("default-user");
  });

  it("resolves endpoint API key placeholders", () => {
    const resolved = parseConfig({
      openaiCompatible: {
        llm: { apiKey: "${MODEL_API_KEY}" },
        embedding: { apiKey: "${MODEL_API_KEY}" },
      },
    }, {
      env: { MODEL_API_KEY: "resolved-key" },
      username: "default-user",
    });
    const missing = parseConfig({
      openaiCompatible: {
        llm: { apiKey: "${MODEL_API_KEY}" },
        embedding: { apiKey: "${MODEL_API_KEY}" },
      },
    }, {
      env: {},
      username: "default-user",
    });

    expect(resolved.openaiCompatible.llm.apiKey).toBe("resolved-key");
    expect(resolved.openaiCompatible.embedding.apiKey).toBe("resolved-key");
    expect(missing.openaiCompatible.llm.apiKey).toBeUndefined();
    expect(missing.openaiCompatible.embedding.apiKey).toBeUndefined();
  });

  it("resolves Jina reranker config and API key placeholders", () => {
    const cfg = parseConfig({
      reranker: {
        enabled: true,
        apiKey: "${JINA_API_KEY}",
        model: "jina-reranker-v3",
      },
    }, {
      env: { JINA_API_KEY: "jina-key" },
      username: "default-user",
    });

    expect(cfg.reranker).toMatchObject({
      enabled: true,
      provider: "jina",
      baseUrl: "https://api.jina.ai",
      apiKey: "jina-key",
      model: "jina-reranker-v3",
    });
  });

  it("does not resolve Jina API key when reranker is disabled", () => {
    const cfg = parseConfig({
      reranker: {
        enabled: false,
        apiKey: "${JINA_API_KEY}",
      },
    }, {
      env: { JINA_API_KEY: "jina-key" },
      username: "default-user",
    });

    expect(cfg.reranker.enabled).toBe(false);
    expect(cfg.reranker.apiKey).toBeUndefined();
  });

  it("lets llm and embedding endpoints override shared OpenAI-compatible defaults", () => {
    const cfg = parseConfig({
      openaiCompatible: {
        llm: {
          baseUrl: "https://llm.example/v1",
          apiKey: "${LLM_API_KEY}",
          model: "llm-model",
        },
        embedding: {
          baseUrl: "https://embedding.example/v1",
          apiKey: "${EMBEDDING_API_KEY}",
          model: "embedding-model",
          dims: 4096,
        },
      },
    }, {
      env: {
        LLM_API_KEY: "llm-key",
        EMBEDDING_API_KEY: "embedding-key",
      },
      username: "default-user",
    });

    expect(cfg.openaiCompatible.llm).toEqual({
      baseUrl: "https://llm.example/v1",
      apiKey: "llm-key",
      model: "llm-model",
    });
    expect(cfg.openaiCompatible.embedding).toEqual({
      baseUrl: "https://embedding.example/v1",
      apiKey: "embedding-key",
      model: "embedding-model",
      dims: 4096,
    });
  });

  it("ignores removed outer OpenAI-compatible compatibility fields", () => {
    const cfg = parseConfig({
      openaiCompatible: {
        baseUrl: "https://outer.example/v1",
        apiKey: "outer-key",
        llmModel: "outer-llm",
        embeddingModel: "outer-embedding",
        embeddingDims: 777,
      },
    }, {
      env: {},
      username: "default-user",
    });

    expect(cfg.openaiCompatible.llm).toEqual({
      baseUrl: "https://api.openai.com/v1",
      apiKey: undefined,
      model: "gpt-4o-mini",
    });
    expect(cfg.openaiCompatible.embedding).toEqual({
      baseUrl: "https://api.openai.com/v1",
      apiKey: undefined,
      model: "text-embedding-3-small",
      dims: 1536,
    });
  });
});
