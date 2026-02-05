import {
  KEY,
  MIN_DT_MS,
  MIN_DURATION_PER_CHAR_MS,
  encodeEvents,
  bytesToBase64,
  computeStats,
  hexToBytes,
} from "./src/replay.mjs";
import { createTimingRecorder } from "./src/timing.mjs";

const el = {
  banner: document.getElementById("banner"),
  walletCreate: document.getElementById("wallet-create"),
  walletClear: document.getElementById("wallet-clear"),
  walletPubkey: document.getElementById("wallet-pubkey"),
  walletSecret: document.getElementById("wallet-secret"),
  walletBalance: document.getElementById("wallet-balance"),
  walletStatus: document.getElementById("wallet-status"),
  challengePrompt: document.getElementById("challenge-prompt"),
  challengeId: document.getElementById("challenge-id"),
  challengeHash: document.getElementById("challenge-hash"),
  challengeReload: document.getElementById("challenge-reload"),
  challengeStart: document.getElementById("challenge-start"),
  typingInput: document.getElementById("typing-input"),
  typingSubmit: document.getElementById("typing-submit"),
  previewWpm: document.getElementById("preview-wpm"),
  previewAccuracy: document.getElementById("preview-accuracy"),
  previewScore: document.getElementById("preview-score"),
  previewDuration: document.getElementById("preview-duration"),
  previewWarnings: document.getElementById("preview-warnings"),
  nameInput: document.getElementById("player-name"),
  submitButton: document.getElementById("submit-score"),
  submitStatus: document.getElementById("submit-status"),
  leaderboardBody: document.getElementById("leaderboard-body"),
  leaderboardStatus: document.getElementById("leaderboard-status"),
  configInfo: document.getElementById("config-info"),
};

const storageKeys = {
  wallet: "typezero-wallet",
  config: "typezero-config",
};

const state = {
  wallet: null,
  challenge: null,
  events: [],
  typed: "",
  stats: null,
  running: false,
  timing: null,
  clampedDt: false,
};

if (!window.StellarSdk) {
  setBanner("Stellar SDK not loaded. Check the frontend server and node_modules.", "error");
}

const config = loadConfig();
const rpcServer = window.StellarSdk
  ? new window.StellarSdk.rpc.Server(config.rpcUrl, {
      allowHttp: config.rpcUrl.startsWith("http://"),
    })
  : null;
const horizonServer = window.StellarSdk
  ? new window.StellarSdk.Horizon.Server(config.horizonUrl, {
      allowHttp: config.horizonUrl.startsWith("http://"),
    })
  : null;
const networkPassphrase = window.StellarSdk
  ? config.networkPassphrase || window.StellarSdk.Networks.TESTNET
  : "";

init();

function init() {
  state.timing = createTimingRecorder(() => performance.now());
  bindEvents();
  loadStoredWallet();
  renderConfig();
  loadChallenge();
}

function bindEvents() {
  el.walletCreate.addEventListener("click", () => void createWallet());
  el.walletClear.addEventListener("click", () => clearWallet());
  el.challengeReload.addEventListener("click", () => loadChallenge());
  el.challengeStart.addEventListener("click", () => startChallenge());
  el.typingInput.addEventListener("keydown", handleKeyDown);
  el.typingSubmit.addEventListener("click", () => finishFromButton());
  el.nameInput.addEventListener("input", () => validateNameInput());
  el.submitButton.addEventListener("click", () => void submitScore());
  window.addEventListener("resize", () => syncTypingInputHeight());
}

function loadConfig() {
  const defaults = {
    backendUrl: "http://localhost:3000",
    rpcUrl: "https://soroban-testnet.stellar.org",
    horizonUrl: "https://horizon-testnet.stellar.org",
    networkPassphrase: window.StellarSdk
      ? window.StellarSdk.Networks.TESTNET
      : "Test SDF Network ; September 2015",
    leaderboardContractId: "",
  };

  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(storageKeys.config) || "{}");
  } catch (err) {
    stored = {};
  }

  const windowOverrides = window.TYPEZERO_CONFIG || {};
  return { ...defaults, ...stored, ...windowOverrides };
}

function renderConfig() {
  const rows = [
    `backend: ${config.backendUrl}`,
    `rpc: ${config.rpcUrl}`,
    `horizon: ${config.horizonUrl}`,
    `contract: ${config.leaderboardContractId || "(missing)"}`,
  ];
  el.configInfo.textContent = rows.join("\n");
  if (!config.leaderboardContractId) {
    setBanner("Leaderboard contract ID missing. Set TYPEZERO_CONFIG or localStorage.", "warn");
  }
}

function setBanner(message, tone) {
  el.banner.textContent = message;
  el.banner.dataset.tone = tone || "info";
  el.banner.style.display = message ? "block" : "none";
}

function setStatus(target, message, tone) {
  target.textContent = message;
  target.dataset.tone = tone || "info";
}

function loadStoredWallet() {
  try {
    const raw = localStorage.getItem(storageKeys.wallet);
    if (!raw) {
      updateWalletUI();
      return;
    }
    state.wallet = JSON.parse(raw);
    updateWalletUI();
    void refreshBalance();
  } catch (err) {
    state.wallet = null;
    updateWalletUI();
  }
}

function saveWallet(wallet) {
  state.wallet = wallet;
  localStorage.setItem(storageKeys.wallet, JSON.stringify(wallet));
  updateWalletUI();
}

function clearWallet() {
  state.wallet = null;
  localStorage.removeItem(storageKeys.wallet);
  updateWalletUI();
  setStatus(el.walletStatus, "Wallet cleared.", "info");
  renderLeaderboard([]);
  setStatus(el.leaderboardStatus, "Create a wallet to load leaderboard.", "warn");
}

function updateWalletUI() {
  const wallet = state.wallet;
  el.walletPubkey.textContent = wallet ? wallet.publicKey : "—";
  el.walletSecret.textContent = wallet ? wallet.secretKey : "—";
  el.walletBalance.textContent = wallet ? "(loading…)" : "—";
  el.walletClear.disabled = !wallet;
  el.challengeStart.disabled = !state.challenge;
  el.submitButton.disabled = !wallet || !state.stats;
}

async function createWallet() {
  setStatus(el.walletStatus, "Creating wallet via backend…", "info");
  try {
    const response = await fetch(`${config.backendUrl}/wallet`, {
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(`wallet request failed (${response.status})`);
    }
    const data = await response.json();
    if (!data.publicKey || !data.secretKey) {
      throw new Error("wallet response missing keys");
    }
    saveWallet({ publicKey: data.publicKey, secretKey: data.secretKey });
    setStatus(el.walletStatus, "Wallet funded on testnet.", "success");
    await refreshBalance();
    await refreshLeaderboard();
  } catch (err) {
    setStatus(el.walletStatus, err.message || "Wallet creation failed.", "error");
  }
}

async function refreshBalance() {
  if (!state.wallet || !horizonServer) {
    return;
  }
  try {
    const account = await horizonServer.loadAccount(state.wallet.publicKey);
    const balance = account.balances.find((item) => item.asset_type === "native");
    el.walletBalance.textContent = balance ? `${balance.balance} XLM` : "0 XLM";
  } catch (err) {
    el.walletBalance.textContent = "unavailable";
  }
}

async function loadChallenge() {
  setStatus(el.walletStatus, "", "info");
  setStatus(el.leaderboardStatus, "Loading challenge…", "info");
  try {
    const response = await fetch(`${config.backendUrl}/challenge/current`);
    if (!response.ok) {
      throw new Error(`challenge fetch failed (${response.status})`);
    }
    const data = await response.json();
    state.challenge = data;
    el.challengePrompt.textContent = data.prompt;
    el.challengeId.textContent = String(data.challenge_id ?? "—");
    el.challengeHash.textContent = data.prompt_hash_hex || "—";
    el.challengeStart.disabled = false;
    resetChallengeState();
    requestAnimationFrame(() => syncTypingInputHeight());
    await refreshLeaderboard();
  } catch (err) {
    setStatus(el.leaderboardStatus, err.message || "Challenge load failed.", "error");
  }
}

function resetChallengeState() {
  state.events = [];
  state.typed = "";
  state.stats = null;
  state.running = false;
  state.timing.reset();
  state.clampedDt = false;
  el.typingInput.value = "";
  el.typingInput.disabled = true;
  el.typingSubmit.disabled = true;
  el.previewWpm.textContent = "—";
  el.previewAccuracy.textContent = "—";
  el.previewScore.textContent = "—";
  el.previewDuration.textContent = "—";
  el.previewWarnings.textContent = "";
  el.submitStatus.textContent = "";
  el.submitButton.disabled = true;
}

function syncTypingInputHeight() {
  const promptHeight = el.challengePrompt ? el.challengePrompt.offsetHeight : 0;
  if (!promptHeight || !el.typingInput) {
    return;
  }
  el.typingInput.style.height = `${promptHeight}px`;
}

function startChallenge() {
  if (!state.challenge) {
    return;
  }
  resetChallengeState();
  state.running = true;
  state.timing.start();
  el.typingInput.disabled = false;
  el.typingInput.focus();
  el.typingSubmit.disabled = false;
  el.challengeStart.disabled = true;
  setStatus(el.leaderboardStatus, "Typing challenge running…", "info");
}

function handleKeyDown(event) {
  if (!state.running) {
    return;
  }
  event.preventDefault();
  const code = mapKeyToReplayCode(event);
  if (code === null) {
    return;
  }

  recordEvent(code);

  if (code === KEY.ENTER) {
    finishChallenge();
  }
}

function finishFromButton() {
  if (!state.running) {
    return;
  }
  recordEvent(KEY.ENTER);
  finishChallenge();
}

function recordEvent(code) {
  let dt = state.timing.record();
  if (dt < MIN_DT_MS) {
    dt = MIN_DT_MS;
    state.clampedDt = true;
  }
  if (dt > 0xffff) {
    dt = 0xffff;
    state.clampedDt = true;
  }

  state.events.push({ dtMs: dt, key: code });
  if (code >= 0 && code <= 25) {
    state.typed += String.fromCharCode(97 + code);
  } else if (code === KEY.SPACE) {
    state.typed += " ";
  } else if (code === KEY.BACKSPACE) {
    state.typed = state.typed.slice(0, -1);
  }
  el.typingInput.value = state.typed;
  el.typingInput.setSelectionRange(state.typed.length, state.typed.length);
}

function mapKeyToReplayCode(event) {
  if (event.key === "Backspace") {
    return KEY.BACKSPACE;
  }
  if (event.key === "Enter") {
    return KEY.ENTER;
  }
  if (event.key === " " || event.code === "Space") {
    return KEY.SPACE;
  }
  if (event.key.length === 1) {
    const lower = event.key.toLowerCase();
    if (lower >= "a" && lower <= "z") {
      return lower.charCodeAt(0) - 97;
    }
  }
  return null;
}

function finishChallenge() {
  if (!state.running) {
    return;
  }
  state.running = false;
  el.typingInput.disabled = true;
  el.typingSubmit.disabled = true;
  el.challengeStart.disabled = false;

  const stats = computeStats(state.challenge.prompt, state.events);
  state.stats = stats;

  const warnings = [];
  const minDt = state.events.reduce((min, event) => Math.min(min, event.dtMs), Infinity);
  if (minDt < MIN_DT_MS) {
    warnings.push(`dt below ${MIN_DT_MS}ms detected (${minDt}ms)`);
  }
  if (state.clampedDt) {
    warnings.push(`dt values clamped to ${MIN_DT_MS}ms minimum`);
  }
  if (stats.durationMs < stats.minDurationMs) {
    warnings.push(
      `duration below minimum (${stats.durationMs}ms < ${stats.minDurationMs}ms)`
    );
  }

  el.previewWpm.textContent = (stats.wpmX100 / 100).toFixed(2);
  el.previewAccuracy.textContent = `${(stats.accuracyBps / 100).toFixed(2)}%`;
  el.previewScore.textContent = stats.score.toString();
  el.previewDuration.textContent = `${stats.durationMs} ms`;
  el.previewWarnings.textContent = warnings.join(" | ");

  validateNameInput();
  setStatus(el.leaderboardStatus, "Replay captured. Ready to submit.", "success");
}

function validateNameInput() {
  const name = el.nameInput.value || "";
  if (name.length === 0) {
    el.nameInput.dataset.invalid = "true";
    el.submitButton.disabled = true;
    if (state.stats) {
      setStatus(el.submitStatus, "Enter a name to submit.", "info");
    }
    return;
  }
  const error = validateName(name);
  if (error) {
    el.nameInput.dataset.invalid = "true";
    el.submitButton.disabled = true;
    setStatus(el.submitStatus, error, "warn");
  } else {
    el.nameInput.dataset.invalid = "false";
    if (state.stats && state.wallet) {
      el.submitButton.disabled = false;
    }
  }
}

function validateName(name) {
  if (name.length < 1 || name.length > 24) {
    return "Name must be 1–24 characters.";
  }
  for (let i = 0; i < name.length; i += 1) {
    const code = name.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) {
      return "Name must use printable ASCII only.";
    }
  }
  return "";
}

async function submitScore() {
  if (!state.wallet || !state.challenge || !state.stats) {
    setStatus(el.submitStatus, "Play the challenge before submitting.", "warn");
    return;
  }
  if (state.stats.durationMs < state.stats.minDurationMs) {
    setStatus(
      el.submitStatus,
      `Duration too short (${state.stats.durationMs}ms < ${state.stats.minDurationMs}ms).`,
      "warn"
    );
    return;
  }
  if (!config.leaderboardContractId) {
    setStatus(el.submitStatus, "Missing leaderboard contract ID.", "error");
    return;
  }
  const name = el.nameInput.value.trim();
  const nameError = validateName(name);
  if (nameError) {
    setStatus(el.submitStatus, nameError, "warn");
    return;
  }

  el.submitButton.disabled = true;
  setStatus(el.submitStatus, "Generating proof via backend…", "info");

  try {
    const eventsBytes = encodeEvents(state.events);
    const eventsBase64 = bytesToBase64(eventsBytes);

    const proveResponse = await fetch(`${config.backendUrl}/prove`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        challenge_id: state.challenge.challenge_id,
        player_pubkey: state.wallet.publicKey,
        prompt: state.challenge.prompt,
        events_bytes_base64: eventsBase64,
      }),
    });

    if (!proveResponse.ok) {
      const text = await proveResponse.text();
      throw new Error(text || `prove failed (${proveResponse.status})`);
    }

    const proof = await proveResponse.json();
    const normalizedProof = {
      score: Number(proof.score),
      wpm_x100: Number(proof.wpm_x100),
      accuracy_bps: Number(proof.accuracy_bps),
      duration_ms: Number(proof.duration_ms),
      image_id_hex: proof.image_id_hex,
      journal_sha256_hex: proof.journal_sha256_hex,
      seal_hex: proof.seal_hex,
    };

    if (!Number.isFinite(normalizedProof.score)) {
      throw new Error("prove response missing score");
    }

    setStatus(el.submitStatus, "Submitting to Soroban testnet…", "info");
    await submitSorobanTx(name, normalizedProof);

    setStatus(el.submitStatus, "Score submitted. Refreshing leaderboard…", "success");
    await refreshLeaderboard();
  } catch (err) {
    setStatus(el.submitStatus, err.message || "Submission failed.", "error");
  } finally {
    if (state.wallet) {
      el.submitButton.disabled = false;
    }
  }
}

async function submitSorobanTx(name, proof) {
  if (!rpcServer || !window.StellarSdk) {
    throw new Error("RPC server unavailable");
  }

  const keypair = window.StellarSdk.Keypair.fromSecret(state.wallet.secretKey);
  const account = await rpcServer.getAccount(state.wallet.publicKey);
  const contract = new window.StellarSdk.Contract(config.leaderboardContractId);

  const tx = new window.StellarSdk.TransactionBuilder(account, {
    fee: window.StellarSdk.BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      contract.call(
        "submit_score",
        window.StellarSdk.nativeToScVal(state.challenge.challenge_id, { type: "u32" }),
        window.StellarSdk.nativeToScVal(state.wallet.publicKey, { type: "address" }),
        window.StellarSdk.nativeToScVal(name, { type: "string" }),
        window.StellarSdk.nativeToScVal(hexToBytes(state.challenge.prompt_hash_hex), {
          type: "bytes",
        }),
        window.StellarSdk.nativeToScVal(BigInt(proof.score), { type: "u64" }),
        window.StellarSdk.nativeToScVal(proof.wpm_x100, { type: "u32" }),
        window.StellarSdk.nativeToScVal(proof.accuracy_bps, { type: "u32" }),
        window.StellarSdk.nativeToScVal(proof.duration_ms, { type: "u32" }),
        window.StellarSdk.nativeToScVal(hexToBytes(proof.journal_sha256_hex), {
          type: "bytes",
        }),
        window.StellarSdk.nativeToScVal(hexToBytes(proof.image_id_hex), { type: "bytes" }),
        window.StellarSdk.nativeToScVal(hexToBytes(proof.seal_hex), { type: "bytes" })
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
}

async function refreshLeaderboard() {
  if (!state.challenge) {
    return;
  }
  if (!config.leaderboardContractId) {
    setStatus(el.leaderboardStatus, "Set leaderboard contract ID to load scores.", "warn");
    return;
  }
  if (!rpcServer) {
    setStatus(el.leaderboardStatus, "RPC server unavailable.", "error");
    return;
  }
  if (!state.wallet) {
    setStatus(el.leaderboardStatus, "Create a wallet to load leaderboard.", "warn");
    return;
  }

  try {
    const account = await rpcServer.getAccount(state.wallet.publicKey);
    const contract = new window.StellarSdk.Contract(config.leaderboardContractId);
    const tx = new window.StellarSdk.TransactionBuilder(account, {
      fee: window.StellarSdk.BASE_FEE,
      networkPassphrase,
    })
      .addOperation(
        contract.call(
          "get_top",
          window.StellarSdk.nativeToScVal(state.challenge.challenge_id, { type: "u32" })
        )
      )
      .setTimeout(60)
      .build();

    const sim = await rpcServer.simulateTransaction(tx);
    const parsed = window.StellarSdk.rpc.parseRawSimulation(sim);
    if (parsed.error) {
      throw new Error(parsed.error);
    }

    const rows = window.StellarSdk.scValToNative(parsed.result.retval);
    renderLeaderboard(Array.isArray(rows) ? rows : []);
    setStatus(el.leaderboardStatus, "Leaderboard loaded.", "success");
  } catch (err) {
    setStatus(el.leaderboardStatus, err.message || "Leaderboard load failed.", "error");
  }
}

function renderLeaderboard(rows) {
  el.leaderboardBody.innerHTML = "";
  if (!rows.length) {
    const empty = document.createElement("tr");
    empty.innerHTML = '<td colspan="6">No scores yet.</td>';
    el.leaderboardBody.appendChild(empty);
    return;
  }

  rows.forEach((row, index) => {
    const tr = document.createElement("tr");
    const wpm = (row.wpm_x100 / 100).toFixed(2);
    const acc = (row.accuracy_bps / 100).toFixed(2);
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td class="mono">${row.player}</td>
      <td>${row.name}</td>
      <td>${row.score}</td>
      <td>${wpm}</td>
      <td>${acc}%</td>
    `;
    el.leaderboardBody.appendChild(tr);
  });
}
