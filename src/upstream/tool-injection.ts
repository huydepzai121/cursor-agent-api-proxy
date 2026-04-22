/**
 * Tool injection — converts Claude tool definitions into prompt instructions
 * and tool_result blocks into natural language text.
 *
 * Ported from cursor2api/src/converter.ts.
 * Cursor API has no native tool_use protocol, so we inject tool definitions
 * as text instructions and tell the model to output tool calls as
 * ```json action blocks.
 */

import type {
  ClaudeTool,
  ClaudeToolChoice,
  ClaudeMessage,
  ClaudeContentBlock,
} from "../types/claude.js";

/**
 * Compress JSON Schema into a compact type signature.
 * 90 tools: ~135K chars full → ~15K chars compact.
 */
function compactSchema(schema: Record<string, unknown>): string {
  if (!schema?.properties) return "{}";
  const props = schema.properties as Record<string, Record<string, unknown>>;
  const required = new Set((schema.required as string[]) || []);

  const parts = Object.entries(props).map(([name, prop]) => {
    let type = (prop.type as string) || "any";
    if (prop.enum) type = (prop.enum as string[]).join("|");
    if (type === "array" && prop.items) {
      type = `${(prop.items as Record<string, unknown>).type || "any"}[]`;
    }
    if (type === "object" && prop.properties) {
      type = compactSchema(prop as Record<string, unknown>);
    }
    const req = required.has(name) ? "!" : "?";
    return `${name}${req}: ${type}`;
  });

  return `{${parts.join(", ")}}`;
}

/**
 * Build tool instructions to inject into the prompt.
 */
export function buildToolInstructions(
  tools: ClaudeTool[],
  toolChoice?: ClaudeToolChoice
): string {
  if (!tools || tools.length === 0) return "";

  const toolList = tools
    .map((tool) => {
      const desc = tool.description
        ? tool.description.length > 80
          ? tool.description.substring(0, 80) + "…"
          : tool.description
        : "";
      let paramStr = "";
      if (tool.input_schema) {
        const schema = compactSchema(tool.input_schema);
        if (schema && schema !== "{}") paramStr = `\n  Params: ${schema}`;
      }
      return desc
        ? `- **${tool.name}**: ${desc}${paramStr}`
        : `- **${tool.name}**${paramStr}`;
    })
    .join("\n");

  let forceConstraint = "";
  if (toolChoice?.type === "any") {
    forceConstraint = `\n**MANDATORY**: Your response MUST include at least one \`\`\`json action block.`;
  } else if (toolChoice?.type === "tool" && toolChoice.name) {
    forceConstraint = `\n**MANDATORY**: Your response MUST call the "${toolChoice.name}" action.`;
  }

  return `You are operating within an IDE environment with access to the following actions. To invoke an action, include it in your response using this structured format:

\`\`\`json action
{
  "tool": "ACTION_NAME",
  "parameters": {
    "param": "value"
  }
}
\`\`\`

Available actions:
${toolList}

Include the structured block when performing actions. For independent actions, include multiple blocks. For dependent actions, wait for each result. Keep explanatory text brief. Each response must be maximally efficient.${forceConstraint}`;
}

/**
 * Build few-shot example showing the model how to use tools.
 */
export function buildFewShotExample(tools: ClaudeTool[]): string {
  const readTool = tools.find((t) => /^(Read|read_file)$/i.test(t.name));
  const bashTool = tools.find((t) => /^(Bash|execute_command)$/i.test(t.name));
  const exTool = readTool || bashTool || tools[0];
  if (!exTool) return "Understood. Ready to help.";

  const exParams = /^(Read|read_file)$/i.test(exTool.name)
    ? `"file_path": "src/index.ts"`
    : /^(Bash|execute_command)$/i.test(exTool.name)
      ? `"command": "ls -la"`
      : `"input": "value"`;

  return `Understood. I have access to all ${tools.length} tools. Here's how I'll use them:

\`\`\`json action
{
  "tool": "${exTool.name}",
  "parameters": {
    ${exParams}
  }
}
\`\`\`

I will ALWAYS use this exact \`\`\`json action\`\`\` block format for tool calls. Ready to help.`;
}

/**
 * Convert Claude messages with tool_use/tool_result into simple text messages
 * suitable for Cursor API.
 */
export function convertMessagesWithTools(
  messages: ClaudeMessage[],
  systemText: string,
  tools: ClaudeTool[],
  toolChoice?: ClaudeToolChoice
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const result: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];

  // Inject tool instructions + system prompt as first user/assistant pair
  const toolInstructions = buildToolInstructions(tools, toolChoice);
  const fullSystem = systemText
    ? toolInstructions + "\n\n---\n\n" + systemText
    : toolInstructions;

  result.push({ role: "user", content: fullSystem });
  result.push({ role: "assistant", content: buildFewShotExample(tools) });

  // Convert each message
  for (const msg of messages) {
    if (msg.role === "assistant") {
      const text = extractAssistantText(msg);
      if (text) result.push({ role: "assistant", content: text });
    } else if (msg.role === "user") {
      const text = extractUserText(msg);
      if (text) result.push({ role: "user", content: text });
    }
  }

  return result;
}

function extractAssistantText(msg: ClaudeMessage): string {
  if (typeof msg.content === "string") return msg.content;
  const parts: string[] = [];
  for (const block of msg.content) {
    if (block.type === "text") {
      parts.push(block.text);
    } else if (block.type === "tool_use") {
      // Convert tool_use back to json action format
      parts.push(
        `\`\`\`json action\n${JSON.stringify({ tool: block.name, parameters: block.input }, null, 2)}\n\`\`\``
      );
    }
  }
  return parts.join("\n\n");
}

function extractUserText(msg: ClaudeMessage): string {
  if (typeof msg.content === "string") return msg.content;
  const parts: string[] = [];
  for (const block of msg.content) {
    if (block.type === "text") {
      parts.push(block.text);
    } else if (block.type === "tool_result") {
      const resultText = extractToolResultText(block);
      if (block.is_error) {
        parts.push(`The action encountered an error:\n${resultText}`);
      } else {
        parts.push(`Action output:\n${resultText}`);
      }
    }
  }
  return parts.join("\n\n") + "\n\nContinue with the next action.";
}

function extractToolResultText(block: ClaudeContentBlock): string {
  if (block.type !== "tool_result") return "";
  if (!block.content) return "";
  if (typeof block.content === "string") return block.content;
  if (Array.isArray(block.content)) {
    return block.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  }
  return String(block.content);
}