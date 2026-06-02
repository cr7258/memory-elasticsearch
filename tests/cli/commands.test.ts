import { describe, expect, it } from "vitest";
import { parseConfig } from "../../src/config.js";
import { registerCliCommands } from "../../src/cli/commands.js";

describe("registerCliCommands", () => {
  it("registers explicit CLI command descriptors for OpenClaw dispatch", () => {
    const calls: Array<{ registrar: unknown; opts: any }> = [];
    const api = {
      registerCli(registrar: unknown, opts: any) {
        calls.push({ registrar, opts });
      },
    };

    registerCliCommands(api, parseConfig({}, { env: {}, username: "alice" }));

    expect(calls).toHaveLength(1);
    expect(calls[0].opts?.descriptors).toEqual([
      {
        name: "memory-elasticsearch",
        description: "Elasticsearch memory plugin commands",
        hasSubcommands: true,
      },
      {
        name: "memory-es",
        description: "Elasticsearch memory plugin commands",
        hasSubcommands: true,
      },
    ]);
  });
});
