const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

function resolveProverBin(explicitPath) {
  const candidate = explicitPath
    ? path.resolve(explicitPath)
    : path.resolve(
        __dirname,
        "..",
        "risc0",
        "typing_proof",
        "target",
        "release",
        "typing-proof-host"
      );
  if (!fs.existsSync(candidate)) {
    throw new Error(
      `typing-proof-host binary not found at ${candidate}. Build it with: cargo build --release -p typing-proof-host`
    );
  }
  return candidate;
}

function runProcess(bin, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: options.cwd,
      env: options.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      reject(err);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `prover exited with code ${code}`));
        return;
      }
      resolve(stdout);
    });
  });
}

function parseProverOutput(stdout) {
  const lines = stdout.trim().split(/\r?\n/);
  const out = {};
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx === -1) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    out[key] = value;
  }

  const score = Number.parseInt(out["journal.score"], 10);
  const wpm_x100 = Number.parseInt(out["journal.wpm_x100"], 10);
  const accuracy_bps = Number.parseInt(out["journal.accuracy_bps"], 10);
  const duration_ms = Number.parseInt(out["journal.duration_ms"], 10);

  if (!Number.isFinite(score)) {
    throw new Error("prover output missing journal.score");
  }

  return {
    image_id_hex: out["image_id"],
    seal_hex: out["seal"],
    journal_sha256_hex: out["journal_sha256"],
    journal_prompt_hash_hex: out["journal.prompt_hash"],
    journal_player_pubkey_hex: out["journal.player_pubkey"],
    journal_challenge_id: Number.parseInt(out["journal.challenge_id"], 10),
    score,
    wpm_x100,
    accuracy_bps,
    duration_ms,
  };
}

async function proveWithHost(params) {
  const {
    challengeId,
    playerPubkey,
    prompt,
    eventsBytes,
    proverBin,
  } = params;
  if (!Buffer.isBuffer(playerPubkey) || playerPubkey.length !== 32) {
    throw new Error("playerPubkey must be 32 bytes");
  }
  if (!Buffer.isBuffer(eventsBytes)) {
    throw new Error("eventsBytes must be a buffer");
  }

  const bin = resolveProverBin(proverBin || process.env.TYPING_PROOF_HOST_BIN);
  const args = [
    String(challengeId),
    playerPubkey.toString("hex"),
    prompt,
    eventsBytes.toString("hex"),
  ];

  const env = { ...process.env };
  if (!env.TYPING_PROOF_RECEIPT_KIND) {
    env.TYPING_PROOF_RECEIPT_KIND = "groth16";
  }
  if (!env.RISC0_PROVER) {
    env.RISC0_PROVER = "local";
  }
  const stdout = await runProcess(bin, args, { env });
  return parseProverOutput(stdout);
}

module.exports = {
  parseProverOutput,
  proveWithHost,
  resolveProverBin,
};
