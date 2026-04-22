/**
 * Express HTTP server setup.
 */

import express from "express";
import type { Server } from "http";
import {
  handleChatCompletions,
  handleMessages,
  handleModels,
  handleHealth,
  initCursorClient,
} from "./routes.js";
import { CursorApiClient } from "../upstream/cursor-client.js";

let server: Server | null = null;

export interface ServerConfig {
  port?: number;
}

export async function startServer(
  config: ServerConfig = {}
): Promise<Server> {
  const port = config.port ?? 4646;
  const app = express();

  app.use(express.json({ limit: "10mb" }));

  app.use((_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, OPTIONS"
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, x-api-key, anthropic-version"
    );
    next();
  });

  app.options("*", (_req, res) => {
    res.sendStatus(204);
  });

  // Initialize Cursor API client (HTTP mode — no CLI needed)
  const cursorApiKey = process.env.CURSOR_API_KEY;
  if (cursorApiKey) {
    const client = new CursorApiClient({ apiKey: cursorApiKey });
    initCursorClient(client);
    console.log("Cursor API client initialized (HTTP mode — no CLI needed)");
  } else {
    console.warn("CURSOR_API_KEY not set — API calls will fail");
  }

  // Proxy auth (optional, separate from CURSOR_API_KEY)
  const proxyKey = process.env.PROXY_API_KEY;
  if (proxyKey) {
    app.use((req, res, next) => {
      if (req.path === "/health" || req.method === "OPTIONS") return next();
      const auth = req.headers.authorization;
      const xApiKey = req.headers["x-api-key"] as string | undefined;
      const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : (xApiKey?.trim() ?? "");
      if (token !== proxyKey) {
        res.status(401).json({
          error: { message: "Invalid API key", type: "auth_error", code: "invalid_api_key" },
        });
        return;
      }
      next();
    });
  }

  app.get("/health", handleHealth);
  app.get("/v1/models", handleModels);
  app.post("/v1/chat/completions", handleChatCompletions);
  app.post("/v1/messages", handleMessages);

  app.use((_req, res) => {
    res.status(404).json({
      error: {
        message: "Not found",
        type: "invalid_request_error",
        code: "not_found",
      },
    });
  });

  return new Promise((resolve, reject) => {
    server = app.listen(port, () => {
      console.log(`Server listening on http://localhost:${port}`);
      resolve(server!);
    });
    server.on("error", reject);
  });
}

export async function stopServer(): Promise<void> {
  if (server) {
    return new Promise((resolve) => {
      server!.close(() => {
        server = null;
        resolve();
      });
    });
  }
}

export function getServer(): Server | null {
  return server;
}
