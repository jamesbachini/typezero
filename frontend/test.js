const fs = require("fs");
const path = require("path");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
if (!html.includes("TypeZERO")) {
  console.error("index.html missing TypeZERO heading");
  process.exit(1);
}

async function run() {
  const replay = await import(pathToFileURL(path.join(__dirname, "src", "replay.mjs")));
  const timing = await import(pathToFileURL(path.join(__dirname, "src", "timing.mjs")));

  const events = [
    { dtMs: 12, key: replay.KEY.A },
    { dtMs: 34, key: replay.KEY.SPACE },
    { dtMs: 56, key: replay.KEY.BACKSPACE },
  ];
  const encoded = replay.encodeEvents(events);
  const expected = new Uint8Array([3, 0, 12, 0, 0, 34, 0, 26, 56, 0, 27]);
  assert.deepEqual(Array.from(encoded), Array.from(expected));

  let now = 1000;
  const recorder = timing.createTimingRecorder(() => now);
  recorder.start();
  now = 1040;
  const dt1 = recorder.record();
  now = 1095;
  const dt2 = recorder.record();
  assert.equal(dt1, 40);
  assert.equal(dt2, 55);

  const dtList = timing.computeDtList([1100, 1125, 1190], 1000);
  assert.deepEqual(dtList, [100, 25, 65]);

  console.log("frontend test ok");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
