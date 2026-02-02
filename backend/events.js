const DEFAULT_MAX_EVENTS = 4096;

function parseEventsBytes(buffer, options = {}) {
  const maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
  if (!Buffer.isBuffer(buffer)) {
    throw new Error("events_bytes must be a buffer");
  }
  if (buffer.length < 2) {
    throw new Error("events_bytes too short");
  }
  const len = buffer[0] | (buffer[1] << 8);
  const expected = 2 + len * 3;
  if (buffer.length !== expected) {
    throw new Error("events_bytes length mismatch");
  }
  if (len > maxEvents) {
    throw new Error("too many events");
  }
  return { len };
}

module.exports = {
  DEFAULT_MAX_EVENTS,
  parseEventsBytes,
};
