import { existsSync } from "node:fs";
import type { ChannelConfig } from "./core.ts";
import { sendAlert } from "./index.ts";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { keychainInput } from "./keychain-input.ts";
import { parseConfig, SafeError, record, parseAlert, formatAlert, findChannel, telegram } from "./core.ts";

const legacyDirectory = join(homedir(), "Library", "Application Support", "gfi-alerts");
const directory = process.env.TELEGRAM_ALERTS_DATA_DIR || (existsSync(join(legacyDirectory, "config.json")) ? legacyDirectory : join(homedir(), "Library", "Application Support", "telegram-alerts"));
const configPath = join(directory, "config.json");


async function security(args: string[], input?: string): Promise<string> {
  if (process.platform !== "darwin") throw new SafeError("This sender requires macOS Keychain.");
  try {
    const child = Bun.spawn(["/usr/bin/security", ...args], {
      stdin: input === undefined ? "ignore" : new TextEncoder().encode(input),
      stdout: "pipe", stderr: "ignore",
    });
    const [output, code] = await Promise.all([
      new Response(child.stdout).text(), child.exited,
    ]);
    if (code !== 0) throw new SafeError("Keychain access failed. Run setup in Terminal and allow access if macOS asks.");
    return output.trim();
  } catch (error) {
    if (error instanceof SafeError) throw error;
    throw new SafeError("Unable to access macOS Keychain.");
  }
}

function validateToken(token: string): string {
  if (!/^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(token)) throw new SafeError("Invalid bot token format.");
  return token;
}

async function tokenFromKeychain(profile: ChannelConfig): Promise<string> {
  return validateToken(await security(["find-generic-password", "-s", profile.keychainService, "-a", profile.bot, "-w"]));
}

async function hiddenToken(): Promise<string> {
  if (!process.stdin.isTTY) throw new SafeError("Run setup in an interactive Terminal. Never pass a token as an argument.");
  process.stdout.write("Paste the BotFather token (hidden), then press Enter: ");
  const wasRaw = process.stdin.isRaw;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return await new Promise((resolve, reject) => {
    let value = "";
    function finish(error?: SafeError): void {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(wasRaw);
      process.stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error); else resolve(value.trim());
    }
    function onData(chunk: Buffer): void {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003" || character === "\u0004") { finish(new SafeError("Setup cancelled.")); return; }
        if (character === "\r" || character === "\n") { finish(); return; }
        if (character === "\u007f") value = value.slice(0, -1);
        else if (/^[0-9A-Za-z:_-]$/.test(character)) value += character;
        if (value.length > 256) { finish(new SafeError("Token too long.")); return; }
      }
    }
    process.stdin.on("data", onData);
  });
}

async function saveJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  await rename(temporary, path);
}

async function config(): Promise<ChannelConfig> {
  let data: Record<string, unknown>;
  try { data = record(JSON.parse(await readFile(configPath, "utf8"))); }
  catch { throw new SafeError("Setup is incomplete. Run bun run setup in the project directory."); }
  return parseConfig(data);
}

async function verify(token: string, profile: ChannelConfig): Promise<string> {
  const { chatId } = profile;
  const bot = record(await telegram(token, "getMe", {}));
  if (bot.username !== profile.bot || bot.is_bot !== true || typeof bot.id !== "number") throw new SafeError("The token does not belong to the configured bot.");
  const chat = record(await telegram(token, "getChat", { chat_id: chatId }));
  if (chat.id !== chatId || chat.type !== "channel") throw new SafeError("Configured destination must be a Telegram channel.");
  const member = record(await telegram(token, "getChatMember", { chat_id: chatId, user_id: bot.id }));
  if (member.status !== "administrator" || member.can_post_messages !== true) throw new SafeError("Add the bot as a channel administrator with Post Messages enabled.");
  return typeof chat.title === "string" ? chat.title : String(chatId);
}

async function setup(): Promise<void> {
  console.log("1/3 Store the bot token in macOS Keychain. It will not be saved in this project.");
  const token = validateToken(await hiddenToken());
  const bot = record(await telegram(token, "getMe", {}));
  if (typeof bot.username !== "string" || !/^[A-Za-z0-9_]{5,32}$/.test(bot.username) || bot.is_bot !== true) throw new SafeError("Expected a valid Telegram bot.");
  const service = "telegram-alerts.telegram";
  const account = bot.username;
  const keychainProfile = { bot: account, chatId: -1, keychainService: service };
  // Token alphabet is validated above. Supply it over stdin, never in process arguments.
  await security(["-i"], keychainInput(["add-generic-password", "-U", "-s", service, "-a", account, "-w", token]));
  if (await tokenFromKeychain(keychainProfile) !== token) throw new SafeError("Keychain write could not be verified.");
  console.log("2/3 Find your channel and verify posting permissions.");
  const explicitId = process.argv[3];
  if (explicitId && !/^-\d+$/.test(explicitId)) throw new SafeError("Setup accepts only a numeric channel ID.");
  const chatId = explicitId ? Number(explicitId) : findChannel(await telegram(token, "getUpdates", { limit: 100, timeout: 0, allowed_updates: ["my_chat_member", "channel_post"] }));
  if (!Number.isSafeInteger(chatId) || chatId >= 0) throw new SafeError("Invalid channel ID.");
  const profile = { bot: account, chatId, keychainService: service };
  const title = await verify(token, profile);
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await prompt.question(`Channel verified: ${title} (${chatId}). Bind this destination and send a setup test? [y/N] `);
  prompt.close();
  if (answer.trim().toLowerCase() !== "y") throw new SafeError("Channel binding cancelled; token remains in Keychain.");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await saveJson(configPath, profile);
  console.log("3/3 Send a connection test.");
  const result = record(await telegram(token, "sendMessage", { chat_id: chatId, text: "[Setup test · No model used] 🔔\n\nTelegram delivery is connected. This is a connection test.", link_preview_options: { is_disabled: true } }));
  console.log(`Setup complete. Telegram confirmed message ${String(result.message_id)}. Run bun run status to check again.`);
}

async function readAlertInput(): Promise<unknown> {
  if (process.argv[3]) return JSON.parse(await readFile(process.argv[3], "utf8"));
  let input = "";
  for await (const chunk of process.stdin) {
    input += String(chunk);
    if (input.length > 32_768) throw new SafeError("Alert input too large.");
  }
  return JSON.parse(input);
}

async function send(): Promise<void> {
  const alert = parseAlert(await readAlertInput());
  const profile = await config();
  const { chatId } = profile;
  const token = await tokenFromKeychain(profile);
  await verify(token, profile);
  const ledger = join(directory, "deliveries");
  await mkdir(ledger, { recursive: true, mode: 0o700 });
  const marker = join(ledger, createHash("sha256").update(alert.id).digest("hex") + ".json");
  try { await writeFile(marker, JSON.stringify({ id: alert.id, state: "pending", at: new Date().toISOString() }), { flag: "wx", mode: 0o600 }); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      const prior = record(JSON.parse(await readFile(marker, "utf8")));
      if (prior.state === "sent") { console.log("Already delivered; duplicate suppressed."); return; }
      throw new SafeError("Previous delivery is uncertain. Inspect the channel before retrying; pending marker retained to avoid duplicate alerts.");
    }
    throw error;
  }
  const messageId = await sendAlert({ token, chatId }, alert);
  await saveJson(marker, { id: alert.id, state: "sent", messageId, at: new Date().toISOString() });
  console.log(`Delivered to channel ${chatId}. Message ID: ${messageId}`);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "setup") await setup();
  else if (command === "status") {
    const profile = await config();
    const title = await verify(await tokenFromKeychain(profile), profile);
    console.log(`Ready: @${profile.bot} can post to ${title} (${profile.chatId}).`);
  } else if (command === "preview") console.log(formatAlert(parseAlert(await readAlertInput())));
  else if (command === "send") await send();
  else console.log("Usage: bun src/cli.ts setup [numeric-channel-id] | status | preview [json-file] | send [json-file]\nFor preview/send, omit json-file to read JSON from stdin.");
}

await main().catch((error: unknown) => {
  console.error(error instanceof SafeError ? error.message : "Operation failed. Check input, file permissions and connectivity. Sensitive error details were suppressed.");
  process.exitCode = 1;
});
