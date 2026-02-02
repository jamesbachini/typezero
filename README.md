# TypeZERO | ZK-Verified Typing Challenge 🚀⌨️

A provably fair typing game built on Stellar blockchain using RiscZero zero-knowledge proofs. Compete in daily challenges where your scores are cryptographically verified—no trust required.

## 🎯 Overview

This project demonstrates the integration of **RiscZero zkVM** with **Stellar's Soroban smart contracts** to create a gaming experience where player scores are mathematically proven, not just claimed. Every keystroke is recorded locally, condensed into a compact replay, and verified through zero-knowledge proofs before being accepted on-chain.

### Key Features

- **Daily Challenges**: New typing prompts every day
- **Zero-Knowledge Proofs**: Scores are cryptographically proven using RiscZero
- **On-Chain Leaderboards**: Immutable rankings stored on Stellar Futurenet
- **No Backend Trust**: The backend can't cheat—proofs enforce correctness
- **Deterministic Scoring**: Same replay always produces the same score

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
│ Proving Svc  │   │   (Futurenet)   │
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
   - React-based typing test UI
   - Replay recording and submission
   - Leaderboard display
   - Stellar wallet integration

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

1. **Connect Wallet**: Use Freighter or another Stellar wallet
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
- **Maximum keystroke interval**: ≤5000ms (prevents pausing)
- **Minimum total duration**: Based on prompt length (~40ms/char)
- **Burst protection**: Max 8 keys per 200ms rolling window
- **Rate limiting**: Overall typing rate must be humanly achievable

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

# Setup backend
cd ../../backend
npm install  # or cargo build if Rust-based
```

### Local Development

```bash
# Terminal 1: Start backend
cd backend
npm run dev  # starts on localhost:3000

# Terminal 2: Deploy contracts to Futurenet
cd contracts/leaderboard
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/leaderboard.wasm \
  --network futurenet

# Terminal 3: Start frontend
cd frontend
npm run dev  # starts on localhost:5173
```

### Configuration

Create `.env` files:

For local development, copy `.env.example` at repo root and fill in contract IDs. It is preconfigured for Stellar testnet endpoints (the spec targets Futurenet; update when deploying there).

**Frontend** (`frontend/.env`):
```env
VITE_NETWORK=futurenet
VITE_LEADERBOARD_CONTRACT_ID=C...
VITE_VERIFIER_CONTRACT_ID=C...
VITE_BACKEND_URL=http://localhost:3000
```

**Backend** (`backend/.env`):
```env
RISC0_IMAGE_ID=0x...
VERIFIER_SELECTOR=0x...
PORT=3000
```

## 📝 Tech Stack

### Blockchain
- **Stellar Soroban SDK**: `25.0.2`
- **Network**: Futurenet (bn254 curve support required)
- **stellar-contract-utils**: `0.6.0`
- **@stellar/stellar-sdk**: `14.5.0`

### Zero-Knowledge
- **RiscZero**: zkVM for proof generation
- **Groth16**: Proof system (via Nethermind verifier)
- **Proof Artifacts**: Seal, journal hash, image ID

### Frontend
- React + Vite
- TailwindCSS
- Freighter Wallet integration

### Backend
- Node.js/Express (or Rust Actix)
- RiscZero host environment

## 🔐 Security Model

### Trustless Design

**The backend cannot cheat because:**
- Proofs are generated using fixed RiscZero image ID
- Contract verifies proof cryptographically
- Only the player's address can submit their own proof
- Replay determinism ensures same inputs → same outputs

**What the backend CAN do:**
- Refuse to generate proofs (DoS)
- Be slow or rate-limit

**What the backend CANNOT do:**
- Submit fake scores (proof verification fails)
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

#### `GET /challenge/current`
Returns current daily challenge.

**Response:**
```json
{
  "challenge_id": 42,
  "prompt": "the quick brown fox jumps over the lazy dog",
  "prompt_hash": "0x..."
}
```

#### `POST /prove`
Generates ZK proof for replay.

**Request:**
```json
{
  "challenge_id": 42,
  "player_pubkey": "GA...",
  "prompt_hash": "0x...",
  "events": [[50, 116], [120, 104], ...]  // [[dt_ms, key], ...]
}
```

**Response:**
```json
{
  "score": 85420,
  "wpm_x100": 7250,
  "accuracy_bps": 9800,
  "duration_ms": 12450,
  "journal_hash": "0x...",
  "image_id": "0x...",
  "seal": "0x..."
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

### Run Contract Tests
```bash
cd contracts/leaderboard
cargo test
```

### Run Guest Tests
```bash
cd risc0/typing_proof
cargo test
```

### Run Integration Tests
```bash
cd backend
npm test
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

### Futurenet Deployment Steps

1. **Deploy Verifier Contract** (Nethermind)
```bash
soroban contract deploy \
  --wasm risc0-verifier.wasm \
  --network futurenet
```

2. **Query Verifier Selector**
```bash
soroban contract invoke \
  --id C... \
  --network futurenet \
  -- selector
```

3. **Deploy Leaderboard Contract**
```bash
soroban contract deploy \
  --wasm leaderboard.wasm \
  --network futurenet
```

4. **Initialize Leaderboard**
```bash
soroban contract invoke \
  --id C... \
  --network futurenet \
  -- init \
  --verifier_id C... \
  --image_id 0x... \
  --admin G...
```

5. **Set First Challenge**
```bash
soroban contract invoke \
  --id C... \
  --network futurenet \
  -- set_challenge \
  --challenge_id 1 \
  --prompt_hash 0x...

soroban contract invoke \
  --id C... \
  --network futurenet \
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
