## TypeZERO: ZK-Verified Typing With Soroban + Risc0

## Why I Built This
I wanted a typing game where "trust me" doesn't exist. Most scoreboards are polite fiction -- the client claims a score, the server believes it. TypeZERO flips that: the score is proven, not asserted. The point isn't just the game; it's the pattern. A tiny replay format, deterministic scoring, and a proof that a smart contract can verify.

If you're curious about how to stitch together a zkVM, a Soroban contract, and a very plain frontend, this codebase is a good working example. I kept it opinionated and minimal on purpose so the core ideas don't get lost.

## High-Level Overview
This repo is a four-part system, held together by deterministic rules:

- Frontend captures keystrokes, encodes them into a compact replay, computes preview stats, and submits proof results. The UI lives in `frontend/app.mjs` and the deterministic replay logic lives in `frontend/src/replay.mjs`.
- Backend exposes a small HTTP API that normalizes prompts, validates replay encoding, and invokes a Risc0 host binary to generate proofs. The entrypoint is `backend/server.js`.
- Risc0 guest program replays the events, enforces timing constraints, computes the score, and commits a fixed journal payload. That logic is in `risc0/typing_proof/methods/guest/src/main.rs`.
- Soroban contract verifies the proof (via a Groth16 verifier contract) and maintains the leaderboard. That's `contracts/leaderboard/src/lib.rs`.

The glue for all of this is the deterministic spec in `docs/spec.md` and the shared rules in `shared/rules.md` and `shared/replay.ts`.

## How It Works (Conceptually)
The core flow is simple:

1. The frontend records keystrokes as `dt_ms + key` pairs and encodes them as bytes.
2. The backend takes those bytes, normalizes the prompt, and runs the Risc0 host to produce a proof.
3. The proof commits a small "journal" of public outputs: challenge id, prompt hash, player key, score, WPM, accuracy, and duration.
4. The frontend submits those public outputs plus the proof seal to the Soroban contract.
5. The contract verifies the proof via the verifier contract, checks that the submitted values match, and updates leaderboard state.

The important thing is that everyone computes the same result because the rules are deterministic and pinned. The spec in `docs/spec.md` and the canonical rules in `shared/rules.md` are the source of truth.

## Code Walkthrough (Practical Highlights)

**Deterministic Encoding + Scoring**
I kept replay encoding extremely small: a `u16` count followed by `(dt_ms: u16, key: u8)` tuples. That format is mirrored across frontend, backend validation, and the guest. The front-end version is in `frontend/src/replay.mjs` and the canonical TypeScript version lives in `shared/replay.ts`.

Here's the heart of the scoring logic used on the client (and mirrored in the guest):

`frontend/src/replay.mjs`
```js
export function computeStats(prompt, events) {
  const normalizedPrompt = normalizePrompt(prompt);
  const output = applyEvents(events);

  let durationMs = 0;
  for (const event of events) {
    durationMs += event.dtMs;
  }

  const typedChars = output.length;
  const promptLen = normalizedPrompt.length;
  const cmpLen = Math.min(output.length, promptLen);
  let correctChars = 0;
  for (let i = 0; i < cmpLen; i += 1) {
    if (output[i] === normalizedPrompt[i]) {
      correctChars += 1;
    }
  }

  const accuracyBps = promptLen === 0 ? 0 : Math.floor((correctChars * 10000) / promptLen);
  const wpmX100 = durationMs === 0 ? 0 : Math.floor((typedChars * 1_200_000) / durationMs);
  const score = Math.floor((wpmX100 * accuracyBps) / 10000);
```

The key part is consistency: all arithmetic is integer math, which makes the proof deterministic and predictable.

**The Guest Program: Enforce, Compute, Commit**
The guest is intentionally small: parse events, enforce minimum timing, compute stats, then commit a fixed 88-byte journal. This keeps the circuit cheap and easy to audit. The core of that logic is in `risc0/typing_proof/methods/guest/src/main.rs`.

`risc0/typing_proof/methods/guest/src/main.rs`
```rust
for (dt_ms, key) in events {
    if dt_ms < MIN_DT_MS {
        panic!("dt below minimum");
    }
    duration_ms = duration_ms
        .checked_add(dt_ms as u64)
        .expect("duration overflow");

    match key {
        0..=25 => output.push(b'a' + key),
        KEY_SPACE => output.push(b' '),
        KEY_BACKSPACE => { output.pop(); }
        KEY_ENTER => {}
        _ => panic!("invalid key"),
    }
}

let accuracy_bps = ((correct_chars as u64) * 10000 / (prompt_len as u64)) as u32;
let wpm_x100 = ((typed_chars as u64) * 1_200_000 / duration_ms) as u32;
let score = (wpm_x100 as u64 * accuracy_bps as u64) / 10000;

let journal = encode_journal(
    challenge_id,
    &player_pubkey,
    &prompt_hash,
    score,
    wpm_x100,
    accuracy_bps,
    duration_ms as u32,
);
```

This is where the anti-cheat constraints live. If the replay cheats timing, the proof never materializes.

**The Contract: Verify and Rank**
The contract doesn't trust the backend at all. It verifies the proof, checks the challenge hash, and then only updates state if the score is better than the existing best. That logic is in `contracts/leaderboard/src/lib.rs`.

`contracts/leaderboard/src/lib.rs`
```rust
let stored_prompt_hash: BytesN<32> = storage
    .get(&DataKey::ChallengePromptHash(challenge_id))
    .unwrap_or_else(|| panic_with_error!(&env, Error::InvalidChallenge));
if stored_prompt_hash != prompt_hash {
    panic_with_error!(&env, Error::InvalidPromptHash);
}

let stored_image_id = read_image_id(&env);
if stored_image_id != image_id {
    panic_with_error!(&env, Error::InvalidImageId);
}

let verifier_id = read_verifier_id(&env);
verify_proof(&env, &verifier_id, &journal_hash, &image_id, &seal);
```

The proof verification is delegated to a deployed Groth16 verifier contract. The leaderboard contract only needs the journal hash plus the seal and image id.

**Backend: Small, Defensive, Untrusted**
The backend in `backend/server.js` is intentionally conservative. It validates base64, checks prompt length, validates event encoding, and refuses to submit a seal that's too big for Groth16. It also supports game hub start/end calls if you wire it up, but the proof path is standalone.

The host invocation lives in `backend/prover.js` and simply shells out to the `typing-proof-host` binary produced from the Risc0 host crate.

## How I Run It Locally
I keep two paths: a one-shot `make dev`, and a more explicit manual flow when I want to poke at components in isolation.

**One-Command Dev**
From the repo root:

```bash
make dev
```

That script deploys the contract (testnet), writes frontend config, then starts backend and frontend. It expects `stellar` CLI and a configured identity (default is `typezero-dev`).

**Manual Flow (Useful for Debugging)**

```bash
# Build the contract
cd contracts/leaderboard
cargo build --target wasm32-unknown-unknown --release

# Build the guest + host
cd ../../risc0/typing_proof
cargo build --release
cargo build --release -p typing-proof-host

# Start backend
cd ../../backend
npm install
npm run dev

# Start frontend
cd ../frontend
npm install
npm run dev
```

A couple of gotchas I've tripped over:

- The backend expects the host binary at `risc0/typing_proof/target/release/typing-proof-host` unless you override `TYPING_PROOF_HOST_BIN` in `backend/config.json`.
- The contract verification requires the Groth16 verifier selector. That's configured via `VERIFIER_SELECTOR_HEX` in `backend/config.json`.
- The config here is demo-grade. `backend/config.json` contains a testnet secret key, and the frontend uses Friendbot for funding. That's intentional for quick iteration, not production.

**Tests**
The test suite spans Rust + JS. From the root:

```bash
make test
```

That runs contract tests, host/guest tests, and frontend tests. It's a good sanity check before trusting any refactors.

## What You Can Learn From This
A few patterns that feel broadly reusable:

- Deterministic encoding as a system boundary. The replay format in `shared/replay.ts` and rules in `shared/rules.md` are the contract between UI, prover, and chain.
- "Untrusted backend" as a legitimate architecture choice. The backend becomes a pure proving service; proofs carry the trust.
- Keeping zkVM guests tiny. The guest code is basically pure validation + math, which keeps proving time and risk down.
- Soroban contract design with bounded storage. The leaderboard keeps a fixed `TOP_N`, which keeps state size predictable.

If you're building any sort of "prove this client-side claim" system, the way the journal is structured here is a good model.

## Closing Thoughts
This project is intentionally small, but it scales conceptually. The same shape works for any deterministic game or verification workflow. The main limitations are practical: proof generation is heavy, Groth16 setup is a dependency, and the backend can always refuse service. But the trust model holds, and that's the interesting part.

If I were taking this further, I'd push more replay verification into contract-level checks, make the daily challenge rotation fully on-chain, and add a caching layer for proof reuse. But even in its current form, it's a clean demonstration of how to build "prove it" mechanics end-to-end.
