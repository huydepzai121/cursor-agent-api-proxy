/**
 * Convert Cursor CLI output events into Claude Messages API format.
 */

import type {
  ClaudeMessagesResponse,
  ClaudeStreamMessageStart,
  ClaudeStreamContentBlockStart,
  ClaudeStreamContentBlockDelta,
  ClaudeStreamContentBlockStop,
  ClaudeStreamMessageDelta,
  ClaudeStreamMessageStop,
} from "../types/claude.js";

export function createClaudeResponse(
  requestId: string,
  model: string,
  text: string
): ClaudeMessagesResponse {
  return {
    id: `msg_${requestId}`,
    type: "message",
    role: "assistant",
    content: [{ type: "text", text }],
    model,
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
    },
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

export function createClaudeStreamContentBlockStart(): ClaudeStreamContentBlockStart {
  return {
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" },
  };
}

export function createClaudeStreamContentBlockDelta(
  text: string
): ClaudeStreamContentBlockDelta {
  return {
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text },
  };
}

export function createClaudeStreamContentBlockStop(): ClaudeStreamContentBlockStop {
  return { type: "content_block_stop", index: 0 };
}

export function createClaudeStreamMessageDelta(outputTokens = 0): ClaudeStreamMessageDelta {
  return {
    type: "message_delta",
    delta: { stop_reason: "end_turn", stop_sequence: null },
    usage: { output_tokens: outputTokens },
  };
}

export function createClaudeStreamMessageStop(): ClaudeStreamMessageStop {
  return { type: "message_stop" };
}
