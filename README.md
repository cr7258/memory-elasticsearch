# memory-elasticsearch

Elasticsearch-backed memory plugin for OpenClaw.

It replaces the active OpenClaw memory slot with an Elasticsearch store that supports:

- automatic memory recall before prompt construction
- automatic memory capture after agent turns
- manual memory search, add, list, update, delete, and triage tools
- OpenAI-compatible LLM and embedding providers
- app-level hybrid retrieval using vector search plus BM25
- optional Jina reranking with `jina-reranker-v3`

All stored memories are persistent memories. The plugin does not split storage into session-scoped and long-term memories.

## Prerequisites

- OpenClaw with plugin support
- Elasticsearch with `dense_vector` and kNN support
- an OpenAI-compatible chat model
- an OpenAI-compatible embedding model
- optional Jina API key when reranking is enabled

The embedding model and Elasticsearch index dimensions must match. If you change the embedding model or `embeddingDims`, use a new index or recreate the old one.

For local development, a single-node Elasticsearch instance is enough:

```bash
docker run --name openclaw-memory-es \
  -p 9200:9200 \
  -e discovery.type=single-node \
  -e xpack.security.enabled=false \
  docker.elastic.co/elasticsearch/elasticsearch:8.15.5
```

Use your own secured Elasticsearch URL in production. The plugin supports no auth, API key auth, and basic auth.

## Install

From GitHub:

```bash
openclaw plugins install git:github.com/cr7258/memory-elasticsearch@main
```

From ClawHub:

```bash
openclaw plugins install clawhub:@cr7258/memory-elasticsearch
```

From a local checkout:

```bash
cd /path/to/memory-elasticsearch
npm install
npm run build
openclaw plugins install --link .
```

For local plugin installs, keep dependencies installed in the plugin directory. For GitHub and ClawHub installs, OpenClaw manages the plugin install root.

OpenClaw plugin install docs: https://docs.openclaw.ai/cli/plugins

## Uninstall

Remove the installed plugin package:

```bash
openclaw plugins uninstall memory-elasticsearch --force
```

Then restart the gateway:

```bash
openclaw gateway restart
```

Uninstalling the plugin does not delete Elasticsearch data. Delete the memory index only when you are sure you no longer need the stored memories:

```bash
curl -X DELETE 'http://localhost:9200/openclaw-memory'
```

## Initialize

Run `init` after the plugin is installed. This command writes plugin config to `~/.openclaw/openclaw.json`, stores provided API keys in `~/.openclaw/.env`, and selects this plugin as the active memory backend.

Shared OpenAI-compatible endpoint:

```bash
export OPENAI_API_KEY=<your-api-key>
openclaw memory-es init \
  --base-url https://openrouter.ai/api/v1 \
  --api-key $OPENAI_API_KEY \
  --llm-model qwen/qwen3.6-plus \
  --embedding-model qwen/qwen3-embedding-8b \
  --embedding-dims 4096 \
  --elasticsearch-url http://localhost:9200 \
  --index openclaw-memory
```

Separate LLM and embedding endpoints:

```bash
openclaw memory-es init \
  --llm-base-url https://openrouter.ai/api/v1 \
  --llm-api-key <llm-api-key> \
  --llm-model qwen/qwen3.6-plus \
  --embedding-base-url https://api.openai.com/v1 \
  --embedding-api-key <embedding-api-key> \
  --embedding-model text-embedding-3-small \
  --embedding-dims 1536 \
  --elasticsearch-url http://localhost:9200 \
  --index openclaw-memory
```

Enable Jina reranking:

```bash
openclaw memory-es init \
  --reuse-values \
  --reranker \
  --reranker-api-key <jina-api-key> \
  --reranker-model jina-reranker-v3
```

After initialization, restart the gateway so the plugin is loaded with the new config:

```bash
openclaw gateway restart
```

## Configuration Written by Init

`init` stores API key references in OpenClaw config and writes the secret values to `~/.openclaw/.env`.

Default environment variable names:

- `OPENAI_API_KEY`: shared OpenAI-compatible key
- `OPENAI_LLM_API_KEY`: LLM key when `--llm-api-key` is used
- `OPENAI_EMBEDDING_API_KEY`: embedding key when `--embedding-api-key` is used
- `JINA_API_KEY`: Jina reranker key when `--reranker-api-key` is used

Minimal generated config shape:

```json
{
  "plugins": {
    "entries": {
      "memory-elasticsearch": {
        "enabled": true,
        "hooks": {
          "allowConversationAccess": true
        },
        "config": {
          "userId": "alice",
          "autoRecall": true,
          "autoCapture": true,
          "topK": 5,
          "searchThreshold": 0.05,
          "elasticsearch": {
            "url": "http://localhost:9200",
            "index": "openclaw-memory"
          },
          "openaiCompatible": {
            "baseUrl": "https://api.openai.com/v1",
            "apiKey": "${OPENAI_API_KEY}",
            "llm": {
              "baseUrl": "https://api.openai.com/v1",
              "apiKey": "${OPENAI_API_KEY}",
              "model": "gpt-4o-mini"
            },
            "embedding": {
              "baseUrl": "https://api.openai.com/v1",
              "apiKey": "${OPENAI_API_KEY}",
              "model": "text-embedding-3-small",
              "dims": 1536
            }
          },
          "search": {
            "mode": "hybrid",
            "numCandidates": 100,
            "semanticWeight": 0.6,
            "keywordWeight": 0.4
          },
          "reranker": {
            "enabled": false,
            "provider": "jina",
            "baseUrl": "https://api.jina.ai",
            "model": "jina-reranker-v3"
          }
        }
      }
    },
    "slots": {
      "memory": "memory-elasticsearch"
    }
  }
}
```

## Use Memory from the CLI

```bash
openclaw memory-es status
openclaw memory-es status --json
```

Search memories:

```bash
openclaw memory-es search "what languages does the user know"
```

List memories:

```bash
openclaw memory-es list
openclaw memory-es list --user-id alice --top-k 20
```

Add an explicit memory:

```bash
openclaw memory-es add "User prefers Elasticsearch for OpenClaw memory"
```

Preview durable memory candidates without storing them:

```bash
openclaw memory-es triage "Remember this: user prefers qwen/qwen3-embedding-8b for embeddings"
```

Delete by exact memory ID:

```bash
openclaw memory-es delete --memory-id <memory-id>
```

Delete by query. The plugin searches first and deletes only literal text matches:

```bash
openclaw memory-es delete --query "User prefers Elasticsearch"
```

Delete all memories for a user:

```bash
openclaw memory-es delete --all --confirm --user-id alice
```

Any command can return JSON when it supports `--json`:

```bash
openclaw memory-es search "preferences" --json
openclaw memory-es list --json
openclaw memory-es status --json
```
