import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";
import {
  KEY,
  encodeEvents,
  bytesToBase64,
  normalizePrompt,
  hexToBytes,
} from "../frontend/src/replay.mjs";

const require = createRequire(import.meta.url);
const StellarSdk = require("../frontend/node_modules/@stellar/stellar-sdk");

const backendUrl = process.env.BACKEND_URL || "http://localhost:3000";
const rpcUrl = process.env.RPC_URL || "https://soroban-testnet.stellar.org";
const contractId =
  process.env.LEADERBOARD_CONTRACT_ID || process.env.CONTRACT_ID || "";
const networkPassphrase =
  process.env.NETWORK_PASSPHRASE || StellarSdk.Networks.TESTNET;
const playerName = process.env.PLAYER_NAME || `smoke-${Date.now() % 100000}`;
const fixtureDtMs = Number(process.env.FIXTURE_DT_MS || 80);

if (!contractId) {
  console.error("Missing LEADERBOARD_CONTRACT_ID or CONTRACT_ID env var.");
  process.exit(1);
}

const rpcServer = new StellarSdk.rpc.Server(rpcUrl, {
  allowHttp: rpcUrl.startsWith("http://"),
});

function mapCharToKey(char) {
  if (char === " ") {
    return KEY.SPACE;
  }
  if (char >= "a" && char <= "z") {
    return char.charCodeAt(0) - 97;
  }
  throw new Error(`Unsupported char in prompt: ${char}`);
}

function buildFixtureEvents(prompt) {
  const events = [];
  for (const char of prompt) {
    events.push({ dtMs: fixtureDtMs, key: mapCharToKey(char) });
  }
  events.push({ dtMs: fixtureDtMs, key: KEY.ENTER });
  return events;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${url} failed (${response.status}): ${text}`);
  }
  return response.json();
}

async function main() {
  console.log("E2E: requesting wallet");
  const wallet = await fetchJson(`${backendUrl}/wallet`, { method: "POST" });

  console.log("E2E: fetching challenge");
  const challenge = await fetchJson(`${backendUrl}/challenge/current`);

  const normalizedPrompt = normalizePrompt(challenge.prompt);
  const events = buildFixtureEvents(normalizedPrompt);
  const eventsBase64 = bytesToBase64(encodeEvents(events));

  console.log("E2E: requesting proof");
  const proof = await fetchJson(`${backendUrl}/prove`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      challenge_id: challenge.challenge_id,
      player_pubkey: wallet.publicKey,
      prompt: challenge.prompt,
      events_bytes_base64: eventsBase64,
    }),
  });

  console.log("E2E: submitting score");
  const keypair = StellarSdk.Keypair.fromSecret(wallet.secretKey);
  const account = await rpcServer.getAccount(wallet.publicKey);
  const contract = new StellarSdk.Contract(contractId);
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      contract.call(
        "submit_score",
        StellarSdk.nativeToScVal(challenge.challenge_id, { type: "u32" }),
        StellarSdk.nativeToScVal(wallet.publicKey, { type: "address" }),
        StellarSdk.nativeToScVal(playerName, { type: "string" }),
        StellarSdk.nativeToScVal(hexToBytes(challenge.prompt_hash_hex), {
          type: "bytes",
        }),
        StellarSdk.nativeToScVal(BigInt(proof.score), { type: "u64" }),
        StellarSdk.nativeToScVal(proof.wpm_x100, { type: "u32" }),
        StellarSdk.nativeToScVal(proof.accuracy_bps, { type: "u32" }),
        StellarSdk.nativeToScVal(proof.duration_ms, { type: "u32" }),
        StellarSdk.nativeToScVal(hexToBytes(proof.journal_sha256_hex), {
          type: "bytes",
        }),
        StellarSdk.nativeToScVal(hexToBytes(proof.image_id_hex), { type: "bytes" }),
        StellarSdk.nativeToScVal(hexToBytes(proof.seal_hex), { type: "bytes" })
      )
    )
    .setTimeout(120)
    .build();

  const prepared = await rpcServer.prepareTransaction(tx);
  prepared.sign(keypair);
  const sendResult = await rpcServer.sendTransaction(prepared);
  if (sendResult.status === "PENDING") {
    const finalResult = await rpcServer.pollTransaction(sendResult.hash);
    if (finalResult.status !== "SUCCESS") {
      throw new Error(`Transaction failed: ${finalResult.status}`);
    }
  } else if (sendResult.status !== "SUCCESS") {
    throw new Error(`Transaction failed: ${sendResult.status}`);
  }

  console.log("E2E: reading leaderboard");
  await sleep(2000);
  const readAccount = await rpcServer.getAccount(wallet.publicKey);
  const readTx = new StellarSdk.TransactionBuilder(readAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      contract.call(
        "get_top",
        StellarSdk.nativeToScVal(challenge.challenge_id, { type: "u32" })
      )
    )
    .setTimeout(60)
    .build();
  const sim = await rpcServer.simulateTransaction(readTx);
  const parsed = StellarSdk.rpc.parseRawSimulation(sim);
  if (parsed.error) {
    throw new Error(parsed.error);
  }
  const rows = StellarSdk.scValToNative(parsed.result.retval);
  const found = Array.isArray(rows)
    ? rows.some((row) => row.name === playerName)
    : false;

  if (!found) {
    throw new Error("Name not found in leaderboard");
  }

  console.log("E2E: success (name found in leaderboard)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
