#![cfg_attr(target_os = "zkvm", no_std)]
#![cfg_attr(target_os = "zkvm", no_main)]

extern crate alloc;

#[cfg(target_os = "zkvm")]
mod guest {
    use alloc::vec::Vec;
    use core::cmp::min;
    use risc0_zkvm::guest::env;
    use sha2::{Digest, Sha256};

    const MIN_DT_MS: u16 = 10;
    const KEY_MAX: u8 = 28;
    const KEY_SPACE: u8 = 26;
    const KEY_BACKSPACE: u8 = 27;
    const KEY_ENTER: u8 = 28;
    const JOURNAL_LEN: usize = 88;

    pub fn main() {
        let challenge_id: u32 = env::read();
        let prompt_hash: [u8; 32] = env::read();
        let player_pubkey: [u8; 32] = env::read();
        let prompt_bytes: Vec<u8> = env::read();
        let events_bytes: Vec<u8> = env::read();

        let computed_hash = sha256(&prompt_bytes);
        if computed_hash != prompt_hash {
            panic!("prompt hash mismatch");
        }

        let prompt_len = prompt_bytes.len() as u32;
        if prompt_len == 0 {
            panic!("prompt length is zero");
        }

        let events = parse_events(&events_bytes);
        let mut duration_ms: u64 = 0;
        let mut output: Vec<u8> = Vec::new();

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
                KEY_BACKSPACE => {
                    output.pop();
                }
                KEY_ENTER => {
                    // Optional end marker; ignored for output.
                }
                _ => panic!("invalid key"),
            }
        }

        let min_duration = prompt_len as u64 * 40;
        if duration_ms < min_duration {
            panic!("duration too short");
        }
        if duration_ms == 0 {
            panic!("duration is zero");
        }

        let typed_chars = output.len() as u32;
        let mut correct_chars: u32 = 0;
        let cmp_len = min(output.len(), prompt_bytes.len());
        for i in 0..cmp_len {
            if output[i] == prompt_bytes[i] {
                correct_chars = correct_chars.saturating_add(1);
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
        env::commit_slice(&journal);
    }

    fn sha256(data: &[u8]) -> [u8; 32] {
        let mut hasher = Sha256::new();
        hasher.update(data);
        let result = hasher.finalize();
        let mut out = [0u8; 32];
        out.copy_from_slice(&result);
        out
    }

    fn parse_events(bytes: &[u8]) -> Vec<(u16, u8)> {
        if bytes.len() < 2 {
            panic!("events bytes too short");
        }
        let len = u16::from_le_bytes([bytes[0], bytes[1]]) as usize;
        let expected = 2 + len * 3;
        if bytes.len() != expected {
            panic!("events length mismatch");
        }

        let mut events = Vec::with_capacity(len);
        let mut offset = 2;
        for _ in 0..len {
            let dt = u16::from_le_bytes([bytes[offset], bytes[offset + 1]]);
            let key = bytes[offset + 2];
            if key > KEY_MAX {
                panic!("invalid key");
            }
            events.push((dt, key));
            offset += 3;
        }
        events
    }

    fn encode_journal(
        challenge_id: u32,
        player_pubkey: &[u8; 32],
        prompt_hash: &[u8; 32],
        score: u64,
        wpm_x100: u32,
        accuracy_bps: u32,
        duration_ms: u32,
    ) -> [u8; JOURNAL_LEN] {
        let mut out = [0u8; JOURNAL_LEN];
        let mut offset = 0;

        out[offset..offset + 4].copy_from_slice(&challenge_id.to_le_bytes());
        offset += 4;

        out[offset..offset + 32].copy_from_slice(player_pubkey);
        offset += 32;

        out[offset..offset + 32].copy_from_slice(prompt_hash);
        offset += 32;

        out[offset..offset + 8].copy_from_slice(&score.to_le_bytes());
        offset += 8;

        out[offset..offset + 4].copy_from_slice(&wpm_x100.to_le_bytes());
        offset += 4;

        out[offset..offset + 4].copy_from_slice(&accuracy_bps.to_le_bytes());
        offset += 4;

        out[offset..offset + 4].copy_from_slice(&duration_ms.to_le_bytes());

        out
    }
}

#[cfg(target_os = "zkvm")]
risc0_zkvm::guest::entry!(guest::main);

#[cfg(not(target_os = "zkvm"))]
fn main() {}
