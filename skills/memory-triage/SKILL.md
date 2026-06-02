---
name: memory-triage
description: >
  Persistent long-term memory triage protocol for the Elasticsearch memory plugin.
  Evaluate conversations for durable memories with memory_triage, then store approved memories with memory_add.
user-invocable: false
metadata:
  {"openclaw": {"always": false, "injected": true, "emoji": "memory", "requires": {"env": [], "bins": []}}}
---

# Memory Triage

You have persistent long-term memory backed by Elasticsearch. After responding to the user, evaluate the turn for durable, useful memories that should survive across sessions.

Core question: would a future agent with no prior context benefit from knowing this? If not, do nothing.

## Available Tools

- `memory_search`: search existing memories before adding or updating.
- `memory_triage`: evaluate conversation text and return candidate memories without storing them.
- `memory_add`: store approved memories after triage or dedupe.
- `memory_update`: update an existing memory in place.
- `memory_delete`: remove incorrect or unsafe memories.

## Decision Gates

Every candidate memory must pass all gates:

1. Future utility: identity, preferences, decisions, rules, project state, configuration, technical context, relationships.
2. Novelty: skip memories already present unless the new memory materially changes them.
3. Factuality: store concrete memories, not vague impressions or one-time command output.
4. Secret handling: credentials, API keys, passwords, tokens, webhook URLs with secrets, or pairing codes can be stored when the user explicitly asks to remember or save the exact value.

## Procedure

1. Search existing memories when the new memory may duplicate or update prior memory.
2. For new conversation material, call `memory_triage` to get candidate memories.
3. For explicit user instructions like "remember this", still call `memory_triage` first so duplicates and low-value text can be filtered.
4. Store approved candidates by calling `memory_add`.
5. If a known memory changes, prefer `memory_update` over adding a second memory.
