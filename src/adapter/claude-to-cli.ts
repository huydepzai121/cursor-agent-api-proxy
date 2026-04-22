/**
 * Convert Claude Messages API requests into a prompt string
 * suitable for the Cursor CLI `agent -p` command.
 */

import type { ClaudeContentBlock, ClaudeMessage, ClaudeMessagesRequest } from "../types/claude.js";
import { extractModel } from "./openai-to-cli.js";

export interface CliInput {
  prompt: string;
  model: string;
}

function contentToText(content: string | ClaudeContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((b): b is ClaudeContentBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function systemToText(system: string | ClaudeContentBlock[] | undefined): string {
  if (!system) return "";
  return contentToText(system);
}

export function claudeToCli(request: ClaudeMessagesRequest): CliInput {
  const systemText = systemToText(request.system);

  const nonEmpty = request.messages.filter((m: ClaudeMessage) => {
    return contentToText(m.content).length > 0;
  });

  // Single user message with no system prompt — pass directly
  if (!systemText && nonEmpty.length === 1 && nonEmpty[0].role === "user") {
    return {
      prompt: contentToText(nonEmpty[0].content),
      model: extractModel(request.model || "default"),
    };
  }

  const parts: string[] = [];

  if (systemText) {
    parts.push(`[System]\n${systemText}`);
  }

  for (const msg of nonEmpty) {
    const text = contentToText(msg.content);
    if (msg.role === "user") {
      parts.push(`[User]\n${text}`);
    } else if (msg.role === "assistant") {
      parts.push(`[Assistant]\n${text}`);
    }
  }

  return {
    prompt: parts.join("\n\n"),
    model: extractModel(request.model || "default"),
  };
}
