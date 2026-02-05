const test = require("node:test");
const assert = require("node:assert/strict");
const { createServer } = require("../server");
const { promptHashHex } = require("../prompt");

function buildFixtureEventsBase64() {
  const bytes = Buffer.from([
    0x03,
    0x00, // len = 3
    0x64,
    0x00,
    0x00, // dt=100, key=0
    0x64,
    0x00,
    0x01, // dt=100, key=1
    0x64,
    0x00,
    0x02, // dt=100, key=2
  ]);
  return bytes.toString("base64");
}

test("POST /prove returns proof artifacts for fixture", async () => {
  const prompt = "hello world";
  const eventsBase64 = buildFixtureEventsBase64();
  const playerHex = "07".repeat(32);
  const challengeId = 1;
  const expectedHash = promptHashHex(prompt);

  const prover = async ({ challengeId: cid, playerPubkey, prompt: p, eventsBytes }) => {
    assert.equal(cid, challengeId);
    assert.equal(p, prompt);
    assert.equal(eventsBytes.toString("base64"), eventsBase64);
    return {
      score: 12345,
      wpm_x100: 6789,
      accuracy_bps: 9100,
      duration_ms: 1200,
      image_id_hex: "aa",
      journal_sha256_hex: "bb",
      seal_hex: "cc",
      journal_prompt_hash_hex: expectedHash,
      journal_player_pubkey_hex: playerPubkey.toString("hex"),
      journal_challenge_id: cid,
    };
  };

  const server = createServer({ prover, verifierSelectorHex: "a1b2c3d4" });
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  const response = await fetch(`http://localhost:${port}/prove`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      challenge_id: challengeId,
      player_pubkey: playerHex,
      prompt,
      events_bytes_base64: eventsBase64,
    }),
  });

  const payload = await response.json();
  server.close();

  assert.equal(response.status, 200);
  assert.deepEqual(payload, {
    score: 12345,
    wpm_x100: 6789,
    accuracy_bps: 9100,
    duration_ms: 1200,
    image_id_hex: "aa",
    journal_sha256_hex: "bb",
    seal_hex: "a1b2c3d4cc",
  });
});
