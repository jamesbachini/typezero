const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizePrompt, promptHashHex } = require("../prompt");

const HELLO_WORLD_HASH =
  "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";

test("normalizePrompt lowercases and collapses whitespace", () => {
  const input = "  HeLLo\t  WoRLD  ";
  const normalized = normalizePrompt(input);
  assert.equal(normalized.toString("utf8"), "hello world");
  assert.equal(promptHashHex(input), HELLO_WORLD_HASH);
});

test("normalizePrompt rejects non-ASCII", () => {
  assert.throws(() => normalizePrompt("caf\u00e9"), /ASCII/);
});
