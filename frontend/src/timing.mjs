export function computeDtList(timestamps, startTime = 0) {
  if (!Array.isArray(timestamps)) {
    throw new Error("timestamps must be an array");
  }
  let last = startTime;
  return timestamps.map((ts) => {
    const dt = Math.max(0, Math.floor(ts - last));
    last = ts;
    return dt;
  });
}

export function createTimingRecorder(nowFn) {
  if (typeof nowFn !== "function") {
    throw new Error("nowFn must be a function");
  }
  let started = false;
  let last = 0;

  return {
    start() {
      last = nowFn();
      started = true;
      return last;
    },
    record() {
      const now = nowFn();
      if (!started) {
        last = now;
        started = true;
        return 0;
      }
      const dt = Math.max(0, Math.floor(now - last));
      last = now;
      return dt;
    },
    reset() {
      started = false;
      last = 0;
    },
    isStarted() {
      return started;
    },
  };
}
