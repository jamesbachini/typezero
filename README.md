# TypeZERO | ZK-Verified Typing Challenge 🚀⌨️

A provably fair typing game built on Stellar blockchain using RiscZero zero-knowledge proofs. Compete in daily challenges where your scores are cryptographically verified—no trust required.

## 🎯 Overview

This project demonstrates the integration of **RiscZero zkVM** with **Stellar's Soroban smart contracts** to create a gaming experience where player scores are mathematically proven, not just claimed. Every keystroke is recorded locally, condensed into a compact replay, and verified through zero-knowledge proofs before being accepted on-chain.

### Key Features

- **Daily Challenges**: New typing prompts every day
- **Zero-Knowledge Proofs**: Scores are cryptographically proven using RiscZero
- **On-Chain Leaderboards**: Immutable rankings stored on Stellar (Testnet)
- **No Backend Trust**: The backend can't cheat—proofs enforce correctness
- **Deterministic Scoring**: Same replay always produces the same score

> **Note:** Proof verification calls the Nethermind Groth16 verifier contract. Deploy on Testnet and set `VERIFIER_SELECTOR_HEX` (4 bytes, hex) so the backend prefixes the seal before submission.

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
│ Proving Svc  │   │    (Testnet)    │
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
- Stellar CLI (`stellar`)
- Docker (for backend)
```

### Installation

```bash
# Clone the repository
git clone https://github.com/jamesbachini/typezero/typezero.git
cd typezero
make dev
```

Starts frontend server on http://localhost:5173

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

Backend config uses `backend/config.json` (env vars still override at runtime):

**Backend** (`backend/config.json`):
```json
{
  "PORT": 3000,
  "CHALLENGE_ID": 1,
  "CHALLENGE_PROMPT": "the quick brown fox jumps over the lazy dog",
  "FRIENDBOT_URL": "https://friendbot.stellar.org",
  "TYPING_PROOF_HOST_BIN": "../risc0/typing_proof/target/release/typing-proof-host",
  "VERIFIER_SELECTOR_HEX": "00000000"
}
```

## 📝 Tech Stack

### Blockchain
- **Stellar Soroban SDK**: `25.0.2`
- **Network**: Testnet (Groth16 verification)
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
- Proof verification is enforced by the verifier contract
- Only the player's address can submit their own proof
- Replay determinism ensures same inputs → same outputs

**What the backend CAN do:**
- Refuse to generate proofs (DoS)
- Be slow or rate-limit

**What the backend CANNOT do:**
- Submit fake scores when verification is enabled
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

> Proof verification calls the Nethermind Groth16 verifier. Deploy it first,
> query its 4-byte selector, and set `VERIFIER_SELECTOR_HEX` in the backend
> so the seal is prefixed correctly.

1. **Deploy Leaderboard Contract**
```bash
cd contracts/leaderboard
stellar contract build

stellar contract deploy \
  --wasm target/wasm32v1-none/release/leaderboard.wasm \
  --network Testnet \
  --source-account typezero-dev
```

2. **Initialize Leaderboard**
```bash
stellar contract invoke \
  --id C... \
  --network Testnet \
  --source-account typezero-dev \
  -- init \
  --verifier_id G... \
  --image_id <64_hex_bytes> \
  --admin G...
```

3. **Set First Challenge**
```bash
stellar contract invoke \
  --id C... \
  --network Testnet \
  --source-account typezero-dev \
  -- set_challenge \
  --challenge_id 1 \
  --prompt_hash <64_hex_bytes>

stellar contract invoke \
  --id C... \
  --network Testnet \
  --source-account typezero-dev \
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
