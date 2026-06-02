import { afterEach, describe, expect, it, vi } from "vitest";
import { parseConfig } from "../../src/config.js";
import { OpenAICompatibleClient } from "../../src/clients/openai-compatible.js";

function clientWithoutApiKey(): OpenAICompatibleClient {
  const config = parseConfig({}, { env: {}, username: "test-user" });
  return new OpenAICompatibleClient(config.openaiCompatible);
}

describe("OpenAICompatibleClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requires an API key for embeddings", async () => {
    await expect(clientWithoutApiKey().embed("remember this")).rejects.toThrow(/required for embeddings/);
  });

  it("uses the embedding endpoint configuration for embeddings", async () => {
    const cfg = parseConfig({
      openaiCompatible: {
        baseUrl: "https://llm.example/v1",
        apiKey: "llm-key",
        llm: {
          baseUrl: "https://llm.example/v1",
          apiKey: "llm-key",
          model: "llm-model",
        },
        embedding: {
          baseUrl: "https://embedding.example/v1",
          apiKey: "embedding-key",
          model: "embedding-model",
          dims: 4096,
        },
      },
    }, { env: {}, username: "test-user" });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ embedding: [1, 2, 3] }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await new OpenAICompatibleClient(cfg.openaiCompatible).embed("hello");

    expect(fetchMock).toHaveBeenCalledWith("https://embedding.example/v1/embeddings", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ authorization: "Bearer embedding-key" }),
      body: expect.stringContaining('"model":"embedding-model"'),
    }));
  });

  it("uses the chat endpoint configuration for chat completions", async () => {
    const cfg = parseConfig({
      openaiCompatible: {
        baseUrl: "https://embedding.example/v1",
        apiKey: "embedding-key",
        embeddingModel: "embedding-model",
        llm: {
          baseUrl: "https://llm.example/v1",
          apiKey: "llm-key",
          model: "llm-model",
        },
      },
    }, { env: {}, username: "test-user" });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "{\"ok\":true}" } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await new OpenAICompatibleClient(cfg.openaiCompatible).completeJson({ system: "Return JSON", user: "hi" });

    expect(fetchMock).toHaveBeenCalledWith("https://llm.example/v1/chat/completions", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ authorization: "Bearer llm-key" }),
      body: expect.stringContaining('"model":"llm-model"'),
    }));
  });

  it("fails loudly when chat completions do not return JSON content", async () => {
    const cfg = parseConfig({
      openaiCompatible: {
        apiKey: "test-key",
        llmModel: "llm-model",
      },
    }, { env: {}, username: "test-user" });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "plain text, not json" } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new OpenAICompatibleClient(cfg.openaiCompatible).completeJson({ system: "Return JSON", user: "hi" }),
    ).rejects.toThrow(/not valid JSON/);
  });
});
