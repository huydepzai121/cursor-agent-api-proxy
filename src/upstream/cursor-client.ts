/**
 * Cursor API HTTP Client.
 *
 * Replaces CursorSubprocess — makes direct HTTP calls to api2.cursor.sh
 * instead of spawning a local CLI process. This allows the proxy to work
 * from any machine, not just the one with Cursor CLI installed.
 *
 * Architecture inspired by kiro.rs KiroProvider.
 */

import { v4 as uuidv4, v5 as uuidv5 } from "uuid";
import {
  encodeCursorRequest,
  decodeCursorChunk,
  type CursorMessage,
} from "./proto.js";
import {
  generateCursorChecksum,
  generateHashed64Hex,
} from "./checksum.js";

const CURSOR_API_BASE = "https://api2.cursor.sh";
const DEFAULT_CLIENT_VERSION = "2.6.21";
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;

export interface CursorClientConfig {
  /** Cursor cookie / API key (Bearer token) */
  apiKey: string;
  /** Cursor client version header */
  clientVersion?: string;
  /** Request timeout in ms */
  timeout?: number;
}

export interface ChatRequest {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  model: string;
  stream?: boolean;
}

export interface ChatStreamEvent {
  type: "content_delta" | "thinking_delta" | "done" | "error";
  text?: string;
  error?: string;
}

export class CursorApiClient {
  private apiKey: string;
  private clientVersion: string;
  private timeout: number;

  constructor(config: CursorClientConfig) {
    this.apiKey = config.apiKey;
    this.clientVersion = config.clientVersion ?? DEFAULT_CLIENT_VERSION;
    this.timeout = config.timeout ?? 300_000;
  }

  /** Extract the JWT portion from a Cursor cookie if needed */
  private extractToken(key: string): string {
    let token = key.trim();
    if (token.includes("%3A%3A")) {
      token = token.split("%3A%3A")[1];
    } else if (token.includes("::")) {
      token = token.split("::")[1];
    }
    return token;
  }

  private buildHeaders(token: string): Record<string, string> {
    const checksum = generateCursorChecksum(token);
    const sessionId = uuidv5(token, uuidv5.DNS);
    const clientKey = generateHashed64Hex(token);

    return {
      authorization: `Bearer ${token}`,
      "connect-accept-encoding": "gzip",
      "connect-content-encoding": "gzip",
      "connect-protocol-version": "1",
      "content-type": "application/connect+proto",
      "user-agent": "connect-es/1.6.1",
      "x-amzn-trace-id": `Root=${uuidv4()}`,
      "x-client-key": clientKey,
      "x-cursor-checksum": checksum,
      "x-cursor-client-version": this.clientVersion,
      "x-cursor-config-version": uuidv4(),
      "x-cursor-timezone": Intl.DateTimeFormat().resolvedOptions().timeZone,
      "x-ghost-mode": "true",
      "x-request-id": uuidv4(),
      "x-session-id": sessionId,
      Host: "api2.cursor.sh",
    };
  }

  /**
   * Convert OpenAI-style messages to Cursor protobuf format.
   */
  private toCursorMessages(
    messages: ChatRequest["messages"]
  ): { cursorMessages: CursorMessage[]; instruction: string } {
    const instruction = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n");

    const cursorMessages: CursorMessage[] = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        content: m.content,
        role: (m.role === "user" ? 1 : 2) as 1 | 2,
        messageId: uuidv4(),
        ...(m.role === "user" ? { chatModeEnum: 1 } : {}),
      }));

    return { cursorMessages, instruction };
  }

  /**
   * Send a streaming chat request to Cursor API.
   * Returns an async generator of ChatStreamEvents.
   */
  async *chatStream(request: ChatRequest): AsyncGenerator<ChatStreamEvent> {
    const token = this.extractToken(this.apiKey);
    const headers = this.buildHeaders(token);
    const { cursorMessages, instruction } = this.toCursorMessages(
      request.messages
    );

    const body = encodeCursorRequest({
      messages: cursorMessages,
      model: request.model,
      instruction,
      conversationId: uuidv4(),
    });

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(
          `${CURSOR_API_BASE}/aiserver.v1.ChatService/StreamUnifiedChatWithTools`,
          {
            method: "POST",
            headers,
            body,
            signal: controller.signal,
          }
        );

        clearTimeout(timer);

        if (!response.ok) {
          const errText = await response.text().catch(() => "");
          // 400 = bad request, don't retry
          if (response.status === 400) {
            yield { type: "error", error: `Cursor API ${response.status}: ${errText}` };
            return;
          }
          // 401/403 = auth error, don't retry
          if (response.status === 401 || response.status === 403) {
            yield { type: "error", error: `Auth error ${response.status}: ${errText}` };
            return;
          }
          // Transient errors: retry
          lastError = new Error(`Cursor API ${response.status}: ${errText}`);
          if (attempt + 1 < MAX_RETRIES) {
            await sleep(RETRY_BASE_MS * Math.pow(2, attempt));
            continue;
          }
          yield { type: "error", error: lastError.message };
          return;
        }

        if (!response.body) {
          yield { type: "error", error: "No response body" };
          return;
        }

        const reader = response.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = Buffer.from(value);
            const decoded = decodeCursorChunk(chunk);

            if (decoded.thinking) {
              yield { type: "thinking_delta", text: decoded.thinking };
            }
            if (decoded.text) {
              yield { type: "content_delta", text: decoded.text };
            }
          }
        } finally {
          reader.releaseLock();
        }

        yield { type: "done" };
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (lastError.name === "AbortError") {
          yield { type: "error", error: "Request timed out" };
          return;
        }
        if (attempt + 1 < MAX_RETRIES) {
          console.error(
            `[cursor-api] Attempt ${attempt + 1} failed:`,
            lastError.message
          );
          await sleep(RETRY_BASE_MS * Math.pow(2, attempt));
          continue;
        }
      }
    }

    yield {
      type: "error",
      error: lastError?.message ?? "Max retries exceeded",
    };
  }

  /**
   * Send a non-streaming chat request. Collects all chunks and returns full text.
   */
  async chat(request: ChatRequest): Promise<{ text: string; model: string }> {
    const parts: string[] = [];
    let error: string | undefined;

    for await (const event of this.chatStream(request)) {
      if (event.type === "content_delta" && event.text) {
        parts.push(event.text);
      } else if (event.type === "error") {
        error = event.error;
      }
    }

    if (error && parts.length === 0) {
      throw new Error(error);
    }

    return { text: parts.join(""), model: request.model };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

