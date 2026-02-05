use anyhow::{anyhow, Result};
use risc0_zkvm::{default_prover, ExecutorEnv, InnerReceipt, ProverOpts, Receipt};
use sha2::{Digest, Sha256};
use typing_proof_methods::{TYPING_PROOF_GUEST_ELF, TYPING_PROOF_GUEST_ID};

pub const KEY_A_MAX: u8 = 25;
pub const KEY_SPACE: u8 = 26;
pub const KEY_BACKSPACE: u8 = 27;
pub const KEY_ENTER: u8 = 28;
pub const JOURNAL_LEN: usize = 88;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Journal {
    pub challenge_id: u32,
    pub player_pubkey: [u8; 32],
    pub prompt_hash: [u8; 32],
    pub score: u64,
    pub wpm_x100: u32,
    pub accuracy_bps: u32,
    pub duration_ms: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProveResult {
    pub journal: Journal,
    pub journal_bytes: [u8; JOURNAL_LEN],
    pub seal: Vec<u8>,
    pub image_id: [u8; 32],
    pub journal_sha256: [u8; 32],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReplayEvent {
    pub dt_ms: u16,
    pub key: u8,
}

pub fn prove(
    challenge_id: u32,
    player_pubkey: [u8; 32],
    prompt: &str,
    events_bytes: &[u8],
) -> Result<ProveResult> {
    let prompt_bytes = normalize_prompt(prompt)?;
    let prompt_hash = sha256(&prompt_bytes);

    let env = ExecutorEnv::builder()
        .write(&challenge_id)?
        .write(&prompt_hash)?
        .write(&player_pubkey)?
        .write(&prompt_bytes)?
        .write(&events_bytes)?
        .build()?;

    let prover = default_prover();
    let (opts, require_groth16) = prover_opts_from_env();
    let prove_info = prover.prove_with_opts(env, TYPING_PROOF_GUEST_ELF, &opts)?;
    prove_info.receipt.verify(TYPING_PROOF_GUEST_ID)?;

    let receipt = prove_info.receipt;
    if require_groth16 && !matches!(&receipt.inner, InnerReceipt::Groth16(_)) {
        return Err(anyhow!(
            "expected Groth16 receipt; ensure Groth16 proving is enabled (Docker required)"
        ));
    }
    let journal_bytes_vec = receipt.journal.bytes.clone();
    let journal_bytes: [u8; JOURNAL_LEN] = journal_bytes_vec
        .as_slice()
        .try_into()
        .map_err(|_| anyhow!("journal length mismatch"))?;
    let journal = decode_journal(&journal_bytes)?;
    let journal_sha256 = sha256(&journal_bytes);

    Ok(ProveResult {
        journal,
        journal_bytes,
        seal: receipt_seal_bytes(&receipt)?,
        image_id: digest_to_bytes(TYPING_PROOF_GUEST_ID.into()),
        journal_sha256,
    })
}

fn prover_opts_from_env() -> (ProverOpts, bool) {
    let kind = std::env::var("TYPING_PROOF_RECEIPT_KIND")
        .ok()
        .unwrap_or_else(|| "groth16".to_string())
        .to_lowercase();

    match kind.as_str() {
        "succinct" => (ProverOpts::succinct(), false),
        "composite" => (ProverOpts::composite(), false),
        "groth16" => (ProverOpts::groth16(), true),
        _ => (ProverOpts::groth16(), true),
    }
}

pub fn normalize_prompt(input: &str) -> Result<Vec<u8>> {
    let mut out: Vec<u8> = Vec::new();
    let mut in_space = true;
    for b in input.bytes() {
        if !b.is_ascii() {
            return Err(anyhow!("prompt must be ASCII"));
        }
        if b.is_ascii_whitespace() {
            if !in_space {
                out.push(b' ');
                in_space = true;
            }
            continue;
        }
        let lower = if (b'A'..=b'Z').contains(&b) {
            b + 32
        } else {
            b
        };
        out.push(lower);
        in_space = false;
    }
    if out.last() == Some(&b' ') {
        out.pop();
    }
    Ok(out)
}

pub fn encode_events(events: &[ReplayEvent]) -> Result<Vec<u8>> {
    if events.len() > u16::MAX as usize {
        return Err(anyhow!("events length exceeds u16"));
    }
    let len = events.len() as u16;
    let mut out = Vec::with_capacity(2 + events.len() * 3);
    out.extend_from_slice(&len.to_le_bytes());
    for event in events {
        if event.key > KEY_ENTER {
            return Err(anyhow!("key out of range"));
        }
        out.extend_from_slice(&event.dt_ms.to_le_bytes());
        out.push(event.key);
    }
    Ok(out)
}

pub fn decode_journal(bytes: &[u8]) -> Result<Journal> {
    if bytes.len() != JOURNAL_LEN {
        return Err(anyhow!("journal length mismatch"));
    }
    let mut offset = 0;

    let challenge_id = u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap());
    offset += 4;

    let mut player_pubkey = [0u8; 32];
    player_pubkey.copy_from_slice(&bytes[offset..offset + 32]);
    offset += 32;

    let mut prompt_hash = [0u8; 32];
    prompt_hash.copy_from_slice(&bytes[offset..offset + 32]);
    offset += 32;

    let score = u64::from_le_bytes(bytes[offset..offset + 8].try_into().unwrap());
    offset += 8;

    let wpm_x100 = u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap());
    offset += 4;

    let accuracy_bps = u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap());
    offset += 4;

    let duration_ms = u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap());

    Ok(Journal {
        challenge_id,
        player_pubkey,
        prompt_hash,
        score,
        wpm_x100,
        accuracy_bps,
        duration_ms,
    })
}

pub fn encode_journal(journal: &Journal) -> [u8; JOURNAL_LEN] {
    let mut out = [0u8; JOURNAL_LEN];
    let mut offset = 0;

    out[offset..offset + 4].copy_from_slice(&journal.challenge_id.to_le_bytes());
    offset += 4;

    out[offset..offset + 32].copy_from_slice(&journal.player_pubkey);
    offset += 32;

    out[offset..offset + 32].copy_from_slice(&journal.prompt_hash);
    offset += 32;

    out[offset..offset + 8].copy_from_slice(&journal.score.to_le_bytes());
    offset += 8;

    out[offset..offset + 4].copy_from_slice(&journal.wpm_x100.to_le_bytes());
    offset += 4;

    out[offset..offset + 4].copy_from_slice(&journal.accuracy_bps.to_le_bytes());
    offset += 4;

    out[offset..offset + 4].copy_from_slice(&journal.duration_ms.to_le_bytes());

    out
}

pub fn sha256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(data);
    let result = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&result);
    out
}

pub fn digest_to_bytes(digest: risc0_zkvm::sha::Digest) -> [u8; 32] {
    let mut out = [0u8; 32];
    out.copy_from_slice(digest.as_bytes());
    out
}

pub fn receipt_to_journal(receipt: &Receipt) -> Result<Journal> {
    let journal_bytes_vec = receipt.journal.bytes.clone();
    let journal_bytes: [u8; JOURNAL_LEN] = journal_bytes_vec
        .as_slice()
        .try_into()
        .map_err(|_| anyhow!("journal length mismatch"))?;
    decode_journal(&journal_bytes)
}

pub fn receipt_seal_bytes(receipt: &Receipt) -> Result<Vec<u8>> {
    match &receipt.inner {
        InnerReceipt::Groth16(inner) => Ok(inner.seal.clone()),
        InnerReceipt::Succinct(inner) => Ok(inner.get_seal_bytes()),
        InnerReceipt::Composite(inner) => {
            if inner.assumption_receipts.is_empty() && inner.segments.len() == 1 {
                return Ok(inner.segments[0].get_seal_bytes());
            }
            let mut out = Vec::new();
            for segment in &inner.segments {
                out.extend_from_slice(&segment.get_seal_bytes());
            }
            Ok(out)
        }
        InnerReceipt::Fake(_) => Ok(Vec::new()),
        _ => Err(anyhow!("unsupported receipt type for seal extraction")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Once;

    static TEST_ENV: Once = Once::new();

    fn init_test_env() {
        TEST_ENV.call_once(|| {
            std::env::set_var("TYPING_PROOF_RECEIPT_KIND", "succinct");
        });
    }

    fn fixture_perfect() -> Result<(u32, [u8; 32], String, Vec<u8>)> {
        let challenge_id = 1u32;
        let player_pubkey = [9u8; 32];
        let prompt = "abc".to_string();
        let events = vec![
            ReplayEvent { dt_ms: 100, key: 0 },
            ReplayEvent { dt_ms: 100, key: 1 },
            ReplayEvent { dt_ms: 100, key: 2 },
        ];
        let events_bytes = encode_events(&events)?;
        Ok((challenge_id, player_pubkey, prompt, events_bytes))
    }

    fn fixture_mistake() -> Result<(u32, [u8; 32], String, Vec<u8>)> {
        let challenge_id = 2u32;
        let player_pubkey = [8u8; 32];
        let prompt = "abc".to_string();
        let events = vec![
            ReplayEvent { dt_ms: 100, key: 0 },
            ReplayEvent { dt_ms: 100, key: 23 },
            ReplayEvent { dt_ms: 100, key: 2 },
        ];
        let events_bytes = encode_events(&events)?;
        Ok((challenge_id, player_pubkey, prompt, events_bytes))
    }

    fn fixture_invalid_dt() -> Result<(u32, [u8; 32], String, Vec<u8>)> {
        let challenge_id = 3u32;
        let player_pubkey = [7u8; 32];
        let prompt = "a".to_string();
        let events = vec![ReplayEvent { dt_ms: 5, key: 0 }];
        let events_bytes = encode_events(&events)?;
        Ok((challenge_id, player_pubkey, prompt, events_bytes))
    }

    #[test]
    fn perfect_run_accuracy_is_full() -> Result<()> {
        init_test_env();
        let (challenge_id, player_pubkey, prompt, events_bytes) = fixture_perfect()?;
        let result = prove(challenge_id, player_pubkey, &prompt, &events_bytes)?;
        assert_eq!(result.journal.accuracy_bps, 10000);
        Ok(())
    }

    #[test]
    fn mistakes_reduce_accuracy() -> Result<()> {
        init_test_env();
        let (challenge_id, player_pubkey, prompt, events_bytes) = fixture_mistake()?;
        let result = prove(challenge_id, player_pubkey, &prompt, &events_bytes)?;
        assert!(result.journal.accuracy_bps < 10000);
        Ok(())
    }

    #[test]
    fn invalid_dt_fails() -> Result<()> {
        init_test_env();
        let (challenge_id, player_pubkey, prompt, events_bytes) = fixture_invalid_dt()?;
        let result = prove(challenge_id, player_pubkey, &prompt, &events_bytes);
        assert!(result.is_err());
        Ok(())
    }

    #[test]
    fn journal_hash_deterministic() -> Result<()> {
        init_test_env();
        let (challenge_id, player_pubkey, prompt, events_bytes) = fixture_perfect()?;
        let first = prove(challenge_id, player_pubkey, &prompt, &events_bytes)?;
        let second = prove(challenge_id, player_pubkey, &prompt, &events_bytes)?;
        assert_eq!(first.journal_sha256, second.journal_sha256);
        Ok(())
    }
}
