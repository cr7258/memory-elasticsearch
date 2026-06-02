export function lemmatizeForSearch(text: unknown): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[`"'“”‘’]/g, " ")
    .replace(/[^\p{L}\p{N}_./:-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function literalMemoryTextMatch(query: string, text: string): boolean {
  const normalizedQuery = lemmatizeForSearch(query);
  if (!normalizedQuery) return false;
  return lemmatizeForSearch(text).includes(normalizedQuery);
}

export function buildFilterClauses({ userId, filters }: {
  userId?: string;
  filters?: Record<string, unknown>;
} = {}): Record<string, unknown>[] {
  const clauses: Record<string, unknown>[] = [];
  if (userId) clauses.push({ term: { user_id: userId } });
  if (filters && typeof filters === "object" && !Array.isArray(filters)) {
    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) clauses.push({ terms: { [`metadata.${key}`]: value } });
      else clauses.push({ term: { [`metadata.${key}`]: value } });
    }
  }
  return clauses;
}

export function buildKeywordQuery(query: string, filters: Record<string, unknown>[] = []): Record<string, unknown> {
  const normalized = lemmatizeForSearch(query);
  const textQuery = normalized
    ? {
        bool: {
          should: [
            { multi_match: { query, fields: ["memory^3", "text_lemmatized^2", "metadata.summary", "metadata.topic"], type: "best_fields" } },
            { match_phrase: { memory: { query, boost: 2 } } },
          ],
          minimum_should_match: 1,
        },
      }
    : { match_all: {} };

  if (!filters.length) return textQuery;
  return { bool: { must: [textQuery], filter: filters } };
}

export function buildKnnSearchBody({ vector, topK, filters = [] }: {
  vector: number[];
  topK: number;
  filters?: Record<string, unknown>[];
}): Record<string, unknown> {
  const knnFilter = filters.length ? { bool: { filter: filters } } : undefined;
  return {
    size: topK,
    knn: {
      field: "vector",
      query_vector: vector,
      k: topK,
      ...(knnFilter ? { filter: knnFilter } : {}),
    },
    _source: { excludes: ["vector"] },
  };
}

export function buildKeywordSearchBody({ query, topK, filters = [] }: {
  query: string;
  topK: number;
  filters?: Record<string, unknown>[];
}): Record<string, unknown> {
  return {
    size: topK,
    query: buildKeywordQuery(query, filters),
    _source: { excludes: ["vector"] },
  };
}

export function bm25ParamsForQuery(query: string, lemmatized = lemmatizeForSearch(query)): { midpoint: number; steepness: number } {
  const terms = lemmatized ? lemmatized.split(/\s+/).filter(Boolean).length : 1;
  if (terms <= 3) return { midpoint: 5.0, steepness: 0.7 };
  if (terms <= 6) return { midpoint: 7.0, steepness: 0.6 };
  if (terms <= 9) return { midpoint: 9.0, steepness: 0.5 };
  if (terms <= 15) return { midpoint: 10.0, steepness: 0.5 };
  return { midpoint: 12.0, steepness: 0.5 };
}

export function normalizeBm25Score({ query, rawScore, lemmatized }: { query: string; rawScore: number; lemmatized?: string }): number {
  const score = Number(rawScore);
  if (!Number.isFinite(score) || score <= 0) return 0;
  const { midpoint, steepness } = bm25ParamsForQuery(query, lemmatized);
  return 1 / (1 + Math.exp(-steepness * (score - midpoint)));
}

function clamp01(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  if (number >= 1) return 1;
  return number;
}

function mapValue<T>(source: Map<string, T> | Record<string, T> | undefined, key: string): T | undefined {
  if (!source) return undefined;
  if (source instanceof Map) return source.get(key);
  return source[key];
}

export interface RankedItem {
  id: string;
  score?: number;
  payload?: Record<string, any>;
}

interface HybridWeights {
  semantic: number;
  keyword: number;
}

export function keywordHitsToBm25Scores({ query, hits = [] }: { query: string; hits: RankedItem[] }): Map<string, number> {
  const lemmatized = lemmatizeForSearch(query);
  return new Map(
    hits
      .map((item) => [String(item.id), normalizeBm25Score({ query, lemmatized, rawScore: item.score ?? 0 })] as const)
      .filter(([, score]) => score > 0),
  );
}

export function hitsToPayloadMap(items: RankedItem[] = []): Map<string, Record<string, any>> {
  return new Map(items.map((item) => [String(item.id), item.payload]).filter(([, payload]) => payload) as Array<[string, Record<string, any>]>);
}

export function scoreHybridResults({
  semantic = [],
  bm25Scores = new Map(),
  keywordPayloads = new Map(),
  threshold = 0,
  topK = 5,
  weights = {},
}: {
  semantic?: RankedItem[];
  bm25Scores?: Map<string, number> | Record<string, number>;
  keywordPayloads?: Map<string, Record<string, any>>;
  threshold?: number;
  topK?: number;
  weights?: Partial<HybridWeights>;
}): Array<RankedItem & { semantic: boolean; keyword: boolean; components: Record<string, number> }> {
  const semanticWeight = Number.isFinite(weights.semantic) ? weights.semantic! : 0.6;
  const keywordWeight = Number.isFinite(weights.keyword) ? weights.keyword! : 0.4;
  const maxPossible = Math.max(semanticWeight + keywordWeight, 1);

  const candidates = new Map<string, { id: string; semanticScore: number; bm25Score?: number; payload?: Record<string, any>; semantic: boolean; keyword?: boolean }>();
  for (const item of semantic) {
    const id = String(item.id);
    const semanticScore = clamp01(item.score);
    if (semanticScore < threshold) continue;
    candidates.set(id, { id, semanticScore, payload: item.payload, semantic: true });
  }

  const keywordEntries = bm25Scores instanceof Map ? bm25Scores.entries() : Object.entries(bm25Scores ?? {});
  for (const [rawId, rawScore] of keywordEntries) {
    const id = String(rawId);
    const bm25Score = clamp01(rawScore);
    if (bm25Score <= 0) continue;
    const existing = candidates.get(id) ?? { id, semanticScore: 0, payload: mapValue(keywordPayloads, id), semantic: false };
    existing.bm25Score = bm25Score;
    existing.keyword = true;
    existing.payload = existing.payload ?? mapValue(keywordPayloads, id);
    candidates.set(id, existing);
  }

  const scored = [];
  for (const candidate of candidates.values()) {
    const rawScore =
      semanticWeight * (candidate.semanticScore ?? 0) +
      keywordWeight * (candidate.bm25Score ?? 0);

    if (rawScore <= 0) continue;
    scored.push({
      id: candidate.id,
      score: Math.min(rawScore / maxPossible, 1),
      payload: candidate.payload,
      semantic: Boolean(candidate.semantic),
      keyword: Boolean(candidate.keyword),
      components: {
        semantic: candidate.semanticScore ?? 0,
        bm25: candidate.bm25Score ?? 0,
      },
    });
  }

  return scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, topK);
}

export function hitsToRankedItems(hits: Array<{ _id?: string; _score?: number; _source?: Record<string, any> }> = []): RankedItem[] {
  return hits.map((hit) => ({
    id: hit._id ?? hit._source?.id,
    score: hit._score,
    payload: hit._source,
  })).filter((item) => item.id);
}
