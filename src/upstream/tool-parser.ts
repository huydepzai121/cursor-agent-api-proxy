/**
 * Tool parser — extracts tool calls from model text output.
 *
 * Ported from cursor2api/src/converter.ts (parseToolCalls + tolerantParse).
 * The model outputs tool calls as ```json action blocks in its text response.
 * This module parses those blocks into structured tool call objects.
 */

export interface ParsedToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Fault-tolerant JSON parser — handles truncated JSON, bare newlines,
 * unclosed brackets, etc.
 */
function tolerantParse(jsonStr: string): Record<string, unknown> {
  // Attempt 1: direct parse
  try {
    return JSON.parse(jsonStr);
  } catch {
    // continue
  }

  // Attempt 2: fix bare newlines/tabs in strings, unclosed brackets
  let inString = false;
  let fixed = "";
  const bracketStack: string[] = [];

  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];
    if (char === '"') {
      let bs = 0;
      for (let j = i - 1; j >= 0 && fixed[j] === "\\"; j--) bs++;
      if (bs % 2 === 0) inString = !inString;
      fixed += char;
      continue;
    }
    if (inString) {
      if (char === "\n") fixed += "\\n";
      else if (char === "\r") fixed += "\\r";
      else if (char === "\t") fixed += "\\t";
      else fixed += char;
    } else {
      if (char === "{" || char === "[")
        bracketStack.push(char === "{" ? "}" : "]");
      else if (char === "}" || char === "]")
        if (bracketStack.length > 0) bracketStack.pop();
      fixed += char;
    }
  }
  if (inString) fixed += '"';
  while (bracketStack.length > 0) fixed += bracketStack.pop();
  fixed = fixed.replace(/,\s*([}\]])/g, "$1");

  try {
    return JSON.parse(fixed);
  } catch {
    // Attempt 3: truncate to last complete object
    const lastBrace = fixed.lastIndexOf("}");
    if (lastBrace > 0) {
      try {
        return JSON.parse(fixed.substring(0, lastBrace + 1));
      } catch {
        /* ignore */
      }
    }

    // Attempt 4: regex extract tool + parameters
    const toolMatch = jsonStr.match(/"(?:tool|name)"\s*:\s*"([^"]+)"/);
    if (toolMatch) {
      const toolName = toolMatch[1];
      const paramsMatch = jsonStr.match(
        /"(?:parameters|arguments|input)"\s*:\s*(\{[\s\S]*)/
      );
      let params: Record<string, unknown> = {};
      if (paramsMatch) {
        const paramsStr = paramsMatch[1];
        let depth = 0;
        let end = -1;
        let pInStr = false;
        for (let i = 0; i < paramsStr.length; i++) {
          const c = paramsStr[i];
          if (c === '"') {
            let bsc = 0;
            for (let j = i - 1; j >= 0 && paramsStr[j] === "\\"; j--) bsc++;
            if (bsc % 2 === 0) pInStr = !pInStr;
          }
          if (!pInStr) {
            if (c === "{") depth++;
            if (c === "}") {
              depth--;
              if (depth === 0) {
                end = i;
                break;
              }
            }
          }
        }
        if (end > 0) {
          try {
            params = JSON.parse(paramsStr.substring(0, end + 1));
          } catch {
            const fieldRegex = /"([^"]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
            let fm;
            while ((fm = fieldRegex.exec(paramsStr.substring(0, end + 1))) !== null) {
              params[fm[1]] = fm[2].replace(/\\n/g, "\n").replace(/\\t/g, "\t");
            }
          }
        }
      }
      return { tool: toolName, parameters: params };
    }

    throw new Error("Failed to parse tool call JSON");
  }
}

/**
 * Parse ```json action blocks from model text output.
 * Uses a JSON-string-aware scanner to avoid matching ``` inside JSON strings.
 */
export function parseToolCalls(responseText: string): {
  toolCalls: ParsedToolCall[];
  cleanText: string;
} {
  const toolCalls: ParsedToolCall[] = [];
  const blocksToRemove: Array<{ start: number; end: number }> = [];

  const openPattern = /```json(?:\s+action)?/g;
  let openMatch: RegExpExecArray | null;

  while ((openMatch = openPattern.exec(responseText)) !== null) {
    const blockStart = openMatch.index;
    const contentStart = blockStart + openMatch[0].length;

    // Scan for closing ``` outside JSON strings
    let pos = contentStart;
    let inJsonString = false;
    let closingPos = -1;

    while (pos < responseText.length - 2) {
      const char = responseText[pos];
      if (char === '"') {
        let bs = 0;
        for (let j = pos - 1; j >= contentStart && responseText[j] === "\\"; j--) bs++;
        if (bs % 2 === 0) inJsonString = !inJsonString;
        pos++;
        continue;
      }
      if (!inJsonString && responseText.substring(pos, pos + 3) === "```") {
        closingPos = pos;
        break;
      }
      pos++;
    }

    if (closingPos >= 0) {
      const jsonContent = responseText.substring(contentStart, closingPos).trim();
      try {
        const parsed = tolerantParse(jsonContent);
        if (parsed.tool || parsed.name) {
          const name = (parsed.tool || parsed.name) as string;
          const args = (parsed.parameters || parsed.arguments || parsed.input || {}) as Record<string, unknown>;
          toolCalls.push({ name, arguments: args });
          blocksToRemove.push({ start: blockStart, end: closingPos + 3 });
        }
      } catch {
        // Not a tool call, skip
      }
    } else {
      // No closing ``` — truncated block, try to parse anyway
      const jsonContent = responseText.substring(contentStart).trim();
      if (jsonContent.length > 10) {
        try {
          const parsed = tolerantParse(jsonContent);
          if (parsed.tool || parsed.name) {
            const name = (parsed.tool || parsed.name) as string;
            const args = (parsed.parameters || parsed.arguments || parsed.input || {}) as Record<string, unknown>;
            toolCalls.push({ name, arguments: args });
            blocksToRemove.push({ start: blockStart, end: responseText.length });
          }
        } catch {
          // ignore
        }
      }
    }
  }

  // Remove parsed blocks from text (back to front)
  let cleanText = responseText;
  for (let i = blocksToRemove.length - 1; i >= 0; i--) {
    const block = blocksToRemove[i];
    cleanText = cleanText.substring(0, block.start) + cleanText.substring(block.end);
  }

  return { toolCalls, cleanText: cleanText.trim() };
}

/** Quick check — does the text contain any json action blocks? */
export function hasToolCalls(text: string): boolean {
  return text.includes("```json");
}

/** Are all opened ```json action blocks properly closed? */
export function isToolCallComplete(text: string): boolean {
  const openCount = (text.match(/```json\s+action/g) || []).length;
  const allBackticks = (text.match(/```/g) || []).length;
  const closeCount = allBackticks - openCount;
  return openCount > 0 && closeCount >= openCount;
}