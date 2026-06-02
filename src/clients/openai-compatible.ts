import type { MemoryConfig, OpenAICompatibleEndpointConfig } from "../types.js";

function urlJoin(baseUrl: string, path: string): string {
  return `${String(baseUrl).replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export class OpenAICompatibleClient {
  constructor(public config: MemoryConfig["openaiCompatible"]) {}

  headers(endpoint: OpenAICompatibleEndpointConfig, purpose: string): Record<string, string> {
    if (!endpoint.apiKey) throw new Error(`OpenAI-compatible API key is required for ${purpose}`);
    return {
      "content-type": "application/json",
      authorization: `Bearer ${endpoint.apiKey}`,
    };
  }

  async embed(text: string): Promise<number[]> {
    const endpoint = this.config.embedding;
    const response = await fetch(urlJoin(endpoint.baseUrl, "/embeddings"), {
      method: "POST",
      headers: this.headers(endpoint, "embeddings"),
      body: JSON.stringify({
        model: endpoint.model,
        input: text,
      }),
    });
    const bodyText = await response.text();
    if (!response.ok) throw new Error(`OpenAI-compatible embeddings failed: ${response.status} ${bodyText.slice(0, 300)}`);
    const json = JSON.parse(bodyText);
    const embedding = json?.data?.[0]?.embedding;
    if (!Array.isArray(embedding)) throw new Error("OpenAI-compatible embeddings response did not include data[0].embedding");
    return embedding;
  }

  async completeJson({ system, user }: { system: string; user: string }): Promise<Record<string, any>> {
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
          { role: "user", content: user },
        ],
      }),
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
}
