/**
 * Claude Messages API types (subset).
 */

export interface ClaudeContentBlock {
  type: "text";
  text: string;
}

export interface ClaudeMessage {
  role: "user" | "assistant";
  content: string | ClaudeContentBlock[];
}

export interface ClaudeMessagesRequest {
  model: string;
  messages: ClaudeMessage[];
  system?: string | ClaudeContentBlock[];
  max_tokens: number;
  stream?: boolean;
  temperature?: number;
  metadata?: { user_id?: string };
}

export interface ClaudeMessagesResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: ClaudeContentBlock[];
  model: string;
  stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface ClaudeStreamMessageStart {
  type: "message_start";
  message: Omit<ClaudeMessagesResponse, "content"> & { content: [] };
}

export interface ClaudeStreamContentBlockStart {
  type: "content_block_start";
  index: number;
  content_block: { type: "text"; text: "" };
}

export interface ClaudeStreamContentBlockDelta {
  type: "content_block_delta";
  index: number;
  delta: { type: "text_delta"; text: string };
}

export interface ClaudeStreamContentBlockStop {
  type: "content_block_stop";
  index: number;
}

export interface ClaudeStreamMessageDelta {
  type: "message_delta";
  delta: { stop_reason: "end_turn"; stop_sequence: null };
  usage: { output_tokens: number };
}

export interface ClaudeStreamMessageStop {
  type: "message_stop";
}
