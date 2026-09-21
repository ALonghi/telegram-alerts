import { expect, test } from "bun:test";
import { sendAlert, parseAlert, formatAlert } from "./index.ts";
import { parseConfig } from "./core.ts";

test("plain notifications need no AI metadata", () => {
  expect(formatAlert(parseAlert({ id: "backup:done", text: "Backup completed." }))).toBe("Backup completed.");
  expect(() => parseAlert({ id: "backup:done", text: "Done", model: "Example" })).toThrow();
  expect(() => parseAlert({ id: "backup:done", text: "Done", reasoning: "High" })).toThrow();
});

test("library sends to its supplied destination and returns a confirmed receipt", async () => {
  const calls: unknown[] = [];
  const transport = async (_url: string, options: RequestInit): Promise<Response> => {
    calls.push(JSON.parse(String(options.body)));
    return Response.json({ ok: true, result: { message_id: 17 } });
  };
  expect(await sendAlert({ token: "123456789:" + "x".repeat(30), chatId: -100345, transport }, { id: "deploy:17", text: "Deployment complete" })).toBe(17);
  expect(calls).toEqual([{ chat_id: -100345, text: "Deployment complete", link_preview_options: { is_disabled: true } }]);
});

test("old configurations retain the original Keychain reference", () => {
  expect(parseConfig({ bot: "example_bot", chatId: -100345 }).keychainService).toBe("gfi-alerts.telegram");
  expect(parseConfig({ bot: "another_bot", chatId: -100789, keychainService: "telegram-alerts.telegram" }).bot).toBe("another_bot");
  expect(() => parseConfig({ bot: "bad\nname", chatId: -100345 })).toThrow();
});

test("library refuses uncertain delivery responses", async () => {
  await expect(sendAlert({ token: "123456789:" + "x".repeat(30), chatId: -100345, transport: async () => Response.json({ ok: true, result: {} }) }, { id: "deploy:18", text: "Done" })).rejects.toThrow("uncertain");
});
