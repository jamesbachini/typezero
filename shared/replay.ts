export type ReplayEvent = {
  dtMs: number;
  key: number;
};

// Key mapping (canonical, deterministic)
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
} as const;

export const KEY_RANGE_MAX = 28;

export function encodeEvents(events: ReplayEvent[]): Uint8Array {
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

    // dt_ms as little-endian u16
    out[offset] = dt & 0xff;
    out[offset + 1] = (dt >> 8) & 0xff;
    out[offset + 2] = key & 0xff;
    offset += 3;
  }

  return out;
}

export function decodeEvents(buf: Uint8Array): ReplayEvent[] {
  if (buf.length < 2) {
    throw new Error("buffer too short");
  }
  const len = buf[0] | (buf[1] << 8);
  const expected = 2 + len * 3;
  if (buf.length !== expected) {
    throw new Error("buffer length mismatch");
  }

  const events: ReplayEvent[] = [];
  let offset = 2;
  for (let i = 0; i < len; i += 1) {
    const dt = buf[offset] | (buf[offset + 1] << 8);
    const key = buf[offset + 2];
    events.push({ dtMs: dt, key });
    offset += 3;
  }
  return events;
}
