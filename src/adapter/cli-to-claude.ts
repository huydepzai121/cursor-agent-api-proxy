/**
 * Convert Cursor output into Claude Messages API format.
 * Extended with tool_use support.
 */

import type {
  ClaudeMessagesResponse,
  ClaudeContentBlock,
  ClaudeStreamMessageStart,
  ClaudeStreamContentBlockStart,
  ClaudeStreamContentBlockDelta,
  ClaudeStreamContentBlockStop,
  ClaudeStreamMessageDelta,
  ClaudeStreamMessageStop,
} from "../types/claude.js";
import type { ParsedToolCall } from "../upstream/tool-parser.js";

export function createClaudeResponse(
  requestId: string,
  model: string,
  text: string,
  toolCalls?: ParsedToolCall[]
): ClaudeMessagesResponse {
  const content: ClaudeContentBlock[] = [];
  if (text) content.push({ type: "text", text });
  if (toolCalls) {
    for (const tc of toolCalls) {
      content.push({
        type: "tool_use",
        id: `toolu_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`,
        name: tc.name,
        input: tc.arguments,
      });
    }
  }
  if (content.length === 0) content.push({ type: "text", text: "" });

  return {
    id: `msg_${requestId}`,
    type: "message",
    role: "assistant",
    content,
    model,
    stop_reason: toolCalls && toolCalls.length > 0 ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

export function createClaudeStreamMessageStart(
  requestId: string,
  model: string
): ClaudeStreamMessageStart {
  return {
    type: "message_start",
    message: {
      id: `msg_${requestId}`,
      type: "message",
      role: "assistant",
      model,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
      content: [],
    },
  };
}

export function createClaudeStreamTextBlockStart(index: number): ClaudeStreamContentBlockStart {
  return {
    type: "content_block_start",
    index,
    content_block: { type: "text", text: "" },
  };
}

export function createClaudeStreamToolUseBlockStart(
  index: number,
  toolId: string,
  toolName: string
): ClaudeStreamContentBlockStart {
  return {
    type: "content_block_start",
    index,
    content_block: { type: "tool_use", id: toolId, name: toolName, input: {} },
  };
}

export function createClaudeStreamTextDelta(
  index: number,
  text: string
): ClaudeStreamContentBlockDelta {
  return {
    type: "content_block_delta",
    index,
    delta: { type: "text_delta", text },
  };
}

export function createClaudeStreamInputJsonDelta(
  index: number,
  partialJson: string
): ClaudeStreamContentBlockDelta {
  return {
    type: "content_block_delta",
    index,
    delta: { type: "input_json_delta", partial_json: partialJson },
  };
}

export function createClaudeStreamBlockStop(index: number): ClaudeStreamContentBlockStop {
  return { type: "content_block_stop", index };
}

export function createClaudeStreamMessageDelta(
  stopReason: "end_turn" | "tool_use" = "end_turn",
  outputTokens = 0
): ClaudeStreamMessageDelta {
  return {
    type: "message_delta",
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: outputTokens },
  };
}

export function createClaudeStreamMessageStop(): ClaudeStreamMessageStop {
  return { type: "message_stop" };
}

// Keep old names as aliases for backward compat
export const createClaudeStreamContentBlockStart = createClaudeStreamTextBlockStart;
export const createClaudeStreamContentBlockDelta = (text: string) => createClaudeStreamTextDelta(0, text);
export const createClaudeStreamContentBlockStop = () => createClaudeStreamBlockStop(0);
