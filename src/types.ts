export interface SearchConfig {
  mode: "hybrid";
  semanticWeight: number;
  keywordWeight: number;
}

export interface RerankerConfig {
  enabled: boolean;
  provider: "jina";
  baseUrl: string;
  apiKey?: string;
  model: string;
}

export interface OpenAICompatibleEndpointConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
}

export interface OpenAICompatibleEmbeddingConfig extends OpenAICompatibleEndpointConfig {
  dims: number;
}

export interface MemoryConfig {
  userId: string;
  autoRecall: boolean;
  autoCapture: boolean;
  topK: number;
  searchThreshold: number;
  elasticsearch: {
    url: string;
    index: string;
    apiKey?: string;
    username?: string;
    password?: string;
  };
  openaiCompatible: {
    llm: OpenAICompatibleEndpointConfig;
    embedding: OpenAICompatibleEmbeddingConfig;
  };
  search: SearchConfig;
  reranker: RerankerConfig;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ExtractedMemory {
  id?: string;
  text: string;
  attributed_to?: "user" | "assistant" | string;
  linked_memory_ids?: string[];
  metadata?: Record<string, unknown>;
}

export interface MemoryRecord {
  id: string;
  memory: string;
  score?: number;
  user_id?: string;
  agent_id?: string;
  metadata?: Record<string, unknown>;
  components?: Record<string, number>;
  created_at?: string;
  updated_at?: string;
}

export interface AddOptions {
  user_id?: string;
  source?: string;
  infer?: boolean;
  memories?: Array<string | ExtractedMemory>;
  deduced_memories?: Array<string | ExtractedMemory>;
  metadata?: Record<string, unknown>;
}

export interface SearchOptions {
  user_id?: string;
  top_k?: number;
  threshold?: number;
  filters?: Record<string, unknown>;
}

export interface TriageOptions {
  user_id?: string;
}

export interface MemoryStore {
  ensureIndex(): Promise<boolean>;
  add(messages: ChatMessage[], options?: AddOptions): Promise<{ results: Array<{ id: string; memory: string; event: string }> }>;
  triage(messages: ChatMessage[], options?: TriageOptions): Promise<{ memories: ExtractedMemory[] }>;
  search(query: string, options?: SearchOptions): Promise<MemoryRecord[]>;
  get(memoryId: string): Promise<MemoryRecord>;
  list(options?: SearchOptions & { page_size?: number; limit?: number }): Promise<MemoryRecord[]>;
  update(memoryId: string, text: string, metadata?: Record<string, unknown>): Promise<MemoryRecord>;
  delete(memoryId: string): Promise<{ deleted: number }>;
  deleteByQuery(query: string, options?: SearchOptions): Promise<{ deleted: number; ids: string[] }>;
  deleteAll(userId?: string): Promise<{ deleted: number }>;
}

export interface ToolDeps {
  store: MemoryStore;
  config: MemoryConfig;
}

export interface OpenClawTool {
  name: string;
  label?: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(toolCallId: string, params: Record<string, any>): Promise<{ content: Array<{ type: string; text: string }>; details?: Record<string, unknown> }>;
}
