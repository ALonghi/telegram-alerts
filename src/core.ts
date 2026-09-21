export class SafeError extends Error {}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SafeError("Unexpected data format.");
  }
  return Object.fromEntries(Object.entries(value));
}

interface AlertBody {
  id: string;
  text: string;
}

export type Alert = AlertBody & ({ model: string; reasoning: string } | { model?: never; reasoning?: never });

export interface ChannelConfig {
  bot: string;
  chatId: number;
  keychainService: string;
}

export function parseConfig(value: unknown): ChannelConfig {
  const data = record(value);
  if (typeof data.bot !== "string" || !/^[A-Za-z0-9_]{5,32}$/.test(data.bot)
    || typeof data.chatId !== "number" || !Number.isSafeInteger(data.chatId) || data.chatId >= 0
    || (data.keychainService !== undefined && (typeof data.keychainService !== "string" || !/^[A-Za-z0-9_.-]+$/.test(data.keychainService)))) {
    throw new SafeError("Invalid channel configuration. Run setup again.");
  }
  // Preserve credentials created by earlier versions.
  return { bot: data.bot, chatId: data.chatId, keychainService: typeof data.keychainService === "string" ? data.keychainService : "gfi-alerts.telegram" };
}

export function parseAlert(value: unknown): Alert {
  const data = record(value);
  const { id, model, reasoning, text } = data;
  if (typeof id !== "string" || !/^[A-Za-z0-9._:-]{1,160}$/.test(id) || typeof text !== "string" || !text.trim()) {
    throw new SafeError("Alert needs a safe id and non-empty text.");
  }
  if (/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/.test(text)) {
    throw new SafeError("Message appears to contain a bot token; refusing to send.");
  }
  let alert: Alert;
  if (model === undefined && reasoning === undefined) alert = { id, text: text.trim() };
  else {
    if (typeof model !== "string" || !/^[A-Za-z0-9 ._-]{1,80}$/.test(model)
      || typeof reasoning !== "string" || !["None", "Minimal", "Low", "Medium", "High", "XHigh", "Max", "Ultra", "Unknown"].includes(reasoning)) {
      throw new SafeError("Provide both actual model and reasoning level, or omit both.");
    }
    alert = { id, model, reasoning, text: text.trim() };
  }
  if (formatAlert(alert).length > 4096) throw new SafeError("Message exceeds Telegram's 4096-character limit.");
  return alert;
}

export function formatAlert(alert: Alert): string {
  return alert.model === undefined ? alert.text : `[${alert.model} · Reasoning: ${alert.reasoning}] 🔔\n\n${alert.text}`;
}

export function findChannel(updates: unknown): number {
  if (!Array.isArray(updates)) throw new SafeError("Unexpected Telegram updates.");
  const channels = new Set<number>();
  for (const update of updates) {
    const data = record(update);
    for (const key of ["my_chat_member", "channel_post", "edited_channel_post"]) {
      if (!data[key]) continue;
      const event = record(data[key]);
      if (!event.chat) continue;
      const chat = record(event.chat);
      if (chat.type === "channel" && typeof chat.id === "number" && Number.isSafeInteger(chat.id) && chat.id < 0) channels.add(chat.id);
    }
  }
  if (channels.size !== 1) throw new SafeError(channels.size ? "Several channels found. Pass the intended numeric channel ID to setup." : "Channel not found. Post a short message in your channel, then run setup again.");
  const id = channels.values().next().value;
  if (id === undefined) throw new SafeError("Channel not found.");
  return id;
}

export async function telegram(token: string, method: string, body: Record<string, unknown>, transport: (url: string, options: RequestInit) => Promise<Response> = fetch): Promise<unknown> {
  try {
    const response = await transport(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(20_000), redirect: "error",
    });
    const data = record(await response.json());
    if (!response.ok || data.ok !== true) {
      // Never print Telegram response bodies or request URLs: they can expose credentials.
      throw new SafeError(`Telegram ${method} failed (HTTP ${response.status}). Check bot permissions and connectivity.`);
    }
    return data.result;
  } catch (error) {
    if (error instanceof SafeError) throw error;
    throw new SafeError(`Telegram ${method} could not be confirmed. No automatic retry was attempted.`);
  }
}
