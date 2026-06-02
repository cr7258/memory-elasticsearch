import { describe, expect, it } from "vitest";
import { cleanPrompt, extractMessages } from "../../src/hooks/capture.js";

describe("capture helpers", () => {
  it("does not hard-code memory intent phrases", () => {
    const messages = extractMessages([{ role: "user", content: "Remember this: my test passphrase is amber-signal-204" }]);

    expect(messages).toEqual([{ role: "user", content: "Remember this: my test passphrase is amber-signal-204" }]);
  });

  it("passes short questions through for LLM triage instead of rule-filtering them", () => {
    const messages = extractMessages([{ role: "user", content: "who is ronaldo?" }]);

    expect(messages).toEqual([{ role: "user", content: "who is ronaldo?" }]);
  });

  it("strips runtime timestamp prefixes before LLM triage", () => {
    const prompt = "[Sat 2026-05-30 23:54 GMT+5:30] What is my Elasticsearch-only test passphrase? Answer with only the passphrase.";
    expect(cleanPrompt(prompt)).toBe("What is my Elasticsearch-only test passphrase? Answer with only the passphrase.");
    expect(extractMessages([{ role: "user", content: prompt }])).toEqual([
      { role: "user", content: "What is my Elasticsearch-only test passphrase? Answer with only the passphrase." },
    ]);
  });
});
