/**
 * Cursor API checksum generation.
 *
 * Generates the x-cursor-checksum header required by api2.cursor.sh.
 * Ported from Cursor-To-OpenAI project.
 */

import crypto from "crypto";

export function generateHashed64Hex(input: string, salt = ""): string {
  const hash = crypto.createHash("sha256");
  hash.update(input + salt);
  return hash.digest("hex");
}

function obfuscateBytes(byteArray: Uint8Array): Uint8Array {
  let t = 165;
  for (let r = 0; r < byteArray.length; r++) {
    byteArray[r] = ((byteArray[r] ^ t) + (r % 256)) & 0xff;
    t = byteArray[r];
  }
  return byteArray;
}

export function generateCursorChecksum(token: string): string {
  const machineId = generateHashed64Hex(token, "machineId");
  const macMachineId = generateHashed64Hex(token, "macMachineId");

  const timestamp = Math.floor(Date.now() / 1e6);
  const byteArray = new Uint8Array([
    (timestamp >> 40) & 255,
    (timestamp >> 32) & 255,
    (timestamp >> 24) & 255,
    (timestamp >> 16) & 255,
    (timestamp >> 8) & 255,
    255 & timestamp,
  ]);

  const obfuscatedBytes = obfuscateBytes(byteArray);
  const encodedChecksum = Buffer.from(obfuscatedBytes).toString("base64");

  return `${encodedChecksum}${machineId}/${macMachineId}`;
}
