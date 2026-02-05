const crypto = require("node:crypto");
const http = require("node:http");
const {
  BASE_FEE,
  Contract,
  Keypair,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} = require("@stellar/stellar-sdk");
const { normalizePrompt, sha256Hex, promptHashHex } = require("./prompt");
const { DEFAULT_MAX_EVENTS, parseEventsBytes } = require("./events");
const { DEFAULT_FRIENDBOT_URL, fundWithFriendbot } = require("./friendbot");
const { proveWithHost } = require("./prover");

const DEFAULT_CHALLENGE_ID = 1;
const DEFAULT_CHALLENGE_PROMPT =
  "the quick brown fox jumps over the lazy dog";
const DEFAULT_MAX_PROMPT_CHARS = 256;
const DEFAULT_MAX_BODY_BYTES = 1_000_000;
const DEFAULT_MAX_SEAL_BYTES = 8192;
const DEFAULT_RPC_URL = "https://soroban-testnet.stellar.org";
const DEFAULT_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
const DEFAULT_GAME_HUB_CONTRACT_ID =
  "CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG";
const DEFAULT_GAME_WIN_SCORE = 7000;

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

function normalizeHex(value, label, expectedBytes) {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a hex string`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${label} must not be empty`);
  }
  const hex = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
  if (hex.length % 2 !== 0) {
    throw new Error(`${label} has invalid length`);
  }
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(`${label} must be hex`);
  }
  if (Number.isInteger(expectedBytes) && hex.length !== expectedBytes * 2) {
    throw new Error(`${label} must be ${expectedBytes} bytes`);
  }
  return hex.toLowerCase();
}

function parseOptionalSelector(value) {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value !== "string") {
    throw new Error("VERIFIER_SELECTOR_HEX must be a hex string");
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return normalizeHex(trimmed, "VERIFIER_SELECTOR_HEX", 4);
}

function normalizeOptionalAddress(value, label, options = {}) {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const allowed = options.allowed || ["G", "C"];
  const pattern =
    allowed.length === 1
      ? new RegExp(`^${allowed[0]}[A-Z2-7]{55}$`)
      : /^[CG][A-Z2-7]{55}$/;
  if (!pattern.test(trimmed)) {
    throw new Error(`${label} must be a valid Stellar address`);
  }
  return trimmed;
}

function parseOptionalInteger(value, label) {
  if (value === undefined || value === null) {
    return null;
  }
  const num = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(num) || !Number.isInteger(num)) {
    throw new Error(`${label} must be an integer`);
  }
  return num;
}

function parsePlayerAddress(value) {
  const bytes = parsePlayerPubkey(value);
  return StrKey.encodeEd25519PublicKey(bytes);
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
  const maxSealBytes =
    options.maxSealBytes ??
    (process.env.MAX_SEAL_BYTES
      ? Number(process.env.MAX_SEAL_BYTES)
      : DEFAULT_MAX_SEAL_BYTES);
  const verifierSelectorHex = parseOptionalSelector(
    options.verifierSelectorHex ?? process.env.VERIFIER_SELECTOR_HEX
  );
  const friendbotUrl =
    options.friendbotUrl || process.env.FRIENDBOT_URL || DEFAULT_FRIENDBOT_URL;
  const friendbotFund = options.friendbotFund || fundWithFriendbot;
  const prover = options.prover || ((payload) => proveWithHost(payload));
  const rpcUrl = options.rpcUrl || process.env.RPC_URL || DEFAULT_RPC_URL;
  const networkPassphrase =
    options.networkPassphrase ||
    process.env.NETWORK_PASSPHRASE ||
    DEFAULT_NETWORK_PASSPHRASE;
  const gameHubContractId = normalizeOptionalAddress(
    options.gameHubContractId ??
      process.env.GAME_HUB_CONTRACT_ID ??
      DEFAULT_GAME_HUB_CONTRACT_ID,
    "GAME_HUB_CONTRACT_ID",
    { allowed: ["C"] }
  );
  const gameId = normalizeOptionalAddress(
    options.gameId ?? process.env.GAME_ID,
    "GAME_ID"
  );
  const gameWinScore =
    parseOptionalInteger(
      options.gameWinScore ?? process.env.GAME_WIN_SCORE,
      "GAME_WIN_SCORE"
    ) ?? DEFAULT_GAME_WIN_SCORE;
  const houseSecret = options.houseSecret ?? process.env.HOUSE_SECRET_KEY ?? "";
  const housePublic = normalizeOptionalAddress(
    options.housePublic ?? process.env.HOUSE_PUBLIC_KEY,
    "HOUSE_PUBLIC_KEY",
    { allowed: ["G"] }
  );

  const sessions = new Map();
  let houseKeypair = null;
  let rpcServer = null;
  let sessionSeed = crypto.randomInt(1, 0x100000000);

  function getHouseKeypair() {
    if (houseKeypair) {
      return houseKeypair;
    }
    if (typeof houseSecret !== "string" || !houseSecret.trim()) {
      throw new Error("HOUSE_SECRET_KEY is required for game hub calls");
    }
    let keypair;
    try {
      keypair = Keypair.fromSecret(houseSecret.trim());
    } catch (_err) {
      throw new Error("HOUSE_SECRET_KEY is invalid");
    }
    const derived = keypair.publicKey();
    if (housePublic && housePublic !== derived) {
      throw new Error("HOUSE_PUBLIC_KEY does not match HOUSE_SECRET_KEY");
    }
    houseKeypair = keypair;
    return keypair;
  }

  function getHouseAddress() {
    return getHouseKeypair().publicKey();
  }

  function getRpcServer() {
    if (!rpcServer) {
      rpcServer = new rpc.Server(rpcUrl, {
        allowHttp: rpcUrl.startsWith("http://"),
      });
    }
    return rpcServer;
  }

  function nextSessionId() {
    for (let i = 0; i < 10; i += 1) {
      const candidate = sessionSeed >>> 0;
      sessionSeed = (sessionSeed + 1) >>> 0;
      if (!sessions.has(candidate)) {
        return candidate;
      }
    }
    for (let i = 0; i < 10; i += 1) {
      const candidate = crypto.randomInt(1, 0x100000000);
      if (!sessions.has(candidate)) {
        return candidate;
      }
    }
    throw new Error("unable to allocate session id");
  }

  async function sendSorobanTx(operation) {
    const keypair = getHouseKeypair();
    const server = getRpcServer();
    const account = await server.getAccount(keypair.publicKey());
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(operation)
      .setTimeout(120)
      .build();

    const prepared = await server.prepareTransaction(tx);
    prepared.sign(keypair);
    const sendResult = await server.sendTransaction(prepared);
    if (sendResult.status === "PENDING") {
      const finalResult = await server.pollTransaction(sendResult.hash);
      if (finalResult.status !== "SUCCESS") {
        throw new Error(`Transaction failed: ${finalResult.status}`);
      }
      return finalResult;
    }
    if (sendResult.status !== "SUCCESS") {
      throw new Error(`Transaction failed: ${sendResult.status}`);
    }
    return sendResult;
  }

  async function callGameHubStart({ sessionId, player2 }) {
    if (!gameHubContractId) {
      throw new Error("GAME_HUB_CONTRACT_ID is not configured");
    }
    if (!gameId) {
      throw new Error("GAME_ID is not configured");
    }
    const contract = new Contract(gameHubContractId);
    const operation = contract.call(
      "start_game",
      nativeToScVal(gameId, { type: "address" }),
      nativeToScVal(sessionId, { type: "u32" }),
      nativeToScVal(getHouseAddress(), { type: "address" }),
      nativeToScVal(player2, { type: "address" }),
      nativeToScVal(0n, { type: "i128" }),
      nativeToScVal(0n, { type: "i128" })
    );
    await sendSorobanTx(operation);
  }

  async function callGameHubEnd({ sessionId, player1Won }) {
    if (!gameHubContractId) {
      throw new Error("GAME_HUB_CONTRACT_ID is not configured");
    }
    const contract = new Contract(gameHubContractId);
    const operation = contract.call(
      "end_game",
      nativeToScVal(sessionId, { type: "u32" }),
      nativeToScVal(player1Won, { type: "bool" })
    );
    await sendSorobanTx(operation);
  }

  async function handleGameStart(req, res) {
    const body = await readJsonBody(req, maxBodyBytes);
    if (!body || typeof body !== "object") {
      sendError(res, 400, "missing JSON body");
      return;
    }

    const { player_pubkey } = body;
    if (player_pubkey === undefined) {
      sendError(res, 400, "player_pubkey is required");
      return;
    }

    let playerAddress;
    try {
      playerAddress = parsePlayerAddress(player_pubkey);
    } catch (err) {
      sendError(res, 400, err.message);
      return;
    }

    let sessionId;
    try {
      sessionId = nextSessionId();
      await callGameHubStart({ sessionId, player2: playerAddress });
      sessions.set(sessionId, {
        player: playerAddress,
        used: false,
        createdAt: Date.now(),
      });
    } catch (err) {
      sendError(res, 500, err.message || "start_game failed");
      return;
    }

    sendJson(res, 200, {
      session_id: sessionId,
      game_id: gameId,
      player1_public_key: getHouseAddress(),
      player2_public_key: playerAddress,
      win_score: gameWinScore,
    });
  }

  async function handleGameEnd(req, res) {
    const body = await readJsonBody(req, maxBodyBytes);
    if (!body || typeof body !== "object") {
      sendError(res, 400, "missing JSON body");
      return;
    }

    const { session_id, player_pubkey, score } = body;
    if (session_id === undefined) {
      sendError(res, 400, "session_id is required");
      return;
    }
    if (player_pubkey === undefined) {
      sendError(res, 400, "player_pubkey is required");
      return;
    }
    if (score === undefined) {
      sendError(res, 400, "score is required");
      return;
    }

    const parsedSession = Number(session_id);
    if (
      !Number.isInteger(parsedSession) ||
      parsedSession < 0 ||
      parsedSession > 0xffffffff
    ) {
      sendError(res, 400, "session_id must be a u32");
      return;
    }

    let playerAddress;
    try {
      playerAddress = parsePlayerAddress(player_pubkey);
    } catch (err) {
      sendError(res, 400, err.message);
      return;
    }

    const session = sessions.get(parsedSession);
    if (!session) {
      sendError(res, 404, "session not found");
      return;
    }
    if (session.used) {
      sendError(res, 409, "session already ended");
      return;
    }
    if (session.player !== playerAddress) {
      sendError(res, 403, "player_pubkey does not match session");
      return;
    }

    const parsedScore = Number(score);
    if (!Number.isFinite(parsedScore)) {
      sendError(res, 400, "score must be a number");
      return;
    }

    const player2Won = parsedScore > gameWinScore;
    try {
      await callGameHubEnd({
        sessionId: parsedSession,
        player1Won: !player2Won,
      });
      session.used = true;
    } catch (err) {
      sendError(res, 500, err.message || "end_game failed");
      return;
    }

    sendJson(res, 200, {
      session_id: parsedSession,
      player1_won: !player2Won,
      player2_won: player2Won,
      win_score: gameWinScore,
    });
  }

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

    let sealHex;
    try {
      sealHex = normalizeHex(proveResult.seal_hex, "prover seal");
    } catch (err) {
      sendError(res, 500, err.message || "prover returned invalid seal");
      return;
    }
    if (Number.isFinite(maxSealBytes) && maxSealBytes > 0) {
      const sealBytes = sealHex.length / 2;
      if (sealBytes > maxSealBytes) {
        sendError(
          res,
          500,
          `seal too large (${sealBytes} bytes). Enable Groth16 proving and rebuild typing-proof-host.`
        );
        return;
      }
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

    if (verifierSelectorHex) {
      sealHex = verifierSelectorHex + sealHex;
    }

    sendJson(res, 200, {
      score: proveResult.score,
      wpm_x100: proveResult.wpm_x100,
      accuracy_bps: proveResult.accuracy_bps,
      duration_ms: proveResult.duration_ms,
      image_id_hex: proveResult.image_id_hex,
      journal_sha256_hex: proveResult.journal_sha256_hex,
      seal_hex: sealHex,
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
        if (req.method === "POST" && pathname === "/game/start") {
          await handleGameStart(req, res);
          return;
        }
        if (req.method === "POST" && pathname === "/game/end") {
          await handleGameEnd(req, res);
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
