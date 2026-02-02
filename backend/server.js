const http = require("node:http");
const { Keypair, StrKey } = require("@stellar/stellar-sdk");
const { normalizePrompt, sha256Hex, promptHashHex } = require("./prompt");
const { DEFAULT_MAX_EVENTS, parseEventsBytes } = require("./events");
const { DEFAULT_FRIENDBOT_URL, fundWithFriendbot } = require("./friendbot");
const { proveWithHost } = require("./prover");

const DEFAULT_CHALLENGE_ID = 1;
const DEFAULT_CHALLENGE_PROMPT =
  "the quick brown fox jumps over the lazy dog";
const DEFAULT_MAX_PROMPT_CHARS = 256;
const DEFAULT_MAX_BODY_BYTES = 1_000_000;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    ...corsHeaders(),
  });
  res.end(body);
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
}

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      if (!body) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", (err) => reject(err));
  });
}

function decodeBase64Strict(value, label) {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a base64 string`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${label} must not be empty`);
  }
  if (trimmed.length % 4 !== 0) {
    throw new Error(`${label} has invalid length`);
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
    throw new Error(`${label} has invalid characters`);
  }
  const buffer = Buffer.from(trimmed, "base64");
  const reencoded = buffer.toString("base64");
  if (reencoded.replace(/=+$/, "") !== trimmed.replace(/=+$/, "")) {
    throw new Error(`${label} is not valid base64`);
  }
  return buffer;
}

function parsePlayerPubkey(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("player_pubkey is required");
  }
  const trimmed = value.startsWith("0x") ? value.slice(2) : value;
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  try {
    return Buffer.from(StrKey.decodeEd25519PublicKey(value));
  } catch (_err) {
    throw new Error("player_pubkey must be 32-byte hex or Stellar G... address");
  }
}

function createServer(options = {}) {
  const challengeId = Number(
    options.challengeId ?? process.env.CHALLENGE_ID ?? DEFAULT_CHALLENGE_ID
  );
  const challengePrompt =
    options.challengePrompt ||
    process.env.CHALLENGE_PROMPT ||
    DEFAULT_CHALLENGE_PROMPT;
  const maxPromptChars =
    options.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS;
  const maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const friendbotUrl =
    options.friendbotUrl || process.env.FRIENDBOT_URL || DEFAULT_FRIENDBOT_URL;
  const friendbotFund = options.friendbotFund || fundWithFriendbot;
  const prover = options.prover || ((payload) => proveWithHost(payload));

  async function handleWallet(req, res) {
    // WARNING: demo-only. Never generate or return secrets like this in production.
    const keypair = Keypair.random();
    await friendbotFund(keypair.publicKey(), { friendbotUrl });
    sendJson(res, 200, {
      publicKey: keypair.publicKey(),
      secretKey: keypair.secret(),
    });
  }

  async function handleCurrentChallenge(_req, res) {
    const promptHashHexValue = promptHashHex(challengePrompt);
    sendJson(res, 200, {
      challenge_id: challengeId,
      prompt: challengePrompt,
      prompt_hash_hex: promptHashHexValue,
    });
  }

  async function handleProve(req, res) {
    const body = await readJsonBody(req, maxBodyBytes);
    if (!body || typeof body !== "object") {
      sendError(res, 400, "missing JSON body");
      return;
    }

    const { challenge_id, player_pubkey, prompt, events_bytes_base64 } = body;
    if (challenge_id === undefined) {
      sendError(res, 400, "challenge_id is required");
      return;
    }
    if (player_pubkey === undefined) {
      sendError(res, 400, "player_pubkey is required");
      return;
    }
    if (prompt === undefined) {
      sendError(res, 400, "prompt is required");
      return;
    }
    if (events_bytes_base64 === undefined) {
      sendError(res, 400, "events_bytes_base64 is required");
      return;
    }

    const parsedChallengeId = Number(challenge_id);
    if (!Number.isInteger(parsedChallengeId) || parsedChallengeId < 0) {
      sendError(res, 400, "challenge_id must be a non-negative integer");
      return;
    }
    if (typeof prompt !== "string") {
      sendError(res, 400, "prompt must be a string");
      return;
    }
    if (prompt.length > maxPromptChars) {
      sendError(res, 400, `prompt exceeds ${maxPromptChars} chars`);
      return;
    }

    let playerPubkeyBytes;
    let eventsBytes;
    let promptBytes;
    try {
      playerPubkeyBytes = parsePlayerPubkey(player_pubkey);
      eventsBytes = decodeBase64Strict(
        events_bytes_base64,
        "events_bytes_base64"
      );
      parseEventsBytes(eventsBytes, { maxEvents });
      promptBytes = normalizePrompt(prompt);
    } catch (err) {
      sendError(res, 400, err.message);
      return;
    }

    const promptHashHexValue = sha256Hex(promptBytes);

    let proveResult;
    try {
      proveResult = await prover({
        challengeId: parsedChallengeId,
        playerPubkey: playerPubkeyBytes,
        prompt,
        eventsBytes,
      });
    } catch (err) {
      sendError(res, 500, err.message || "prover failed");
      return;
    }

    if (
      proveResult.journal_prompt_hash_hex &&
      proveResult.journal_prompt_hash_hex.toLowerCase() !==
        promptHashHexValue.toLowerCase()
    ) {
      sendError(res, 500, "prompt hash mismatch in prover output");
      return;
    }
    if (
      Number.isFinite(proveResult.journal_challenge_id) &&
      proveResult.journal_challenge_id !== parsedChallengeId
    ) {
      sendError(res, 500, "challenge_id mismatch in prover output");
      return;
    }
    if (proveResult.journal_player_pubkey_hex) {
      const normalized = playerPubkeyBytes.toString("hex");
      if (proveResult.journal_player_pubkey_hex.toLowerCase() !== normalized) {
        sendError(res, 500, "player_pubkey mismatch in prover output");
        return;
      }
    }

    sendJson(res, 200, {
      score: proveResult.score,
      wpm_x100: proveResult.wpm_x100,
      accuracy_bps: proveResult.accuracy_bps,
      duration_ms: proveResult.duration_ms,
      image_id_hex: proveResult.image_id_hex,
      journal_sha256_hex: proveResult.journal_sha256_hex,
      seal_hex: proveResult.seal_hex,
    });
  }

  return http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    const { pathname } = url;

    Promise.resolve()
      .then(async () => {
        if (req.method === "OPTIONS") {
          res.writeHead(204, corsHeaders());
          res.end();
          return;
        }
        if (req.method === "GET" && pathname === "/") {
          sendJson(res, 200, { ok: true });
          return;
        }
        if (req.method === "POST" && pathname === "/wallet") {
          await handleWallet(req, res);
          return;
        }
        if (req.method === "GET" && pathname === "/challenge/current") {
          await handleCurrentChallenge(req, res);
          return;
        }
        if (req.method === "POST" && pathname === "/prove") {
          await handleProve(req, res);
          return;
        }

        sendError(res, 404, "not found");
      })
      .catch((err) => {
        sendError(res, 500, err.message || "server error");
      });
  });
}

module.exports = {
  createServer,
  decodeBase64Strict,
  parsePlayerPubkey,
};
