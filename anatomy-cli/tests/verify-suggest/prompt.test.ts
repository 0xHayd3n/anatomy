import { describe, it, expect } from "vitest";
import { Readable, Writable } from "node:stream";
import { promptForSuggestion } from "../../src/verify-suggest/prompt.js";

function mockIO(input: string): { stdin: Readable; stdout: Writable; output: { text: string } } {
  const stdin = Readable.from([input]);
  const output = { text: "" };
  const stdout = new Writable({
    write(chunk, _enc, cb) { output.text += String(chunk); cb(); },
  });
  return { stdin, stdout, output };
}

describe("promptForSuggestion", () => {
  const suggestion = {
    ruleIndex: 0,
    rule: { rule: "test rule", why: "test" },
    candidate: { kind: "glob_exists", path: "package.json" } as const,
    source: "test-mining" as const,
    dryRun: { accepted: true as const, hits: [] },
  };

  it("returns 'accept' when user types 'a'", async () => {
    const io = mockIO("a\n");
    const action = await promptForSuggestion(suggestion, { io: { stdin: io.stdin, stdout: io.stdout } });
    expect(action.kind).toBe("accept");
  });

  it("returns 'reject' when user types 'r'", async () => {
    const io = mockIO("r\n");
    const action = await promptForSuggestion(suggestion, { io: { stdin: io.stdin, stdout: io.stdout } });
    expect(action.kind).toBe("reject");
  });

  it("returns 'skip' when user types 's'", async () => {
    const io = mockIO("s\n");
    const action = await promptForSuggestion(suggestion, { io: { stdin: io.stdin, stdout: io.stdout } });
    expect(action.kind).toBe("skip");
  });

  it("returns 'quit' when user types 'q'", async () => {
    const io = mockIO("q\n");
    const action = await promptForSuggestion(suggestion, { io: { stdin: io.stdin, stdout: io.stdout } });
    expect(action.kind).toBe("quit");
  });

  it("re-prompts on invalid input until a valid key is given", async () => {
    const io = mockIO("x\nr\n");
    const action = await promptForSuggestion(suggestion, { io: { stdin: io.stdin, stdout: io.stdout } });
    expect(action.kind).toBe("reject");
    expect(io.output.text).toMatch(/invalid/i);
  });

  it("prints the source, candidate, and dry-run summary", async () => {
    const io = mockIO("r\n");
    await promptForSuggestion(suggestion, { io: { stdin: io.stdin, stdout: io.stdout } });
    expect(io.output.text).toContain("test-mining");
    expect(io.output.text).toContain("glob_exists");
    expect(io.output.text).toContain("package.json");
  });
});
