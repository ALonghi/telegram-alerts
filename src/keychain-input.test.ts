import { expect, test } from "bun:test";
import { keychainInput } from "./keychain-input.ts";

test.skipIf(process.platform !== "darwin")("security accepts generated input and exits successfully at EOF", async () => {
  // Read-only: exercises the real command parser without reading or writing credentials.
  const child = Bun.spawn(["/usr/bin/security", "-i"], {
    stdin: new TextEncoder().encode(keychainInput(["help"])),
    stdout: "ignore", stderr: "pipe",
  });
  const stderr = await new Response(child.stderr).text();
  expect(stderr).not.toContain("unknown command");
  expect(await child.exited).toBe(0);
});

test("rejects command injection in arguments", () => {
  expect(() => keychainInput(["help\nquit"])).toThrow();
  expect(() => keychainInput([])).toThrow();
});
