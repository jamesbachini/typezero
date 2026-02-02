export const KEY = {
  A: 0,
  B: 1,
  C: 2,
  D: 3,
  E: 4,
  F: 5,
  G: 6,
  H: 7,
  I: 8,
  J: 9,
  K: 10,
  L: 11,
  M: 12,
  N: 13,
  O: 14,
  P: 15,
  Q: 16,
  R: 17,
  S: 18,
  T: 19,
  U: 20,
  V: 21,
  W: 22,
  X: 23,
  Y: 24,
  Z: 25,
  SPACE: 26,
  BACKSPACE: 27,
  ENTER: 28,
};

export const KEY_RANGE_MAX = 28;
export const MIN_DT_MS = 10;
export const MIN_DURATION_PER_CHAR_MS = 40;

function isAsciiWhitespace(code) {
  return code === 0x20 || (code >= 0x09 && code <= 0x0d);
}

export function normalizePrompt(input) {
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
  return String.fromCharCode(...out);
}

export function normalizePromptBytes(input) {
  const normalized = normalizePrompt(input);
  return new TextEncoder().encode(normalized);
}

export function encodeEvents(events) {
  const len = events.length;
  if (len > 0xffff) {
    throw new Error("events length exceeds u16");
  }

  const out = new Uint8Array(2 + len * 3);
  out[0] = len & 0xff;
  out[1] = (len >> 8) & 0xff;

  let offset = 2;
  for (const event of events) {
    const dt = event.dtMs;
    if (dt < 0 || dt > 0xffff) {
      throw new Error("dtMs out of u16 range");
    }
    const key = event.key;
    if (key < 0 || key > KEY_RANGE_MAX) {
      throw new Error("key out of range");
    }

    out[offset] = dt & 0xff;
    out[offset + 1] = (dt >> 8) & 0xff;
    out[offset + 2] = key & 0xff;
    offset += 3;
  }

  return out;
}

export function decodeEvents(buf) {
  if (buf.length < 2) {
    throw new Error("buffer too short");
  }
  const len = buf[0] | (buf[1] << 8);
  const expected = 2 + len * 3;
  if (buf.length !== expected) {
    throw new Error("buffer length mismatch");
  }

  const events = [];
  let offset = 2;
  for (let i = 0; i < len; i += 1) {
    const dt = buf[offset] | (buf[offset + 1] << 8);
    const key = buf[offset + 2];
    events.push({ dtMs: dt, key });
    offset += 3;
  }
  return events;
}

export function applyEvents(events) {
  const output = [];
  for (const event of events) {
    const key = event.key;
    if (key >= 0 && key <= 25) {
      output.push(String.fromCharCode(97 + key));
      continue;
    }
    if (key === KEY.SPACE) {
      output.push(" ");
      continue;
    }
    if (key === KEY.BACKSPACE) {
      output.pop();
      continue;
    }
    if (key === KEY.ENTER) {
      continue;
    }
    throw new Error("invalid key in replay");
  }
  return output.join("");
}

export function computeStats(prompt, events) {
  const normalizedPrompt = normalizePrompt(prompt);
  const output = applyEvents(events);

  let durationMs = 0;
  for (const event of events) {
    durationMs += event.dtMs;
  }

  const typedChars = output.length;
  const promptLen = normalizedPrompt.length;
  const cmpLen = Math.min(output.length, promptLen);
  let correctChars = 0;
  for (let i = 0; i < cmpLen; i += 1) {
    if (output[i] === normalizedPrompt[i]) {
      correctChars += 1;
    }
  }

  const accuracyBps = promptLen === 0 ? 0 : Math.floor((correctChars * 10000) / promptLen);
  const wpmX100 = durationMs === 0 ? 0 : Math.floor((typedChars * 1_200_000) / durationMs);
  const score = Math.floor((wpmX100 * accuracyBps) / 10000);
  const minDurationMs = promptLen * MIN_DURATION_PER_CHAR_MS;

  return {
    normalizedPrompt,
    output,
    durationMs,
    typedChars,
    correctChars,
    accuracyBps,
    wpmX100,
    score,
    minDurationMs,
  };
}

export function bytesToBase64(bytes) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function base64ToBytes(base64) {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function hexToBytes(hex) {
  const trimmed = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (trimmed.length % 2 !== 0) {
    throw new Error("hex string must have even length");
  }
  const out = new Uint8Array(trimmed.length / 2);
  for (let i = 0; i < trimmed.length; i += 2) {
    out[i / 2] = Number.parseInt(trimmed.slice(i, i + 2), 16);
  }
  return out;
}

export function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
