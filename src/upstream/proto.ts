/**
 * Protobuf encoding/decoding for Cursor API.
 *
 * Wraps the compiled protobuf definitions from Cursor-To-OpenAI.
 * Handles the Connect protocol framing (magic number + length prefix).
 */

import { createRequire } from "module";
import zlib from "zlib";

const require = createRequire(import.meta.url);
const $root = require("./proto-messages.cjs");

export interface CursorMessage {
  content: string;
  role: 1 | 2; // 1 = user, 2 = assistant
  messageId: string;
  chatModeEnum?: number;
}

export interface CursorRequestBody {
  messages: CursorMessage[];
  model: string;
  instruction?: string;
  conversationId: string;
}

/**
 * Encode a chat request into the Cursor protobuf wire format.
 */
export function encodeCursorRequest(body: CursorRequestBody): Buffer {
  const { messages, model, instruction, conversationId } = body;

  const messageIds = messages.map((msg) => {
    const { role, messageId } = msg;
    return { role, messageId };
  });

  const requestObj = {
    request: {
      messages,
      unknown2: 1,
      instruction: { instruction: instruction ?? "" },
      unknown4: 1,
      model: { name: model, empty: "" },
      webTool: "",
      unknown13: 1,
      cursorSetting: {
        name: "cursor\\aisettings",
        unknown3: "",
        unknown6: { unknwon1: "", unknown2: "" },
        unknown8: 1,
        unknown9: 1,
      },
      unknown19: 1,
      conversationId,
      metadata: {
        os: process.platform,
        arch: process.arch,
        version: process.version,
        path: process.execPath,
        timestamp: new Date().toISOString(),
      },
      unknown27: 0,
      messageIds,
      largeContext: 0,
      unknown38: 0,
      chatModeEnum: 2,
      unknown47: "",
      unknown48: 0,
      unknown49: 0,
      unknown51: 0,
      unknown53: 1,
      chatMode: "Agent",
    },
  };

  const errMsg =
    $root.StreamUnifiedChatWithToolsRequest.verify(requestObj);
  if (errMsg) throw new Error(`Protobuf verify failed: ${errMsg}`);

  const instance =
    $root.StreamUnifiedChatWithToolsRequest.create(requestObj);
  let buffer: Buffer = Buffer.from(
    $root.StreamUnifiedChatWithToolsRequest.encode(instance).finish()
  );

  let magicNumber = 0x00;
  if (messages.length >= 3) {
    buffer = zlib.gzipSync(buffer);
    magicNumber = 0x01;
  }

  return Buffer.concat([
    Buffer.from([magicNumber]),
    Buffer.from(buffer.length.toString(16).padStart(8, "0"), "hex"),
    buffer,
  ]);
}

export interface DecodedChunk {
  thinking: string;
  text: string;
}

/**
 * Decode a chunk from the Cursor streaming response.
 */
export function decodeCursorChunk(chunk: Buffer): DecodedChunk {
  const thinkingOutput: string[] = [];
  const textOutput: string[] = [];

  try {
    for (let i = 0; i < chunk.length; ) {
      const magicNumber = chunk[i];
      const dataLength = parseInt(
        chunk.subarray(i + 1, i + 5).toString("hex"),
        16
      );
      const data = chunk.subarray(i + 5, i + 5 + dataLength);

      if (magicNumber === 0 || magicNumber === 1) {
        const gunzipData =
          magicNumber === 0 ? data : zlib.gunzipSync(data);
        const response =
          $root.StreamUnifiedChatWithToolsResponse.decode(gunzipData);

        const thinking = response?.message?.thinking?.content;
        if (thinking !== undefined) {
          thinkingOutput.push(thinking);
        }

        const content = response?.message?.content;
        if (content !== undefined) {
          textOutput.push(content);
        }
      } else if (magicNumber === 2 || magicNumber === 3) {
        // JSON message (error/metadata)
        const gunzipData =
          magicNumber === 2 ? data : zlib.gunzipSync(data);
        const utf8 = gunzipData.toString("utf-8");
        try {
          const message = JSON.parse(utf8);
          if (
            message != null &&
            (typeof message !== "object" ||
              (Array.isArray(message)
                ? message.length > 0
                : Object.keys(message).length > 0))
          ) {
            console.error("[cursor-api] proto json:", utf8);
          }
        } catch {
          // ignore parse errors
        }
      }

      i += 5 + dataLength;
    }
  } catch (err) {
    console.error("[cursor-api] Error parsing chunk:", err);
  }

  return {
    thinking: thinkingOutput.join(""),
    text: textOutput.join(""),
  };
}
