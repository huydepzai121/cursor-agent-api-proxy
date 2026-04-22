/**
 * Claude Messages API types — extended with tool_use support.
 */

// ─── Content Blocks ───

export interface ClaudeTextBlock {
  type: "text";
  text: string;
}

export interface ClaudeToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ClaudeToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content?: string | ClaudeContentBlock[];
  is_error?: boolean;
}

export type ClaudeContentBlock = ClaudeTextBlock | ClaudeToolUseBlock | ClaudeToolResultBlock;

// ─── Tool Definitions ───

export interface ClaudeTool {
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
}

export interface ClaudeToolChoice {
  type: "auto" | "any" | "tool";
  name?: string;
}

// ─── Request / Response ───

export interface ClaudeMessage {
  role: "user" | "assistant";
  content: string | ClaudeContentBlock[];
}

export interface ClaudeMessagesRequest {
  model: string;
  messages: ClaudeMessage[];
  system?: string | ClaudeTextBlock[];
  max_tokens: number;
  stream?: boolean;
  temperature?: number;
  metadata?: { user_id?: string };
  tools?: ClaudeTool[];
  tool_choice?: ClaudeToolChoice;
  thinking?: { type: string; budget_tokens?: number };
}

export interface ClaudeMessagesResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: ClaudeContentBlock[];
  model: string;
  stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// ─── Streaming Events ───

export interface ClaudeStreamMessageStart {
  type: "message_start";
  message: Omit<ClaudeMessagesResponse, "content"> & { content: [] };
}

export interface ClaudeStreamContentBlockStart {
  type: "content_block_start";
  index: number;
  content_block:
    | { type: "text"; text: "" }
    | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
}

export interface ClaudeStreamContentBlockDelta {
  type: "content_block_delta";
  index: number;
  delta:
    | { type: "text_delta"; text: string }
    | { type: "input_json_delta"; partial_json: string };
}

export interface ClaudeStreamContentBlockStop {
  type: "content_block_stop";
  index: number;
}

export interface ClaudeStreamMessageDelta {
  type: "message_delta";
  delta: { stop_reason: "end_turn" | "tool_use"; stop_sequence: null };
  usage: { output_tokens: number };
}

export interface ClaudeStreamMessageStop {
  type: "message_stop";
}
