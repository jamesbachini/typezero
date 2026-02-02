const crypto = require("node:crypto");

function isAsciiWhitespace(code) {
  return code === 0x20 || (code >= 0x09 && code <= 0x0d);
}

function normalizePrompt(input) {
  if (typeof input !== "string") {
    throw new Error("prompt must be a string");
  }

  const out = [];
  let inSpace = true;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    if (code > 0x7f) {
      throw new Error("prompt must be ASCII");
    }
    if (isAsciiWhitespace(code)) {
      if (!inSpace) {
        out.push(0x20);
        inSpace = true;
      }
      continue;
    }
    const lower = code >= 0x41 && code <= 0x5a ? code + 32 : code;
    out.push(lower);
    inSpace = false;
  }
  if (out.length > 0 && out[out.length - 1] === 0x20) {
    out.pop();
  }
  return Buffer.from(out);
}

function sha256Hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function promptHashHex(prompt) {
  const normalized = normalizePrompt(prompt);
  return sha256Hex(normalized);
}

module.exports = {
  normalizePrompt,
  sha256Hex,
  promptHashHex,
};
