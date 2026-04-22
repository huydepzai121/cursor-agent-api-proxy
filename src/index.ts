/**
 * cursor-agent-api-proxy — package entry point.
 */

// New HTTP API client (replaces CLI subprocess)
export { CursorApiClient } from "./upstream/cursor-client.js";
export type { CursorClientConfig, ChatRequest, ChatStreamEvent } from "./upstream/cursor-client.js";

// Legacy subprocess (kept for backwards compatibility)
export { CursorSubprocess, verifyCursorCli } from "./subprocess/manager.js";
export type { SubprocessOptions, ContentDeltaEvent, ResultEvent } from "./subprocess/manager.js";

export { startServer, stopServer, getServer } from "./server/index.js";
export type { ServerConfig } from "./server/index.js";

export { extractModel, messagesToPrompt } from "./adapter/openai-to-cli.js";
export {
  createStreamChunk,
  createDoneChunk,
  createChatResponse,
} from "./adapter/cli-to-openai.js";

export {
  createClaudeResponse,
  createClaudeStreamMessageStart,
  createClaudeStreamContentBlockStart,
  createClaudeStreamContentBlockDelta,
  createClaudeStreamContentBlockStop,
  createClaudeStreamMessageDelta,
  createClaudeStreamMessageStop,
} from "./adapter/cli-to-claude.js";
