import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import promptModule from "../backend/prompt.js";

const { promptHashHex } = promptModule;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const DEFAULT_CHALLENGE_ID = 1;
const DEFAULT_CHALLENGE_PROMPT =
  "the quick brown fox jumps over the lazy dog";
const DEFAULT_BACKEND_URL = "http://localhost:3000";
const DEFAULT_RPC_URL = "https://soroban-testnet.stellar.org";
const DEFAULT_HORIZON_URL = "https://horizon-testnet.stellar.org";
const DEFAULT_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
const DEFAULT_VERIFIER_REPO =
  "https://github.com/NethermindEth/stellar-risc0-verifier";
const DEFAULT_VERIFIER_COMMIT = "11b5b2d59143ff9153dfeb62e63fdfcecfaf0016";
const DEFAULT_VERIFIER_PACKAGE = "groth16-verifier";

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const output = options.capture
      ? `\n${(result.stdout || "").trim()}\n${(result.stderr || "").trim()}`.trim()
      : "";
    const suffix = options.hint ? `\n${options.hint}` : "";
    throw new Error(
      `command failed: ${cmd} ${args.join(" ")}${output ? `\n${output}` : ""}${suffix}`
    );
  }
  return result;
}

function capture(cmd, args, options = {}) {
  const result = run(cmd, args, { ...options, capture: true });
  return `${result.stdout || ""}${result.stderr || ""}`.trim();
}

function loadConfigFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const content = fs.readFileSync(filePath, "utf8").trim();
  if (!content) {
    return {};
  }
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(
      `Invalid JSON in ${filePath}: ${err.message || "parse error"}`
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Config file ${filePath} must contain a JSON object.`);
  }
  return parsed;
}

function writeConfigFile(filePath, config) {
  const stable = {};
  for (const key of Object.keys(config).sort()) {
    stable[key] = config[key];
  }
  fs.writeFileSync(filePath, `${JSON.stringify(stable, null, 2)}\n`);
}

function upsertConfigFile(filePath, updates) {
  const current = loadConfigFile(filePath);
  const next = { ...current, ...updates };
  writeConfigFile(filePath, next);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function findVerifierRepoDir(cacheRoot, commit) {
  const expected = path.join(cacheRoot, `stellar-risc0-verifier-${commit}`);
  if (fs.existsSync(path.join(expected, "Cargo.toml"))) {
    return expected;
  }

  if (!fs.existsSync(cacheRoot)) {
    return null;
  }

  const candidates = fs
    .readdirSync(cacheRoot)
    .filter((entry) => entry.startsWith("stellar-risc0-verifier-"))
    .map((entry) => path.join(cacheRoot, entry))
    .filter((entryPath) => {
      try {
        return (
          fs.statSync(entryPath).isDirectory() &&
          fs.existsSync(path.join(entryPath, "Cargo.toml"))
        );
      } catch (_err) {
        return false;
      }
    });

  if (candidates.length === 1) {
    return candidates[0];
  }

  return null;
}

function ensureVerifierSource(repoUrl, commit) {
  const cacheRoot = path.join(repoRoot, "scripts", ".cache");
  ensureDir(cacheRoot);

  const existing = findVerifierRepoDir(cacheRoot, commit);
  if (existing) {
    return existing;
  }

  const tarPath = path.join(cacheRoot, `stellar-risc0-verifier-${commit}.tar.gz`);
  const tarUrl = `${repoUrl}/archive/${commit}.tar.gz`;
  run("curl", ["-sSfL", tarUrl, "-o", tarPath]);
  run("tar", ["-xzf", tarPath, "-C", cacheRoot]);

  const extracted = findVerifierRepoDir(cacheRoot, commit);
  if (!extracted) {
    throw new Error("Unable to locate extracted verifier repository.");
  }

  return extracted;
}

function buildVerifier(verifierRepo) {
  run("stellar", [
    "contract",
    "build",
    "--manifest-path",
    path.join(verifierRepo, "Cargo.toml"),
    "--package",
    DEFAULT_VERIFIER_PACKAGE,
  ]);
}

function resolveVerifierWasm(verifierRepo) {
  const wasmName = "groth16_verifier.wasm";
  const candidates = [
    path.join(
      verifierRepo,
      "target",
      "wasm32v1-none",
      "release",
      wasmName
    ),
    path.join(
      verifierRepo,
      "target",
      "wasm32-unknown-unknown",
      "release",
      wasmName
    ),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`Unable to find verifier wasm (${wasmName}).`);
}

function readSelectorHex(verifierRepo) {
  const buildRoots = [
    path.join(verifierRepo, "target", "wasm32v1-none", "release", "build"),
    path.join(
      verifierRepo,
      "target",
      "wasm32-unknown-unknown",
      "release",
      "build"
    ),
  ];
  for (const buildRoot of buildRoots) {
    if (!fs.existsSync(buildRoot)) {
      continue;
    }
    const entries = fs.readdirSync(buildRoot);
    for (const entry of entries) {
      if (
        !entry.startsWith("groth16-verifier-") &&
        !entry.startsWith("groth16_verifier-")
      ) {
        continue;
      }
      const selectorPath = path.join(buildRoot, entry, "out", "selector.rs");
      if (!fs.existsSync(selectorPath)) {
        continue;
      }
      const contents = fs.readFileSync(selectorPath, "utf8");
      const matches = contents.match(/0x[0-9a-fA-F]{2}/g);
      if (!matches || matches.length < 4) {
        continue;
      }
      return matches
        .slice(0, 4)
        .map((m) => m.slice(2).toLowerCase())
        .join("");
    }
  }
  throw new Error("Unable to read verifier selector bytes from build output.");
}

function resolveIdentity() {
  return (
    process.env.STELLAR_IDENTITY ||
    process.env.SOROBAN_IDENTITY ||
    "typezero-dev"
  );
}

function ensureIdentity(identity) {
  let exists = false;
  try {
    const output = capture("stellar", ["keys", "ls"]);
    if (
      output
        .split(/\r?\n/)
        .some((line) => line.trim().split(/\s+/)[0] === identity)
    ) {
      exists = true;
    }
  } catch (_err) {
    // fall through
  }
  if (!exists) {
    run(
      "stellar",
      ["keys", "generate", identity, "--fund", "--network", "testnet"],
      {
        capture: true,
        hint:
          "Failed to generate stellar identity. Create one manually or set STELLAR_ADMIN.",
      }
    );
  }

  try {
    capture("stellar", ["keys", "fund", identity, "--network", "testnet"]);
  } catch (err) {
    console.warn(
      `Warning: unable to fund identity ${identity} on testnet. Deploy may fail.\n${
        err.message || err
      }`
    );
  }
}

function resolveAdminAddress(identity) {
  if (process.env.STELLAR_ADMIN || process.env.SOROBAN_ADMIN) {
    return process.env.STELLAR_ADMIN || process.env.SOROBAN_ADMIN;
  }
  try {
    const output = capture("stellar", ["keys", "public-key", identity]);
    const match = output.match(/G[A-Z2-7]{55}/);
    if (match) {
      return match[0];
    }
  } catch (_err) {
    // handled below
  }
  throw new Error(
    "Unable to resolve admin address. Set STELLAR_ADMIN or ensure the stellar identity exists."
  );
}

function parseContractId(output) {
  const match = output.match(/C[A-Z2-7]{55}/);
  if (!match) {
    throw new Error("Unable to parse contract ID from soroban output.");
  }
  return match[0];
}

function parseImageId(output) {
  const match = output.match(/image_id:\s*([0-9a-fA-F]{64})/);
  if (!match) {
    throw new Error("Unable to parse image_id from image-id output.");
  }
  return match[1].toLowerCase();
}

function ensureBinary(bin) {
  try {
    run(bin, ["--version"], { capture: true });
  } catch (_err) {
    throw new Error(`Missing required binary: ${bin}`);
  }
}

async function main() {
  ensureBinary("cargo");
  ensureBinary("stellar");
  ensureBinary("curl");
  ensureBinary("tar");

  const backendConfig = loadConfigFile(
    path.join(repoRoot, "backend", "config.json")
  );
  const challengeId = Number(
    process.env.CHALLENGE_ID ||
      backendConfig.CHALLENGE_ID ||
      DEFAULT_CHALLENGE_ID
  );
  const challengePrompt =
    process.env.CHALLENGE_PROMPT ||
    backendConfig.CHALLENGE_PROMPT ||
    DEFAULT_CHALLENGE_PROMPT;
  if (!Number.isInteger(challengeId) || challengeId < 0) {
    throw new Error("CHALLENGE_ID must be a non-negative integer.");
  }

  const identity = resolveIdentity();
  ensureIdentity(identity);
  const adminAddress = resolveAdminAddress(identity);
  const verifierIdEnv =
    process.env.STELLAR_VERIFIER_ID || process.env.SOROBAN_VERIFIER_ID;
  let selectorHex = process.env.VERIFIER_SELECTOR_HEX || "";
  let verifierId = verifierIdEnv || "";

  if (!verifierId) {
    const verifierRepo = ensureVerifierSource(
      process.env.VERIFIER_REPO || DEFAULT_VERIFIER_REPO,
      process.env.VERIFIER_COMMIT || DEFAULT_VERIFIER_COMMIT
    );
    buildVerifier(verifierRepo);
    const verifierWasm = resolveVerifierWasm(verifierRepo);
    if (!selectorHex) {
      selectorHex = readSelectorHex(verifierRepo);
    }
    verifierId = parseContractId(
      capture("stellar", [
        "contract",
        "deploy",
        "--wasm",
        verifierWasm,
        "--network",
        "testnet",
        "--source-account",
        identity,
      ])
    );
  } else if (!selectorHex) {
    throw new Error(
      "VERIFIER_SELECTOR_HEX must be set when STELLAR_VERIFIER_ID is provided."
    );
  }

  const leaderboardDir = path.join(repoRoot, "contracts", "leaderboard");
  run("stellar", ["contract", "build"], { cwd: leaderboardDir });

  const wasmPath = path.join(
    leaderboardDir,
    "target",
    "wasm32v1-none",
    "release",
    "leaderboard.wasm"
  );
  if (!fs.existsSync(wasmPath)) {
    throw new Error(`Wasm not found at ${wasmPath}`);
  }

  const risc0Dir = path.join(repoRoot, "risc0", "typing_proof");
  const imageIdOutput = capture(
    "cargo",
    ["run", "-p", "typing-proof-host", "--bin", "image-id", "--release"],
    { cwd: risc0Dir }
  );
  const imageIdHex = parseImageId(imageIdOutput);

  const deployOutput = capture("stellar", [
    "contract",
    "deploy",
    "--wasm",
    wasmPath,
    "--network",
    "testnet",
    "--source-account",
    identity,
  ]);
  const contractId = parseContractId(deployOutput);

  const promptHashHexValue = promptHashHex(challengePrompt);

  run("stellar", [
    "contract",
    "invoke",
    "--id",
    contractId,
    "--network",
    "testnet",
    "--source-account",
    identity,
    "--",
    "init",
    "--admin",
    adminAddress,
    "--verifier_id",
    verifierId,
    "--image_id",
    imageIdHex,
  ]);

  if (selectorHex) {
    upsertConfigFile(path.join(repoRoot, "backend", "config.json"), {
      VERIFIER_SELECTOR_HEX: selectorHex,
    });
  }

  run("stellar", [
    "contract",
    "invoke",
    "--id",
    contractId,
    "--network",
    "testnet",
    "--source-account",
    identity,
    "--",
    "set_challenge",
    "--challenge_id",
    String(challengeId),
    "--prompt_hash",
    promptHashHexValue,
  ]);

  run("stellar", [
    "contract",
    "invoke",
    "--id",
    contractId,
    "--network",
    "testnet",
    "--source-account",
    identity,
    "--",
    "set_current_challenge",
    "--challenge_id",
    String(challengeId),
  ]);

  const configPath = path.join(repoRoot, "frontend", "config.local.js");
  const configPayload = {
    backendUrl: process.env.BACKEND_URL || DEFAULT_BACKEND_URL,
    rpcUrl: process.env.RPC_URL || DEFAULT_RPC_URL,
    horizonUrl: process.env.HORIZON_URL || DEFAULT_HORIZON_URL,
    networkPassphrase: process.env.NETWORK_PASSPHRASE || DEFAULT_NETWORK_PASSPHRASE,
    leaderboardContractId: contractId,
  };
  const configBody = `window.TYPEZERO_CONFIG = Object.assign(window.TYPEZERO_CONFIG || {}, ${JSON.stringify(
    configPayload,
    null,
    2
  )});\n`;
  fs.writeFileSync(configPath, configBody, "utf8");

  console.log(`Deployed leaderboard contract: ${contractId}`);
  console.log(`Wrote frontend config: ${path.relative(repoRoot, configPath)}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
