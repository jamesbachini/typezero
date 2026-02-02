# TypeZERO | ZK-Verified Typing Challenge 🚀⌨️

A provably fair typing game built on Stellar blockchain using RiscZero zero-knowledge proofs. Compete in daily challenges where your scores are cryptographically verified—no trust required.

## 🎯 Overview

This project demonstrates the integration of **RiscZero zkVM** with **Stellar's Soroban smart contracts** to create a gaming experience where player scores are mathematically proven, not just claimed. Every keystroke is recorded locally, condensed into a compact replay, and verified through zero-knowledge proofs before being accepted on-chain.

### Key Features

- **Daily Challenges**: New typing prompts every day
- **Zero-Knowledge Proofs**: Scores are cryptographically proven using RiscZero
- **On-Chain Leaderboards**: Immutable rankings stored on Stellar testnet
- **No Backend Trust**: The backend can't cheat—proofs enforce correctness
- **Deterministic Scoring**: Same replay always produces the same score

> **Note:** Proof verification is stubbed on testnet; swap to the real verifier on futurenet when bn254 is available.

## 🏗️ Architecture

```
┌─────────────┐
│   Browser   │
│  (Frontend) │
└──────┬──────┘
       │ Records replay
       ├──────────────────┐
       │                  │
       v                  v
┌──────────────┐   ┌─────────────────┐
│   Backend    │   │  Stellar Chain  │
│ Proving Svc  │   │    (Testnet)   │
└──────┬───────┘   └────────┬────────┘
       │                    │
       │ Generates proof    │
       │                    │
       v                    v
┌──────────────┐   ┌─────────────────┐
│ RiscZero VM  │   │ Soroban Smart   │
│    (Guest)   │   │   Contracts     │
└──────────────┘   └─────────────────┘
       │                    │
       │                    ├─ Verifier Contract
       └────────────────────┼─ Leaderboard Contract
                            └─ Challenge Registry
```

### Components

1. **Frontend** (`/frontend`)
   - Vanilla JS typing test UI
   - Replay recording + preview stats
   - Leaderboard display
   - Demo wallet integration

2. **RiscZero Guest Program** (`/risc0/typing_proof/methods/guest`)
   - Validates replay events
   - Enforces anti-cheat constraints
   - Computes WPM and accuracy
   - Commits public outputs to journal

3. **Backend Proving Service** (`/backend`)
   - Receives replay data
   - Runs RiscZero host to generate proofs
   - Returns proof artifacts (seal, journal hash, image ID)

4. **Soroban Contracts** (`/contracts`)
   - **Leaderboard Contract**: Manages challenges, scores, and rankings
   - **Verifier Contract**: Groth16 proof verification (deployed from Nethermind)

## 🎮 How It Works

### Playing the Game

1. **Create Wallet**: Generate a demo wallet via backend (testnet only)
2. **Start Challenge**: View today's prompt and begin typing
3. **Record Replay**: Every keystroke and timing is captured locally
4. **Generate Proof**: Submit replay to backend for ZK proof generation
5. **Submit On-Chain**: Sign transaction to submit verified score
6. **View Leaderboard**: Rankings update automatically

### The ZK Magic

**What gets proven:**

> Given a `challenge_id` and `prompt_hash`, the player possesses a replay that:
> - Reconstructs text matching the prompt hash
> - Satisfies all timing constraints (no instant typing!)
> - Produces the claimed WPM, accuracy, and score through deterministic computation

**Public Outputs Committed:**
- Challenge ID
- Player address
- Prompt hash
- Final score
- WPM (×100 for precision)
- Accuracy (basis points)
- Duration (milliseconds)
- Replay hash (for auditability)

### Anti-Cheat Constraints

The ZK guest program enforces:

- **Minimum keystroke interval**: ≥10ms between keys
- **Minimum total duration**: Based on prompt length (~40ms/char)

## 🚀 Quick Start

### Prerequisites

```bash
# Required
- Node.js 18+
- Rust 1.75+
- RiscZero toolchain
- Stellar CLI (soroban-cli)
- Docker (for backend)
```

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/zk-typing-challenge.git
cd zk-typing-challenge

# Install frontend dependencies
cd frontend
npm install

# Build contracts
cd ../contracts/leaderboard
cargo build --target wasm32-unknown-unknown --release

# Build RiscZero guest
cd ../../risc0/typing_proof
cargo build --release

# Build RiscZero host binary (used by backend prover)
cargo build --release -p typing-proof-host

# Setup backend
cd ../../backend
npm install  # or cargo build if Rust-based
```

### One-Command Local Dev

```bash
make dev
```

This starts the backend on `http://localhost:3000` and the frontend on `http://localhost:5173`.

### Local Development (manual)

```bash
# Terminal 1: Start backend
cd backend
npm run dev  # starts on localhost:3000

# Terminal 2: Deploy contracts to Testnet
cd contracts/leaderboard
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/leaderboard.wasm \
  --network testnet

# Terminal 3: Start frontend
cd frontend
npm run dev  # starts on localhost:5173
```

### Backend (Prover) Notes

- Ensure the RiscZero host binary exists at `risc0/typing_proof/target/release/typing-proof-host` (or set `TYPING_PROOF_HOST_BIN`).
- `/wallet` uses Stellar testnet Friendbot; it will fail if Friendbot is unavailable.

### Configuration

Frontend config is runtime-only (no build step). Use `window.TYPEZERO_CONFIG` in the
browser console or a localStorage override:

```js
localStorage.setItem(
  "typezero-config",
  JSON.stringify({
    backendUrl: "http://localhost:3000",
    rpcUrl: "https://soroban-testnet.stellar.org",
    horizonUrl: "https://horizon-testnet.stellar.org",
    leaderboardContractId: "C..."
  })
);
```

Backend config uses `.env`:

**Backend** (`backend/.env`):
```env
PORT=3000
CHALLENGE_ID=1
CHALLENGE_PROMPT=the quick brown fox jumps over the lazy dog
FRIENDBOT_URL=https://friendbot.stellar.org
# Optional: override prover binary path
TYPING_PROOF_HOST_BIN=../risc0/typing_proof/target/release/typing-proof-host
```

## 📝 Tech Stack

### Blockchain
- **Stellar Soroban SDK**: `25.0.2`
- **Network**: Testnet (proof verification stubbed)
- **stellar-contract-utils**: `0.6.0`
- **@stellar/stellar-sdk**: `14.5.0`

### Zero-Knowledge
- **RiscZero**: zkVM for proof generation
- **Groth16**: Proof system (via Nethermind verifier)
- **Proof Artifacts**: Seal, journal hash, image ID

### Frontend
- Vanilla JS + static HTML
- Stellar SDK (browser build)
- Demo wallet integration

### Backend
- Node.js HTTP server
- RiscZero host environment

## 🔐 Security Model

### Trustless Design

**The backend cannot cheat because:**
- Proofs are generated using fixed RiscZero image ID
- On testnet, proof verification is stubbed (use futurenet for real verification)
- Only the player's address can submit their own proof
- Replay determinism ensures same inputs → same outputs

**What the backend CAN do:**
- Refuse to generate proofs (DoS)
- Be slow or rate-limit

**What the backend CANNOT do:**
- Submit fake scores when real verification is enabled (not on testnet)
- Submit on behalf of another player (address mismatch)
- Modify replay results (breaks proof)

### Proof Binding

Scores are bound to submitter by:
1. Player address committed in ZK journal
2. Contract enforces `invoker == player` on submission
3. Image ID verification prevents proof substitution

## 📊 Scoring Algorithm

### Deterministic Computation

```rust
// WPM Calculation
gross_wpm = (typed_chars / 5) / (duration_ms / 60000)
wpm_x100 = (gross_wpm * 100) as u32  // Fixed point

// Accuracy
correct_chars = count_matching(typed, prompt)
accuracy_bps = (correct_chars * 10000) / prompt_len

// Final Score (scaled integer)
score = (wpm_x100 * accuracy_bps) / 10000
```

All arithmetic uses integer math to ensure consistency across RiscZero guest and all verification layers.

## 🎯 API Reference

### Backend Endpoints

#### `POST /wallet`
Creates a Stellar testnet keypair and funds it via Friendbot (demo-only).

**Response:**
```json
{
  "publicKey": "G...",
  "secretKey": "S..."
}
```

#### `GET /challenge/current`
Returns current daily challenge.

**Response:**
```json
{
  "challenge_id": 42,
  "prompt": "the quick brown fox jumps over the lazy dog",
  "prompt_hash_hex": "..."
}
```

#### `POST /prove`
Generates ZK proof for replay.

**Request:**
```json
{
  "challenge_id": 42,
  "player_pubkey": "GA...",
  "prompt": "the quick brown fox jumps over the lazy dog",
  "events_bytes_base64": "..."
}
```

**Response:**
```json
{
  "score": 85420,
  "wpm_x100": 7250,
  "accuracy_bps": 9800,
  "duration_ms": 12450,
  "image_id_hex": "...",
  "journal_sha256_hex": "...",
  "seal_hex": "..."
}
```

### Smart Contract Methods

#### `submit_score`
Submit a verified score to the leaderboard.

```rust
fn submit_score(
    env: Env,
    challenge_id: u32,
    player: Address,
    name: String,
    prompt_hash: BytesN<32>,
    score: u64,
    wpm_x100: u32,
    accuracy_bps: u32,
    duration_ms: u32,
    journal_hash: BytesN<32>,
    image_id: BytesN<32>,
    seal: Bytes
)
```

#### `get_top`
Retrieve top N players for a challenge.

```rust
fn get_top(env: Env, challenge_id: u32) -> Vec<LeaderboardRow>
```

#### `get_best`
Get a player's best score for a challenge.

```rust
fn get_best(env: Env, challenge_id: u32, player: Address) -> Option<ScoreEntry>
```

## 🧪 Testing

### Full Suite (recommended)
```bash
make test
```

### Frontend Unit Tests
```bash
cd frontend
npm test
```

### Backend Tests
```bash
cd backend
npm test
```

### E2E Smoke Test
```bash
# Ensure the backend is running and the contract is deployed.
LEADERBOARD_CONTRACT_ID=C... \
node scripts/e2e-smoke.mjs
```

### Test Scenarios

- ✅ Valid replay with good timing → proof accepted
- ✅ Replay with dt < MIN_DT → proof generation fails
- ✅ Wrong prompt hash → contract rejects
- ✅ Image ID mismatch → contract rejects
- ✅ Player != invoker → contract rejects
- ✅ Improved score updates leaderboard
- ✅ Top N list maintains sort order

## 📦 Deployment

### Testnet Deployment Steps

> Proof verification is stubbed on testnet; use any valid `verifier_id` address and
> keep `image_id` aligned with the prover output. Swap to the real verifier on
> futurenet when bn254 is available.

1. **Deploy Leaderboard Contract**
```bash
cd contracts/leaderboard
cargo build --target wasm32-unknown-unknown --release

soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/leaderboard.wasm \
  --network testnet
```

2. **Initialize Leaderboard**
```bash
soroban contract invoke \
  --id C... \
  --network testnet \
  -- init \
  --verifier_id G... \
  --image_id 0x... \
  --admin G...
```

3. **Set First Challenge**
```bash
soroban contract invoke \
  --id C... \
  --network testnet \
  -- set_challenge \
  --challenge_id 1 \
  --prompt_hash 0x...

soroban contract invoke \
  --id C... \
  --network testnet \
  -- set_current_challenge \
  --challenge_id 1
```


## 🤝 Contributing

Contributions welcome! This is a demo project showcasing RiscZero + Stellar integration.

### Development Guidelines

1. Keep guest program minimal (proof generation time)
2. All timing constraints must be generous (avoid false rejections)
3. Maintain determinism (same replay → same score)
4. Document any changes to public output schema

## 📄 License

MIT License - see LICENSE file


**Built with ❤️ to demonstrate the power of zero-knowledge proofs on Stellar blockchain**
