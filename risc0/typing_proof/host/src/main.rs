use anyhow::{anyhow, Result};
use hex::encode as hex_encode;
use typing_proof_host::{encode_events, normalize_prompt, prove, ReplayEvent, KEY_ENTER, KEY_SPACE};

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let (challenge_id, player_pubkey, prompt, events_bytes) = if args.len() == 1 {
        default_fixture()?
    } else if args.len() == 5 {
        let challenge_id = args[1].parse::<u32>()?;
        let player_pubkey = parse_hex_32(&args[2])?;
        let prompt = args[3].clone();
        let events_bytes = hex::decode(&args[4])?;
        (challenge_id, player_pubkey, prompt, events_bytes)
    } else {
        return Err(anyhow!(
            "usage: typing-proof-host <challenge_id> <player_pubkey_hex> <prompt> <events_hex>"
        ));
    };

    let result = prove(challenge_id, player_pubkey, &prompt, &events_bytes)?;

    println!("image_id: {}", hex_encode(result.image_id));
    println!("seal: {}", hex_encode(&result.seal));
    println!("journal_sha256: {}", hex_encode(result.journal_sha256));
    println!("journal.challenge_id: {}", result.journal.challenge_id);
    println!(
        "journal.player_pubkey: {}",
        hex_encode(result.journal.player_pubkey)
    );
    println!(
        "journal.prompt_hash: {}",
        hex_encode(result.journal.prompt_hash)
    );
    println!("journal.score: {}", result.journal.score);
    println!("journal.wpm_x100: {}", result.journal.wpm_x100);
    println!("journal.accuracy_bps: {}", result.journal.accuracy_bps);
    println!("journal.duration_ms: {}", result.journal.duration_ms);

    Ok(())
}

fn parse_hex_32(value: &str) -> Result<[u8; 32]> {
    let bytes = hex::decode(value)?;
    if bytes.len() != 32 {
        return Err(anyhow!("expected 32-byte hex value"));
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&bytes);
    Ok(out)
}

fn default_fixture() -> Result<(u32, [u8; 32], String, Vec<u8>)> {
    let challenge_id = 1u32;
    let player_pubkey = [7u8; 32];
    let prompt = "hello world".to_string();

    let prompt_bytes = normalize_prompt(&prompt)?;
    let events = prompt_bytes
        .iter()
        .map(|b| match *b {
            b'a'..=b'z' => ReplayEvent {
                dt_ms: 120,
                key: b - b'a',
            },
            b' ' => ReplayEvent {
                dt_ms: 120,
                key: KEY_SPACE,
            },
            _ => ReplayEvent {
                dt_ms: 120,
                key: KEY_ENTER,
            },
        })
        .collect::<Vec<_>>();

    let events_bytes = encode_events(&events)?;
    Ok((challenge_id, player_pubkey, prompt, events_bytes))
}
