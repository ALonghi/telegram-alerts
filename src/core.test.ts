import { test } from "bun:test";
import assert from "node:assert/strict";
import { findChannel, parseAlert, formatAlert, telegram } from "./core.ts";

test("discovers the unique channel from membership or channel posts, ignoring groups", () => {
  assert.equal(findChannel([{ my_chat_member: { chat: { id: -100123, type: "channel", title: "Operations" } } }, { channel_post: { chat: { id: -100123, type: "channel", title: "Operations" } } }, { channel_post: { chat: { id: -9, type: "group", title: "Operations" } } }]), -100123);
  assert.throws(() => findChannel([]));
  assert.throws(() => findChannel([-1, -2].map(id => ({ channel_post: { chat: { id, type: "channel", title: "Operations" } } }))));
});

test("validates input and preserves the actual model label", () => {
  const alert = { id: "backup-2026-09-v1", model: "GPT-5.6 Luna", reasoning: "High", text: "PREVIEW — sample notification" };
  assert.match(formatAlert(parseAlert(alert)), /^\[GPT-5.6 Luna · Reasoning: High\]/);
  assert.throws(() => parseAlert({ ...alert, text: "" }));
  assert.throws(() => parseAlert({ ...alert, text: "x".repeat(4096) }));
  assert.throws(() => parseAlert({ ...alert, text: "123456789:" + "a".repeat(30) }));
  assert.throws(() => parseAlert({ ...alert, model: "Luna\nspoof" }));
});

test("transport errors cannot expose token-bearing URLs and are not retried", async () => {
  let calls = 0;
  const fake = async (): Promise<Response> => { calls++; throw new Error("https://api.telegram.org/botSECRET/sendMessage"); };
  await assert.rejects(telegram("SECRET", "sendMessage", {}, fake), error => error instanceof Error && !error.message.includes("SECRET"));
  assert.equal(calls, 1);
});

test("Telegram error bodies are suppressed", async () => {
  const fake = async (): Promise<Response> => new Response(JSON.stringify({ ok: false, description: "SECRET" }), { status: 403 });
  await assert.rejects(telegram("SECRET", "sendMessage", {}, fake), /HTTP 403/);
});
