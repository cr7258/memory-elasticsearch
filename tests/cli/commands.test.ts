import { afterEach, describe, expect, it, vi } from "vitest";
import { parseConfig } from "../../src/config.js";
import { registerCliCommands } from "../../src/cli/commands.js";

function commandStub(actions: Map<string, Function>, name = "root"): any {
  return {
    command(commandName: string) {
      return commandStub(actions, commandName);
    },
    alias() {
      return this;
    },
    description() {
      return this;
    },
    option() {
      return this;
    },
    argument() {
      return this;
    },
    action(handler: Function) {
      actions.set(name, handler);
      return this;
    },
  };
}

describe("registerCliCommands", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it("reports semantic duplicate add results clearly", async () => {
    const calls: Array<{ registrar: Function; opts: any }> = [];
    const api = {
      registerCli(registrar: Function, opts: any) {
        calls.push({ registrar, opts });
      },
    };
    const store = {
      add: vi.fn(async () => ({ results: [] })),
    };
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const actions = new Map<string, Function>();
    const program = commandStub(actions);

    registerCliCommands(api, parseConfig({}, { env: {}, username: "alice" }), store as any);
    calls[0].registrar({ program });
    await actions.get("add")?.(["I drink milk latte in the morning."], {});

    expect(stdout).toHaveBeenCalledWith("Duplicate memory found; no new memory stored.\n");
  });
});
