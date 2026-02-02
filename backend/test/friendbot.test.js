const test = require("node:test");
const assert = require("node:assert/strict");
const { Keypair } = require("@stellar/stellar-sdk");
const { fundWithFriendbot } = require("../friendbot");

test("fundWithFriendbot uses provided fetch", async () => {
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    return {
      ok: true,
      json: async () => ({ funded: true }),
    };
  };

  const result = await fundWithFriendbot("GTEST", {
    friendbotUrl: "https://friendbot.example",
    fetchImpl: fakeFetch,
  });

  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes("friendbot.example"));
  assert.ok(calls[0].includes("addr=GTEST"));
  assert.deepEqual(result, { funded: true });
});

test("fundWithFriendbot surfaces HTTP errors", async () => {
  const fakeFetch = async () => ({
    ok: false,
    status: 400,
    text: async () => "bad request",
  });

  await assert.rejects(
    () => fundWithFriendbot("GTEST", { fetchImpl: fakeFetch }),
    /friendbot request failed/,
  );
});

const shouldRun = process.env.FRIENDBOT_INTEGRATION === "1";

test(
  "friendbot integration",
  { skip: !shouldRun },
  async () => {
    const keypair = Keypair.random();
    const result = await fundWithFriendbot(keypair.publicKey());
    assert.ok(result);
  }
);
