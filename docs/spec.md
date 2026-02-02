## ZK-Verified Typing Challenge — Full Build Spec

# 1) Goals and non-goals

## Goals

* Simple typing game with a **daily challenge**.
* Player can **play locally** in browser.
* Client generates a **RiscZero proof** from a compact replay of keystrokes/timing.
* Soroban contract verifies the proof (via verifier contract) and updates:

  * per-player best score for that challenge
  * global leaderboard (top N)
* No “trust me” backend secrets; backend is optional and untrusted.

## Non-goals

* Perfect anti-bot detection (impossible with open client). Instead:

  * score must be **provably derived** from replay under deterministic rules
  * constraints make “instant teleport typing” invalid
* Heavy circuits/cryptography inside zkVM; keep guest small.
* Complex matchmaking or realtime multiplayer.

---

# 2) Tech constraints and versions

## Soroban/Rust dependencies (exact)

```toml
[dependencies]
soroban-sdk = "25.0.2"
sep-41-token = "1.4.0"
soroban-fixed-point-math = "1.5.0"
blend-contract-sdk = "2.25.0"
stellar-tokens = "0.6.0"
stellar-access = "0.6.0"
stellar-contract-utils = "0.6.0"
stellar-macros = "0.6.0"
stellar-accounts = "0.6.0"
```

> Note: This game’s core contract can be built with only `soroban-sdk` + `stellar-contract-utils`/`stellar-access`. The rest are allowed but not mandatory unless you add prizes/tokens.

## JS

* `@stellar/stellar-sdk` **14.5.0**

## Proof verifier

* Use the Groth16 verifier contract and interface from: `stellar-risc0-verifier` repository.

## Network

* Target **Futurenet** (bn254 required).

---

# 3) System architecture

## Components

1. **Frontend web app**

   * UI for typing test
   * records replay
   * optionally triggers proof generation (see proving options)
   * submits proof + public outputs to Soroban leaderboard contract
   * reads leaderboard from chain

2. **RiscZero proving**

   * **Option A (preferred for “not gameable”)**: a small proving service (backend) does proving
   * **Option B**: local proving (dev-friendly but heavier, and awkward for browser)

3. **Soroban contracts**

   * **Leaderboard contract** (you write)
   * **RiscZero verifier contract** (deploy as-is from Nethermind)

## Proving options (choose one for implementation)

* **A: Backend proving service** (recommended)

  * Browser sends replay payload to backend
  * Backend runs RiscZero host to generate proof artifacts
  * Browser submits proof to chain
  * Backend is untrusted; proofs enforce correctness
* **B: Local proving (developer machine)**

  * Useful for demos if you don’t want infra
  * Not viable in a pure browser for most users

This spec assumes **Option A**.

---

# 4) Game rules (deterministic, ZK-friendly)

## Challenge format

* A challenge consists of:

  * `challenge_id: u32` (increments daily)
  * `prompt: ASCII text` (kept off-chain for UX, but its **hash is on-chain**)
  * `prompt_hash = sha256(prompt_bytes)`

Front-end shows `prompt` for the day and also reads `prompt_hash` from chain.

## Replay format (the private input to zkVM)

Represent a play session as a compact event list:

* `events: Vec<Event>`
* `Event = (dt_ms: u16, key: u8)`

Where:

* `dt_ms` = milliseconds since previous key event (first key event is since “start”)
* `key` is a restricted keyset:

  * lowercase letters `a-z` (26)
  * space (1)
  * backspace (1)
  * apostrophe / comma / period optional (keep minimal)
  * enter (to finish)

**All of this is deterministic and easy to parse in guest.**

## Reconstruction and scoring

Inside guest:

1. Reconstruct typed output by applying keys and backspace.
2. Enforce constraints (below).
3. Compare typed output to prompt:

   * Compute `correct_chars`, `mistakes`
   * `accuracy = correct_chars / prompt_len` (store as integer bps or per-mille)
4. Compute WPM deterministically:

   * `minutes = duration_ms / 60000`
   * `gross_wpm = (typed_chars / 5) / minutes`
   * Use integer math; represent WPM in fixed point (e.g., `wpm_x100`)

**Recommended score**

* `score = wpm_x100 * accuracy_bps` (scaled integer)

  * e.g. `score = (wpm_x100 * accuracy_bps) / 10000`
* Commit both `wpm_x100` and `accuracy_bps` for transparency.

## Anti-teleport constraints (small but meaningful)

Enforce in guest:

* `dt_ms >= MIN_DT` (e.g. 10ms)
* `dt_ms <= MAX_DT` (e.g. 5000ms; prevents absurd pauses? optional)
* `total_duration_ms >= MIN_DURATION` (e.g. prompt_len * 40ms)
* max burst:

  * in any rolling 200ms window, <= 8 keys (approx; can implement with a simple running sum using dt)
* max sustained rate:

  * `typed_chars / total_duration_ms <= MAX_RATE` (integer comparison)

Keep these thresholds generous to avoid false rejects.

---

# 5) ZK statement and committed public outputs

## What the proof asserts (the core statement)

> Given `challenge_id` and `prompt_hash`, the prover knows a replay `events` such that, when applying the deterministic rules:
>
> * the reconstructed prompt hash matches `prompt_hash`,
> * replay passes timing constraints,
> * the computed `(score, wpm_x100, accuracy_bps, duration_ms)` are correct,
>   and the committed public outputs equal those values.

### Public outputs to commit in guest journal

Commit a struct (fixed layout):

* `challenge_id: u32`
* `player: [u8; 32]` (Stellar account raw public key bytes or canonical encoding used in your system)
* `prompt_hash: [u8; 32]`
* `score: u64`
* `wpm_x100: u32`
* `accuracy_bps: u32` (0–10000)
* `duration_ms: u32`
* `replay_hash: [u8; 32]` (optional but recommended for auditability)

**Important:** Keep the committed struct stable. The contract will parse these exact bytes (or you can pass them as separate arguments if your verifier requires).

## Binding score to the submitting account

To prevent “submit someone else’s proof”, enforce:

* `player` in journal must equal `invoker` in Soroban call.

You do not need signature verification for this binding if:

* the proof is submitted by the same Stellar address recorded in proof outputs, and contract enforces equality.

---

# 6) On-chain contracts

## 6.1 Deployed verifier contract (external)

* Deploy Nethermind’s Groth16 verifier contract to Futurenet.
* Record its contract ID in your app config.

The verifier interface you will call from your leaderboard contract:

* `verify(journal, image_id, seal)` (exact arg types depend on Nethermind contract; the agent must match it precisely)
* The verify method returns `()` on success, reverts/panics on failure.

## 6.2 Leaderboard contract (you write)

### Contract responsibilities

* Store challenge definitions (`challenge_id -> prompt_hash`).
* Accept proof submissions and update state if valid.
* Provide read methods for:

  * current challenge
  * player’s best
  * top N leaderboard entries

### Storage schema

Use Soroban persistent storage.

**Config**

* `VERIFIER_ID: Address`
* `IMAGE_ID: BytesN<32>` (the RiscZero image id for your guest program; fixed for a build)

**Challenge data**

* `CHALLENGE_PROMPT_HASH(challenge_id: u32) -> BytesN<32>`
* `CURRENT_CHALLENGE_ID -> u32`

**Per-player best**

* `BEST_SCORE(challenge_id, player: Address) -> ScoreEntry`

`ScoreEntry`:

* `score: u64`
* `wpm_x100: u32`
* `accuracy_bps: u32`
* `duration_ms: u32`
* `submitted_ledger: u32`

**Top N leaderboard**
Two simple approaches:

A) **Keep per-player best only** and derive top N off-chain by scanning events (simpler contract, heavier client).
B) **Maintain a bounded top N list on-chain** (more contract logic, better UX).

For 48h, do **B with small N (e.g. 20)**.

* `TOP_LIST(challenge_id) -> Vec<LeaderboardRow>` (length <= N)

`LeaderboardRow`:

* `player: Address`
* `score: u64`
* `wpm_x100: u32`
* `accuracy_bps: u32`

### Public methods

#### Admin / setup

* `init(verifier_id: Address, image_id: BytesN<32>, admin: Address)`
* `set_challenge(challenge_id: u32, prompt_hash: BytesN<32>)`
* `set_current_challenge(challenge_id: u32)`

Use `stellar-access` or a minimal admin check:

* only `admin` may set challenge hashes.

#### Reads

* `get_current_challenge() -> (challenge_id: u32, prompt_hash: BytesN<32>)`
* `get_best(challenge_id: u32, player: Address) -> Option<ScoreEntry>`
* `get_top(challenge_id: u32) -> Vec<LeaderboardRow>`

#### Submit score (core)

* `submit_score(
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
  )`

**Rules inside submit_score**

1. `require(player == invoker)`

2. Validate challenge:

   * stored prompt hash matches `prompt_hash`
   * `challenge_id == CURRENT_CHALLENGE_ID` (or allow historic)

3. Verify proof:

   * call verifier `verify(journal_hash, image_id, seal_with_selector)`
   * ensure `image_id == stored IMAGE_ID` (prevents submitting proofs for a different program)

4. Ensure journal_hash corresponds to public outputs

   * Minimal approach:

     * require the client passes `journal_hash` and the verifier checks it.
     * Contract does not need to parse journal bytes if verifier is keyed on hash.
   * If the verifier requires full journal bytes, then:

     * pass journal bytes to verifier
     * additionally parse the committed struct and compare to args

5. Update `BEST_SCORE` if new score higher.

6. Update `TOP_LIST`:

   * if player already in list, update if improved
   * else insert if score beats min in list
   * keep sorted descending by score
   * truncate to N

**Note on “seal selector”**
Nethermind verifier expects a 4-byte selector prepended to seal (as you described). The agent must:

* fetch selector by invoking `selector` on verifier contract once
* cache it in app config
* ensure `seal_arg = selector || seal_bytes`

### Events (optional but nice)

Emit on submit:

* `ScoreSubmitted(challenge_id, player, score, wpm_x100, accuracy_bps)`

---

# 7) Backend proving service (Option A)

## Responsibilities

* Provide the daily prompt text (or fetch from contract and map hash->text)
* Issue session ids (optional; can be stateless)
* Accept replay payloads and produce proof artifacts:

  * `seal`
  * `image_id`
  * `journal_hash` (or journal bytes depending on verifier)
  * echo computed metrics to display

## Minimal API

* `GET /challenge/current`

  * returns: `{ challenge_id, prompt, prompt_hash }`
* `POST /prove`

  * body: `{ challenge_id, player_pubkey, prompt_hash, events }`
  * returns: `{ score, wpm_x100, accuracy_bps, duration_ms, journal_hash, image_id, seal }`

## Security posture

* Backend is **not trusted**:

  * it cannot force a score on-chain because submit requires `invoker == player`
  * contract only accepts proof-valid submissions
* Backend can be rate-limited to prevent abuse, but it’s not part of the trust model.

---

# 8) Frontend UX spec

## Screens

1. **Home**

   * “Today’s challenge”
   * connect wallet
   * start button

2. **Typing screen**

   * show prompt
   * live typed text
   * stats: time elapsed, WPM estimate, errors
   * finish when user hits enter or completes prompt

3. **Submit score modal**

   * shows calculated stats
   * button “Generate proof & submit”
   * progress steps:

     * uploading replay
     * generating proof (backend)
     * wallet transaction signing
     * confirmed

4. **Leaderboard**

   * top list (rank, address, score, wpm, accuracy)
   * “Your best”

## Wallet actions

* Only needs to sign Soroban tx to submit.
* No need for message signing unless you add extra binding.

---

# 9) Data encoding requirements

## Event encoding

* Define a canonical byte encoding for `events` to ensure consistent hashing in guest/host:

  * `len: u16` then `len` entries of `dt_ms: u16` + `key: u8`
* Keep endianness fixed (little-endian).
* Document key mapping explicitly (0–25 = a–z, 26 = space, 27 = backspace, 28 = enter).

## Prompt encoding

* ASCII or UTF-8 restricted subset.
* Normalize:

  * lowercase
  * single spaces
  * trim
* `prompt_hash = sha256(normalized_prompt_bytes)`

The normalization must be identical in:

* backend
* frontend display (for UX)
* zk guest (for verification)

---

# 10) Testing requirements

## Guest program tests

* Replay parsing and reconstruction
* Timing constraints acceptance/rejection
* Scoring determinism
* Prompt hash matching

## Backend tests

* End-to-end proof generation for known replay
* Regression: same replay -> same journal hash/outputs

## Contract tests (Soroban)

* Challenge set/get
* Reject:

  * wrong challenge id/hash
  * image_id mismatch
  * player != invoker
  * invalid proof
* Accept:

  * valid proof updates best
  * leaderboard insertion/sort/truncate works
* Idempotency:

  * resubmitting same proof doesn’t break state

---

# 11) Deployment steps (Futurenet)

1. Deploy Nethermind verifier contract.
2. Query and record selector bytes (`selector` method).
3. Deploy Leaderboard contract:

   * init with verifier_id, image_id, admin
4. Set challenge for day 1:

   * `set_challenge(1, prompt_hash)`
   * `set_current_challenge(1)`
5. Start backend:

   * configured with verifier selector and guest image id
6. Frontend config:

   * network futurenet
   * leaderboard contract id
   * verifier contract id
   * backend URL

---

# 12) Deliverables checklist (what the agent must produce)

## Repos / folders

* `contracts/leaderboard/` (Soroban contract)
* `risc0/typing_proof/`:

  * `methods/guest/` (zkVM guest program)
  * `host/` (backend proving host)
* `backend/` (API server wrapping host; can be in Rust or Node calling Rust binary)
* `frontend/` (web UI)

## Must-have features

* Daily challenge seeded on-chain by hash
* Replay recording + canonical encoding
* Proof generation returning artifacts
* Soroban submit that verifies proof via verifier contract
* On-chain per-player best + top N list
* Leaderboard UI reading on-chain state

## Nice-to-have (if time)

* show proof metadata (journal hash) in UI
* tx links
* admin script to rotate daily challenge

---

# 13) Notes on keeping circuits and verification small

* Keep guest logic purely:

  * parse
  * validate dt constraints
  * compute hash and score
  * commit outputs
* Avoid:

  * signature verification in guest (unless it’s trivial in your environment)
  * fancy rolling window checks that require large buffers
* Prefer O(n) single pass with a few accumulators.
