# memory-elasticsearch

Elasticsearch-backed memory plugin for OpenClaw.

It replaces the active OpenClaw memory slot with an Elasticsearch store that supports:

- automatic memory recall before prompt construction
- automatic memory capture after agent turns
- manual memory search, add, list, update, delete, and triage tools
- OpenAI-compatible LLM and embedding providers
- hybrid retrieval using vector search plus BM25
- optional reranking with Jina, defaulting to `jina-reranker-v3`

## Prerequisites

- Elasticsearch with `dense_vector` and kNN support. For local development, a single-node Elasticsearch instance is enough:

```bash
docker run --name openclaw-memory-es \
  -p 9200:9200 \
  -e discovery.type=single-node \
  -e xpack.security.enabled=false \
  docker.elastic.co/elasticsearch/elasticsearch:8.15.5
```

- an OpenAI-compatible chat model
- an OpenAI-compatible embedding model
- optional Jina API key when reranking is enabled

## Quickstart

Set your OpenAI-compatible API key:

```bash
export OPENAI_API_KEY=<your-openai-compatible-api-key>
```

Install from npm:

```bash
openclaw plugins install npm:@cr7258/memory-elasticsearch
```

Or from GitHub:

```bash
openclaw plugins install git:github.com/cr7258/memory-elasticsearch@main
```

Enable the plugin:

```bash
openclaw plugins enable memory-es
```

Initialize the plugin and configure the LLM and embedding models. The embedding model output dimensions must match the Elasticsearch index dimensions.

```bash
openclaw memory-es init \
  --base-url https://openrouter.ai/api/v1 \
  --api-key "$OPENAI_API_KEY" \
  --llm-model <llm-model-name> \
  --embedding-model <embedding-model-name> \
  --embedding-dims 4096 \
  --elasticsearch-url <elasticsearch-url> \
  --elasticsearch-username <elasticsearch-username> \
  --elasticsearch-password <elasticsearch-password> \
  --index openclaw-memory

# Example
openclaw memory-es init \
  --base-url https://openrouter.ai/api/v1 \
  --api-key "$OPENAI_API_KEY" \
  --llm-model qwen/qwen3.6-plus \
  --embedding-model qwen/qwen3-embedding-8b \
  --embedding-dims 4096 \
  --elasticsearch-url http://localhost:9200 \
  --index openclaw-memory
```

Restart the gateway so the plugin is loaded with the new config:

```bash
openclaw gateway restart
```

Create a first session and say something durable:

```bash
openclaw tui --session t1
```

```text
I usually drink milk latte in the morning, and I prefer waffles for breakfast.
```

Check that memory was captured:

```bash
openclaw memory-es list --json
```

Start another session and ask for the stored preference:

```bash
openclaw tui --session t2
```

```text
What do I usually drink in the morning?
```

Expected answer:

```text
You usually drink a milk latte in the morning.
```

## Reranker

Reranking is disabled by default. It can improve result ordering by rescoring the hybrid search candidates with a dedicated reranker model.

First, add two memories that are easy for hybrid retrieval to confuse:

```bash
openclaw memory-es add "Last year I put cashew butter on toast every morning."
openclaw memory-es add "These days my breakfast toast gets apricot jam."
```

Search before enabling reranking:

```bash
openclaw memory-es search "Which spread do I currently put on toast?" --json --top-k 2

# Response
{
  "ok": true,
  "query": "Which spread do I currently put on toast?",
  "count": 2,
  "memories": [
    {
      "id": "a05452e5-55af-429f-a972-7a907662e1d8",
      "memory": "Last year I put cashew butter on toast every morning.",
      "score": 0.8648928434596657,
      "user_id": "root",
      "metadata": {
        "captured_by": "cli_add",
        "attributed_to": "user",
        "source": "OPENCLAW_CLI"
      },
      "components": {
        "semantic": 0.8151684,
        "bm25": 0.9394795086491641
      },
      "created_at": "2026-06-02T04:59:19.500Z",
      "updated_at": "2026-06-02T04:59:19.500Z"
    },
    {
      "id": "95aa8b17-1ae6-44da-a31f-eb49abfb8ff3",
      "memory": "These days my breakfast toast gets apricot jam.",
      "score": 0.5432100021401755,
      "user_id": "root",
      "metadata": {
        "captured_by": "cli_add",
        "attributed_to": "user",
        "linked_memory_ids": [
          "a05452e5-55af-429f-a972-7a907662e1d8"
        ],
        "source": "OPENCLAW_CLI"
      },
      "components": {
        "semantic": 0.86079884,
        "bm25": 0.06682674535043857
      },
      "created_at": "2026-06-02T05:00:14.109Z",
      "updated_at": "2026-06-02T05:00:14.109Z"
    }
  ]
}
```

Enable Jina reranking:

```bash
export JINA_API_KEY=<your-jina-api-key>

openclaw memory-es init \
  --reuse-values \
  --reranker \
  --reranker-api-key "$JINA_API_KEY"
```

Search again:

```bash
openclaw memory-es search "Which spread do I currently put on toast?" --json --top-k 2

# Response
{
  "ok": true,
  "query": "Which spread do I currently put on toast?",
  "count": 2,
  "memories": [
    {
      "id": "95aa8b17-1ae6-44da-a31f-eb49abfb8ff3",
      "memory": "These days my breakfast toast gets apricot jam.",
      "score": 0.08000827,
      "user_id": "root",
      "metadata": {
        "captured_by": "cli_add",
        "attributed_to": "user",
        "linked_memory_ids": [
          "a05452e5-55af-429f-a972-7a907662e1d8"
        ],
        "source": "OPENCLAW_CLI"
      },
      "components": {
        "semantic": 0.86129856,
        "bm25": 0.06682674535043857,
        "original": 0.5435098341401755,
        "rerank": 0.08000827
      },
      "created_at": "2026-06-02T05:00:14.109Z",
      "updated_at": "2026-06-02T05:00:14.109Z"
    },
    {
      "id": "a05452e5-55af-429f-a972-7a907662e1d8",
      "memory": "Last year I put cashew butter on toast every morning.",
      "score": 0.07208811,
      "user_id": "root",
      "metadata": {
        "captured_by": "cli_add",
        "attributed_to": "user",
        "source": "OPENCLAW_CLI"
      },
      "components": {
        "semantic": 0.81590843,
        "bm25": 0.9394795086491641,
        "original": 0.8653368614596657,
        "rerank": 0.07208811
      },
      "created_at": "2026-06-02T04:59:19.500Z",
      "updated_at": "2026-06-02T04:59:19.500Z"
    }
  ]
}
```

With reranking enabled, the result includes `components.original` for the original hybrid score and `components.rerank` for the Jina score. The final order follows the reranker.

## Uninstall

Remove the installed plugin package:

```bash
openclaw plugins uninstall memory-es
```

Then restart the gateway:

```bash
openclaw gateway restart
```

Uninstalling the plugin does not delete Elasticsearch data. Delete the memory index only when you are sure you no longer need the stored memories:

```bash
curl -X DELETE 'http://localhost:9200/openclaw-memory'
```

## Memory CLI

You can also manage memories directly from the CLI.

List memories:

```bash
openclaw memory-es list
```

Add a memory:

```bash
openclaw memory-es add "User prefers Elasticsearch for OpenClaw memory"
```

Search memories:

```bash
openclaw memory-es search "what languages does the user know"
```

Delete memories:

```bash
openclaw memory-es delete --query "User prefers Elasticsearch"
```
