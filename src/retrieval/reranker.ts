import type { RerankerConfig } from "../types.js";

export interface RerankResult {
  index: number;
  relevance_score: number;
}

export class JinaReranker {
  constructor(private config: RerankerConfig) {}

  async rerank({ query, documents, topN }: {
    query: string;
    documents: string[];
    topN: number;
  }): Promise<RerankResult[]> {
    if (!this.config.apiKey) {
      throw new Error("Jina reranker is enabled but JINA_API_KEY is not configured.");
    }

    const response = await fetch(`${this.config.baseUrl.replace(/\/+$/, "")}/v1/rerank`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        query,
        top_n: Math.max(1, Math.min(topN, documents.length)),
        documents,
        return_documents: false,
      }),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Jina rerank failed: ${response.status} ${text.slice(0, 500)}`);
    }

    const payload = text ? JSON.parse(text) : {};
    const results = Array.isArray(payload.results) ? payload.results : [];
    return results
      .map((item: any) => ({
        index: Number(item.index),
        relevance_score: Number(item.relevance_score),
      }))
      .filter((item: RerankResult) =>
        Number.isInteger(item.index) &&
        item.index >= 0 &&
        Number.isFinite(item.relevance_score)
      );
  }
}
