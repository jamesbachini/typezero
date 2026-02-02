# Deterministic Rules (Authoritative)

This file defines the canonical rules for prompt normalization, replay encoding constraints, and scoring. Any implementation (frontend, backend, zk guest) must follow these exact rules.

## Prompt normalization

1. Convert to lowercase ASCII.
2. Replace any run of whitespace with a single space.
3. Trim leading/trailing spaces.
4. Encode as UTF-8 bytes (ASCII subset required).
5. `prompt_hash = sha256(normalized_prompt_bytes)`.

## Event encoding

- Canonical byte encoding (little-endian):
  - `len: u16`, then `len` entries of `dt_ms: u16` + `key: u8`.
- Key mapping:
  - `0-25` = `a-z`
  - `26` = space
  - `27` = backspace
  - `28` = enter

## Timing constraints

These are intentionally generous to avoid false rejects.

- `MIN_DT_MS = 10`
- `MIN_DURATION_MS = prompt_len * 40`

## Scoring

All arithmetic is integer math.

- `duration_ms = sum(dt_ms)`
- `typed_chars = number of non-backspace chars that remain`
- `correct_chars = count matches vs prompt at same index (up to min len)`
- `accuracy_bps = (correct_chars * 10000) / prompt_len`
- `wpm_x100 = (typed_chars * 1_200_000) / duration_ms`
- `score = (wpm_x100 * accuracy_bps) / 10000`

## Public outputs (journal)

Commit the fixed layout (little-endian for integers):

- `challenge_id: u32`
- `player: [u8; 32]`
- `prompt_hash: [u8; 32]`
- `score: u64`
- `wpm_x100: u32`
- `accuracy_bps: u32`
- `duration_ms: u32`
