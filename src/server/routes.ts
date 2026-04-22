/**
 * API route handlers — OpenAI-compatible endpoints backed by Cursor HTTP API.
 *
 * Instead of spawning a local CLI subprocess, requests are forwarded
 * directly to api2.cursor.sh via HTTP. This allows the proxy to work
 * from any machine, not just the one with Cursor CLI installed.
 */

import type { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { CursorApiClient, type ChatStreamEvent } from "../upstream/cursor-client.js";
import { openaiToCli, extractModel } from "../adapter/openai-to-cli.js";
import {
  createStreamChunk,
  createDoneChunk,
  createChatResponse,
} from "../adapter/cli-to-openai.js";
import type { OpenAIChatRequest } from "../types/openai.js";
import {
  createClaudeResponse,
  createClaudeStreamMessageStart,
  createClaudeStreamContentBlockStart,
  createClaudeStreamContentBlockDelta,
  createClaudeStreamContentBlockStop,
  createClaudeStreamMessageDelta,
  createClaudeStreamMessageStop,
} from "../adapter/cli-to-claude.js";
import type { ClaudeMessagesRequest } from "../types/claude.js";

const KNOWN_MODELS = [
  "default",
  "premium",
  "claude-4-sonnet",
  "claude-4-sonnet-1m",
  "claude-4-sonnet-thinking",
  "claude-4-sonnet-1m-thinking",
  "claude-4.5-haiku",
  "claude-4.5-haiku-thinking",
  "claude-4.5-opus-high",
  "claude-4.5-opus-high-thinking",
  "claude-4.5-sonnet",
  "claude-4.5-sonnet-thinking",
  "claude-4.6-opus-high",
  "claude-4.6-opus-high-thinking",
  "claude-4.6-opus-high-thinking-fast",
  "claude-4.6-opus-max",
  "claude-4.6-opus-max-thinking",
  "claude-4.6-opus-max-thinking-fast",
  "claude-4.6-sonnet-medium",
  "claude-4.6-sonnet-medium-thinking",
  "claude-opus-4-7-low",
  "claude-opus-4-7-medium",
  "claude-opus-4-7-high",
  "claude-opus-4-7-xhigh",
  "claude-opus-4-7-max",
  "claude-opus-4-7-thinking-low",
  "claude-opus-4-7-thinking-medium",
  "claude-opus-4-7-thinking-high",
  "claude-opus-4-7-thinking-xhigh",
  "claude-opus-4-7-thinking-max",
  "composer-1.5",
  "composer-2",
  "composer-2-fast",
  "gemini-2.5-flash",
  "gemini-3-flash",
  "gemini-3.1-pro",
  "gpt-5-mini",
  "gpt-5.1",
  "gpt-5.1-low",
  "gpt-5.1-high",
  "gpt-5.1-codex-max-low",
  "gpt-5.1-codex-max-low-fast",
  "gpt-5.1-codex-max-medium",
  "gpt-5.1-codex-max-medium-fast",
  "gpt-5.1-codex-max-high",
  "gpt-5.1-codex-max-high-fast",
  "gpt-5.1-codex-max-xhigh",
  "gpt-5.1-codex-max-xhigh-fast",
  "gpt-5.1-codex-mini",
  "gpt-5.1-codex-mini-low",
  "gpt-5.1-codex-mini-high",
  "gpt-5.2",
  "gpt-5.2-low",
  "gpt-5.2-low-fast",
  "gpt-5.2-fast",
  "gpt-5.2-high",
  "gpt-5.2-high-fast",
  "gpt-5.2-xhigh",
  "gpt-5.2-xhigh-fast",
  "gpt-5.2-codex",
  "gpt-5.2-codex-fast",
  "gpt-5.2-codex-low",
  "gpt-5.2-codex-low-fast",
  "gpt-5.2-codex-high",
  "gpt-5.2-codex-high-fast",
  "gpt-5.2-codex-xhigh",
  "gpt-5.2-codex-xhigh-fast",
  "gpt-5.3-codex",
  "gpt-5.3-codex-fast",
  "gpt-5.3-codex-low",
  "gpt-5.3-codex-low-fast",
  "gpt-5.3-codex-high",
  "gpt-5.3-codex-high-fast",
  "gpt-5.3-codex-xhigh",
  "gpt-5.3-codex-xhigh-fast",
  "gpt-5.3-codex-spark-preview",
  "gpt-5.3-codex-spark-preview-low",
  "gpt-5.3-codex-spark-preview-high",
  "gpt-5.3-codex-spark-preview-xhigh",
  "gpt-5.4-low",
  "gpt-5.4-medium",
  "gpt-5.4-medium-fast",
  "gpt-5.4-high",
  "gpt-5.4-high-fast",
  "gpt-5.4-xhigh",
  "gpt-5.4-xhigh-fast",
  "gpt-5.4-mini-none",
  "gpt-5.4-mini-low",
  "gpt-5.4-mini-medium",
  "gpt-5.4-mini-high",
  "gpt-5.4-mini-xhigh",
  "gpt-5.4-nano-none",
  "gpt-5.4-nano-low",
  "gpt-5.4-nano-medium",
  "gpt-5.4-nano-high",
  "gpt-5.4-nano-xhigh",
  "grok-4-20",
  "grok-4-20-thinking",
  "kimi-k2.5",
];

// Shared client instance — initialized by initCursorClient()
let cursorClient: CursorApiClient | null = null;

export function initCursorClient(client: CursorApiClient): void {
  cursorClient = client;
}

function getClient(): CursorApiClient {
  if (!cursorClient) {
    throw new Error("CursorApiClient not initialized. Set CURSOR_API_KEY.");
  }
  return cursorClient;
}

// ─── OpenAI-compatible endpoints ───

export async function handleChatCompletions(
  req: Request,
  res: Response
): Promise<void> {
  const requestId = uuidv4().replace(/-/g, "").slice(0, 24);
  const body = req.body as OpenAIChatRequest;
  const stream = body.stream === true;

  try {
    if (!body.messages?.length) {
      res.status(400).json({
        error: {
          message: "messages is required and must be a non-empty array",
          type: "invalid_request_error",
          code: "invalid_messages",
        },
      });
      return;
    }

    const model = extractModel(body.model || "default");
    console.error(`[chat] id=${requestId} model=${body.model} -> ${model} stream=${stream}`);

    const client = getClient();
    const chatMessages = body.messages.map((m) => ({
      role: m.role as "system" | "user" | "assistant",
      content: typeof m.content === "string"
        ? m.content
        : m.content.filter((p) => p.type === "text").map((p) => p.text ?? "").join(""),
    }));

    if (stream) {
      await handleStreamingResponse(res, client, chatMessages, model, requestId);
    } else {
      await handleNonStreamingResponse(res, client, chatMessages, model, requestId);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[chat] Error:", message);
    if (!res.headersSent) {
      res.status(500).json({ error: { message, type: "server_error", code: null } });
    }
  }
}

type SimpleMessage = { role: "system" | "user" | "assistant"; content: string };

async function handleStreamingResponse(
  res: Response,
  client: CursorApiClient,
  messages: SimpleMessage[],
  model: string,
  requestId: string
): Promise<void> {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Request-Id", requestId);
  res.flushHeaders();
  res.write(":ok\n\n");

  let isFirst = true;

  for await (const event of client.chatStream({ messages, model, stream: true })) {
    if (res.writableEnded) break;

    if (event.type === "content_delta" && event.text) {
      const chunk = createStreamChunk(requestId, model, event.text, isFirst);
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      isFirst = false;
    } else if (event.type === "done") {
      const done = createDoneChunk(requestId, model);
      res.write(`data: ${JSON.stringify(done)}\n\n`);
      res.write("data: [DONE]\n\n");
    } else if (event.type === "error") {
      res.write(`data: ${JSON.stringify({
        error: { message: event.error, type: "server_error", code: null },
      })}\n\n`);
      res.write("data: [DONE]\n\n");
    }
  }

  if (!res.writableEnded) res.end();
}

async function handleNonStreamingResponse(
  res: Response,
  client: CursorApiClient,
  messages: SimpleMessage[],
  model: string,
  requestId: string
): Promise<void> {
  try {
    const result = await client.chat({ messages, model });
    res.json(createChatResponse(requestId, result.model, result.text));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ error: { message, type: "server_error", code: null } });
  }
}

// ─── Claude Messages API endpoint ───

export async function handleMessages(
  req: Request,
  res: Response
): Promise<void> {
  const requestId = uuidv4().replace(/-/g, "").slice(0, 24);
  const body = req.body as ClaudeMessagesRequest;
  const stream = body.stream === true;

  try {
    if (!body.messages?.length) {
      res.status(400).json({
        type: "error",
        error: { type: "invalid_request_error", message: "messages is required and must be a non-empty array" },
      });
      return;
    }

    const model = extractModel(body.model || "default");
    console.error(`[messages] id=${requestId} model=${body.model} -> ${model} stream=${stream}`);

    const client = getClient();

    // Convert Claude messages to simple format
    const chatMessages: SimpleMessage[] = [];
    if (body.system) {
      const sysText = typeof body.system === "string"
        ? body.system
        : body.system.filter((b) => b.type === "text").map((b) => b.text).join("");
      if (sysText) chatMessages.push({ role: "system", content: sysText });
    }
    for (const msg of body.messages) {
      const text = typeof msg.content === "string"
        ? msg.content
        : msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
      if (text) chatMessages.push({ role: msg.role, content: text });
    }

    if (stream) {
      await handleClaudeStreamingResponse(res, client, chatMessages, model, requestId);
    } else {
      await handleClaudeNonStreamingResponse(res, client, chatMessages, model, requestId);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[messages] Error:", message);
    if (!res.headersSent) {
      res.status(500).json({ type: "error", error: { type: "server_error", message } });
    }
  }
}

async function handleClaudeStreamingResponse(
  res: Response,
  client: CursorApiClient,
  messages: SimpleMessage[],
  model: string,
  requestId: string
): Promise<void> {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Request-Id", requestId);
  res.flushHeaders();

  function sendEvent(type: string, data: unknown): void {
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  sendEvent("message_start", createClaudeStreamMessageStart(requestId, model));
  sendEvent("content_block_start", createClaudeStreamContentBlockStart());
  res.write("event: ping\ndata: {}\n\n");

  let hasContent = false;

  for await (const event of client.chatStream({ messages, model, stream: true })) {
    if (res.writableEnded) break;

    if (event.type === "content_delta" && event.text) {
      sendEvent("content_block_delta", createClaudeStreamContentBlockDelta(event.text));
      hasContent = true;
    } else if (event.type === "done") {
      sendEvent("content_block_stop", createClaudeStreamContentBlockStop());
      sendEvent("message_delta", createClaudeStreamMessageDelta(0));
      sendEvent("message_stop", createClaudeStreamMessageStop());
    } else if (event.type === "error") {
      sendEvent("error", { type: "server_error", message: event.error });
      if (!hasContent) {
        sendEvent("content_block_stop", createClaudeStreamContentBlockStop());
        sendEvent("message_delta", createClaudeStreamMessageDelta(0));
        sendEvent("message_stop", createClaudeStreamMessageStop());
      }
    }
  }

  if (!res.writableEnded) res.end();
}

async function handleClaudeNonStreamingResponse(
  res: Response,
  client: CursorApiClient,
  messages: SimpleMessage[],
  model: string,
  requestId: string
): Promise<void> {
  try {
    const result = await client.chat({ messages, model });
    res.json(createClaudeResponse(requestId, result.model, result.text));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({
      type: "error",
      error: { type: "server_error", message },
    });
  }
}

// ─── Models & Health ───

export function handleModels(_req: Request, res: Response): void {
  const now = Math.floor(Date.now() / 1000);
  res.json({
    object: "list",
    data: KNOWN_MODELS.map((id) => ({
      id,
      object: "model" as const,
      owned_by: "cursor",
      created: now,
    })),
  });
}

export function handleHealth(_req: Request, res: Response): void {
  res.json({
    status: "ok",
    provider: "cursor-agent-api-proxy",
    mode: cursorClient ? "http-api" : "not-configured",
    timestamp: new Date().toISOString(),
  });
}
