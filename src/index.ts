import { SafeError, record, parseAlert, formatAlert, telegram } from "./core.ts";
import type { Alert } from "./core.ts";

export { parseAlert, formatAlert, SafeError } from "./core.ts";
export type { Alert } from "./core.ts";

export interface SenderOptions {
  token: string;
  chatId: number;
  transport?: (url: string, options: RequestInit) => Promise<Response>;
}

/** Send once; callers own scheduling, credentials and deduplication. */
export async function sendAlert(options: SenderOptions, alert: Alert): Promise<number> {
  if (!/^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(options.token)
    || !Number.isSafeInteger(options.chatId) || options.chatId === 0) {
    throw new SafeError("A valid bot token and numeric chat ID are required.");
  }
  const result = record(await telegram(options.token, "sendMessage", {
    chat_id: options.chatId,
    text: formatAlert(parseAlert(alert)),
    link_preview_options: { is_disabled: true },
  }, options.transport));
  if (typeof result.message_id !== "number" || !Number.isSafeInteger(result.message_id)) {
    throw new SafeError("Delivery response uncertain. Check the destination before retrying.");
  }
  return result.message_id;
}
