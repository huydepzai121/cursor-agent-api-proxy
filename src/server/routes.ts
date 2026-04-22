/**
 * API route handlers — OpenAI-compatible endpoints backed by Cursor CLI.
 */

import type { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { CursorSubprocess } from "../subprocess/manager.js";
import type { ContentDeltaEvent, ResultEvent } from "../subprocess/manager.js";
import { openaiToCli } from "../adapter/openai-to-cli.js";
import {
  createStreamChunk,
  createDoneChunk,
  createChatResponse,
} from "../adapter/cli-to-openai.js";
import type { OpenAIChatRequest } from "../types/openai.js";
import { claudeToCli } from "../adapter/claude-to-cli.js";
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
  "auto",
  "composer-2-fast",
  "composer-2",
  "composer-1.5",
  "gpt-5.3-codex-low",
  "gpt-5.3-codex-low-fast",
  "gpt-5.3-codex",
  "gpt-5.3-codex-fast",
  "gpt-5.3-codex-high",
  "gpt-5.3-codex-high-fast",
  "gpt-5.3-codex-xhigh",
  "gpt-5.3-codex-xhigh-fast",
  "gpt-5.3-codex-spark-preview-low",
  "gpt-5.3-codex-spark-preview",
  "gpt-5.3-codex-spark-preview-high",
  "gpt-5.3-codex-spark-preview-xhigh",
  "gpt-5.2",
  "gpt-5.2-low",
  "gpt-5.2-low-fast",
  "gpt-5.2-fast",
  "gpt-5.2-high",
  "gpt-5.2-high-fast",
  "gpt-5.2-xhigh",
  "gpt-5.2-xhigh-fast",
  "gpt-5.2-codex-low",
  "gpt-5.2-codex-low-fast",
  "gpt-5.2-codex",
  "gpt-5.2-codex-fast",
  "gpt-5.2-codex-high",
  "gpt-5.2-codex-high-fast",
  "gpt-5.2-codex-xhigh",
  "gpt-5.2-codex-xhigh-fast",
  "gpt-5.1-low",
  "gpt-5.1",
  "gpt-5.1-high",
  "gpt-5.1-codex-max-low",
  "gpt-5.1-codex-max-low-fast",
  "gpt-5.1-codex-max-medium",
  "gpt-5.1-codex-max-medium-fast",
  "gpt-5.1-codex-max-high",
  "gpt-5.1-codex-max-high-fast",
  "gpt-5.1-codex-max-xhigh",
  "gpt-5.1-codex-max-xhigh-fast",
  "gpt-5.1-codex-mini-low",
  "gpt-5.1-codex-mini",
  "gpt-5.1-codex-mini-high",
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
  "gpt-5-mini",
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
  "claude-4.6-opus-high",
  "claude-4.6-opus-max",
  "claude-4.6-opus-high-thinking",
  "claude-4.6-opus-max-thinking",
  "claude-4.6-sonnet-medium",
  "claude-4.6-sonnet-medium-thinking",
  "claude-4.5-opus-high",
  "claude-4.5-opus-high-thinking",
  "claude-4.5-sonnet",
  "claude-4.5-sonnet-thinking",
  "claude-4-sonnet",
  "claude-4-sonnet-1m",
  "claude-4-sonnet-thinking",
  "claude-4-sonnet-1m-thinking",
  "gemini-3.1-pro",
  "gemini-3-flash",
  "grok-4-20",
  "grok-4-20-thinking",
  "kimi-k2.5",
];

export async function handleChatCompletions(
  req: Request,
  res: Response
): Promise<void> {
  const requestId = uuidv4().replace(/-/g, "").slice(0, 24);
  const body = req.body as OpenAIChatRequest;
  const stream = body.stream === true;

  try {
    if (
      !body.messages ||
      !Array.isArray(body.messages) ||
      body.messages.length === 0
    ) {
      res.status(400).json({
        error: {
          message: "messages is required and must be a non-empty array",
          type: "invalid_request_error",
          code: "invalid_messages",
        },
      });
      return;
    }

    const { prompt, model } = openaiToCli(body);
    const workspace = (body as any).workspace || undefined;
    console.error(
      `[chat] id=${requestId} model=${body.model} -> cli_model=${model} stream=${stream}`
    );

    const subprocess = new CursorSubprocess();

    if (stream) {
      await handleStreamingResponse(res, subprocess, prompt, model, workspace, requestId);
    } else {
      await handleNonStreamingResponse(res, subprocess, prompt, model, workspace, requestId);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[chat] Error:", message);
    if (!res.headersSent) {
      res
        .status(500)
        .json({ error: { message, type: "server_error", code: null } });
    }
  }
}

async function handleStreamingResponse(
  res: Response,
  subprocess: CursorSubprocess,
  prompt: string,
  model: string,
  workspace: string | undefined,
  requestId: string
): Promise<void> {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Request-Id", requestId);
  res.flushHeaders();

  res.write(":ok\n\n");

  return new Promise<void>((resolve) => {
    let isFirst = true;
    let lastModel = model;
    let isComplete = false;

    res.on("close", () => {
      if (!isComplete) subprocess.kill();
      resolve();
    });

    subprocess.on("content_delta", (delta: ContentDeltaEvent) => {
      if (delta.text && !res.writableEnded) {
        const chunk = createStreamChunk(requestId, lastModel, delta.text, isFirst);
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        isFirst = false;
      }
    });

    subprocess.on("result", (result: ResultEvent) => {
      isComplete = true;
      if (result.model) lastModel = result.model;
      if (!res.writableEnded) {
        const done = createDoneChunk(requestId, lastModel);
        res.write(`data: ${JSON.stringify(done)}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      }
      resolve();
    });

    subprocess.on("error", (error: Error) => {
      console.error("[stream] Error:", error.message);
      if (!res.writableEnded) {
        res.write(
          `data: ${JSON.stringify({
            error: { message: error.message, type: "server_error", code: null },
          })}\n\n`
        );
        res.end();
      }
      resolve();
    });

    subprocess.on("close", (code: number | null) => {
      if (!res.writableEnded) {
        if (code !== 0 && !isComplete) {
          res.write(
            `data: ${JSON.stringify({
              error: {
                message: `Process exited with code ${code}`,
                type: "server_error",
                code: null,
              },
            })}\n\n`
          );
        }
        res.write("data: [DONE]\n\n");
        res.end();
      }
      resolve();
    });

    subprocess.start(prompt, { model, workspace }).catch((err) => {
      console.error("[stream] Start error:", err);
      if (!res.writableEnded) {
        res.write(
          `data: ${JSON.stringify({
            error: {
              message: err instanceof Error ? err.message : String(err),
              type: "server_error",
              code: null,
            },
          })}\n\n`
        );
        res.end();
      }
      resolve();
    });
  });
}

async function handleNonStreamingResponse(
  res: Response,
  subprocess: CursorSubprocess,
  prompt: string,
  model: string,
  workspace: string | undefined,
  requestId: string
): Promise<void> {
  return new Promise<void>((resolve) => {
    let finalResult: ResultEvent | null = null;

    subprocess.on("result", (result: ResultEvent) => {
      finalResult = result;
    });

    subprocess.on("error", (error: Error) => {
      console.error("[non-stream] Error:", error.message);
      if (!res.headersSent) {
        res.status(500).json({
          error: { message: error.message, type: "server_error", code: null },
        });
      }
      resolve();
    });

    subprocess.on("close", () => {
      if (finalResult) {
        const response = createChatResponse(
          requestId,
          finalResult.model || model,
          finalResult.text
        );
        res.json(response);
      } else if (!res.headersSent) {
        res.status(500).json({
          error: {
            message: "CLI exited without producing a result",
            type: "server_error",
            code: null,
          },
        });
      }
      resolve();
    });

    subprocess.start(prompt, { model, workspace }).catch((error) => {
      if (!res.headersSent) {
        res.status(500).json({
          error: {
            message: error instanceof Error ? error.message : String(error),
            type: "server_error",
            code: null,
          },
        });
      }
      resolve();
    });
  });
}

export async function handleMessages(
  req: Request,
  res: Response
): Promise<void> {
  const requestId = uuidv4().replace(/-/g, "").slice(0, 24);
  const body = req.body as ClaudeMessagesRequest;
  const stream = body.stream === true;

  try {
    if (
      !body.messages ||
      !Array.isArray(body.messages) ||
      body.messages.length === 0
    ) {
      res.status(400).json({
        type: "error",
        error: {
          type: "invalid_request_error",
          message: "messages is required and must be a non-empty array",
        },
      });
      return;
    }

    const { prompt, model } = claudeToCli(body);
    const workspace = (body as any).workspace || (body as any).metadata?.workspace || undefined;
    console.error(
      `[messages] id=${requestId} model=${body.model} -> cli_model=${model} stream=${stream}`
    );

    const subprocess = new CursorSubprocess();

    if (stream) {
      await handleClaudeStreamingResponse(res, subprocess, prompt, model, workspace, requestId);
    } else {
      await handleClaudeNonStreamingResponse(res, subprocess, prompt, model, workspace, requestId);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[messages] Error:", message);
    if (!res.headersSent) {
      res.status(500).json({
        type: "error",
        error: { type: "server_error", message },
      });
    }
  }
}

async function handleClaudeStreamingResponse(
  res: Response,
  subprocess: CursorSubprocess,
  prompt: string,
  model: string,
  workspace: string | undefined,
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

  return new Promise<void>((resolve) => {
    let isComplete = false;
    let outputTokens = 0;

    res.on("close", () => {
      if (!isComplete) subprocess.kill();
      resolve();
    });

    subprocess.on("content_delta", (delta: ContentDeltaEvent) => {
      if (delta.text && !res.writableEnded) {
        sendEvent("content_block_delta", createClaudeStreamContentBlockDelta(delta.text));
      }
    });

    subprocess.on("result", (result: ResultEvent) => {
      isComplete = true;
      if (!res.writableEnded) {
        sendEvent("content_block_stop", createClaudeStreamContentBlockStop());
        sendEvent("message_delta", createClaudeStreamMessageDelta(outputTokens));
        sendEvent("message_stop", createClaudeStreamMessageStop());
        res.end();
      }
      resolve();
    });

    subprocess.on("error", (error: Error) => {
      console.error("[claude-stream] Error:", error.message);
      if (!res.writableEnded) {
        sendEvent("error", { type: "server_error", message: error.message });
        res.end();
      }
      resolve();
    });

    subprocess.on("close", (code: number | null) => {
      if (!res.writableEnded) {
        if (code !== 0 && !isComplete) {
          sendEvent("error", {
            type: "server_error",
            message: `Process exited with code ${code}`,
          });
        }
        if (!isComplete) {
          sendEvent("content_block_stop", createClaudeStreamContentBlockStop());
          sendEvent("message_delta", createClaudeStreamMessageDelta(outputTokens));
          sendEvent("message_stop", createClaudeStreamMessageStop());
        }
        res.end();
      }
      resolve();
    });

    subprocess.start(prompt, { model, workspace }).catch((err) => {
      console.error("[claude-stream] Start error:", err);
      if (!res.writableEnded) {
        sendEvent("error", {
          type: "server_error",
          message: err instanceof Error ? err.message : String(err),
        });
        res.end();
      }
      resolve();
    });
  });
}

async function handleClaudeNonStreamingResponse(
  res: Response,
  subprocess: CursorSubprocess,
  prompt: string,
  model: string,
  workspace: string | undefined,
  requestId: string
): Promise<void> {
  return new Promise<void>((resolve) => {
    let finalResult: ResultEvent | null = null;

    subprocess.on("result", (result: ResultEvent) => {
      finalResult = result;
    });

    subprocess.on("error", (error: Error) => {
      console.error("[claude-non-stream] Error:", error.message);
      if (!res.headersSent) {
        res.status(500).json({
          type: "error",
          error: { type: "server_error", message: error.message },
        });
      }
      resolve();
    });

    subprocess.on("close", () => {
      if (finalResult) {
        const response = createClaudeResponse(
          requestId,
          finalResult.model || model,
          finalResult.text
        );
        res.json(response);
      } else if (!res.headersSent) {
        res.status(500).json({
          type: "error",
          error: {
            type: "server_error",
            message: "CLI exited without producing a result",
          },
        });
      }
      resolve();
    });

    subprocess.start(prompt, { model, workspace }).catch((error) => {
      if (!res.headersSent) {
        res.status(500).json({
          type: "error",
          error: {
            type: "server_error",
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
      resolve();
    });
  });
}

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

let cachedCliVersion: string | undefined;

export function setCachedCliVersion(version: string): void {
  cachedCliVersion = version;
}

export function handleHealth(_req: Request, res: Response): void {
  res.json({
    status: "ok",
    provider: "cursor-agent-api-proxy",
    cli_version: cachedCliVersion ?? "unknown",
    timestamp: new Date().toISOString(),
  });
}
