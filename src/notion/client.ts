import { APIResponseError, Client, LogLevel, isNotionClientError } from "@notionhq/client";

export interface NotionClientOptions {
  notionToken: string;
  notionApiVersion: string;
}

const RETRYABLE_STATUS_CODES = new Set([429, 409, 502, 503, 504]);
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 16000;

export function createNotionClient({
  notionToken,
  notionApiVersion,
}: NotionClientOptions): Client {
  return new Client({
    auth: notionToken,
    notionVersion: notionApiVersion,
    logLevel: LogLevel.WARN,
  });
}

export function formatNotionError(error: unknown): string {
  if (isNotionClientError(error)) {
    return `${error.code}: ${error.message}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isRetryableError(error: unknown): error is APIResponseError {
  return error instanceof APIResponseError && RETRYABLE_STATUS_CODES.has(error.status);
}

function getRetryDelayMs(error: APIResponseError, attempt: number): number {
  if (error.status === 429) {
    const headers = error.headers as Record<string, string | string[] | undefined>;
    const retryAfter = headers["retry-after"];
    if (typeof retryAfter === "string" && retryAfter !== "") {
      const seconds = parseFloat(retryAfter);
      if (!Number.isNaN(seconds) && seconds > 0) {
        return Math.ceil(seconds * 1000);
      }
    }
  }

  const exponential = INITIAL_BACKOFF_MS * 2 ** (attempt - 1);
  const jitter = Math.random() * 500;
  return Math.min(exponential + jitter, MAX_BACKOFF_MS);
}

export async function withRateLimitRetry<T>(
  operation: () => Promise<T>,
  maxAttempts = 5,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (!isRetryableError(error) || attempt === maxAttempts) {
        throw error;
      }

      const delayMs = getRetryDelayMs(error, attempt);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}