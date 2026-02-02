#![no_std]

use core::cmp::Ordering;

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, Address, Bytes, BytesN,
    Env, String, Vec,
};

const TOP_N: u32 = 20;
const MIN_NAME_LEN: u32 = 1;
const MAX_NAME_LEN: u32 = 24;
const ASCII_PRINTABLE_MIN: u8 = 0x20;
const ASCII_PRINTABLE_MAX: u8 = 0x7E;

#[contract]
pub struct Leaderboard;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ScoreEntry {
    pub score: u64,
    pub wpm_x100: u32,
    pub accuracy_bps: u32,
    pub duration_ms: u32,
    pub name: String,
    pub submitted_ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LeaderboardRow {
    pub player: Address,
    pub name: String,
    pub score: u64,
    pub wpm_x100: u32,
    pub accuracy_bps: u32,
}

#[contracttype]
enum DataKey {
    Admin,
    VerifierId,
    ImageId,
    CurrentChallengeId,
    ChallengePromptHash(u32),
    Best(u32, Address),
    Top(u32),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidName = 3,
    InvalidPromptHash = 4,
    InvalidChallenge = 5,
    InvalidPlayer = 6,
    InvalidImageId = 7,
    ProofVerificationFailed = 8,
}

fn require_admin(env: &Env) -> Address {
    let admin = read_admin(env);
    admin.require_auth();
    admin
}

fn read_admin(env: &Env) -> Address {
    env.storage()
        .persistent()
        .get(&DataKey::Admin)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

fn read_image_id(env: &Env) -> BytesN<32> {
    env.storage()
        .persistent()
        .get(&DataKey::ImageId)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

fn read_verifier_id(env: &Env) -> Address {
    env.storage()
        .persistent()
        .get(&DataKey::VerifierId)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
}

fn validate_name(env: &Env, name: &String) {
    let len = name.len();
    if len < MIN_NAME_LEN || len > MAX_NAME_LEN {
        panic_with_error!(env, Error::InvalidName);
    }

    let mut buf = [0u8; MAX_NAME_LEN as usize];
    name.copy_into_slice(&mut buf[..len as usize]);
    for b in buf[..len as usize].iter() {
        if *b < ASCII_PRINTABLE_MIN || *b > ASCII_PRINTABLE_MAX {
            panic_with_error!(env, Error::InvalidName);
        }
    }
}

fn verify_proof_stub(
    _env: &Env,
    _verifier_id: &Address,
    _journal_hash: &BytesN<32>,
    _image_id: &BytesN<32>,
    _seal: &Bytes,
) -> bool {
    true
}

fn cmp_rows(a: &LeaderboardRow, b: &LeaderboardRow) -> Ordering {
    if a.score > b.score {
        Ordering::Less
    } else if a.score < b.score {
        Ordering::Greater
    } else {
        a.player.cmp(&b.player)
    }
}

fn sort_rows(rows: &mut Vec<LeaderboardRow>) {
    let len = rows.len();
    let mut i = 0u32;
    while i < len {
        let mut best = i;
        let mut j = i + 1;
        while j < len {
            let candidate = rows.get_unchecked(j);
            let current = rows.get_unchecked(best);
            if cmp_rows(&candidate, &current) == Ordering::Less {
                best = j;
            }
            j += 1;
        }
        if best != i {
            let left = rows.get_unchecked(i);
            let right = rows.get_unchecked(best);
            rows.set(i, right);
            rows.set(best, left);
        }
        i += 1;
    }
}

fn upsert_top(env: &Env, challenge_id: u32, row: LeaderboardRow) {
    let storage = env.storage().persistent();
    let mut top: Vec<LeaderboardRow> = storage
        .get(&DataKey::Top(challenge_id))
        .unwrap_or_else(|| Vec::new(env));

    let mut existing_index: Option<u32> = None;
    let mut i = 0u32;
    while i < top.len() {
        let entry = top.get_unchecked(i);
        if entry.player == row.player {
            existing_index = Some(i);
            break;
        }
        i += 1;
    }

    if let Some(idx) = existing_index {
        top.set(idx, row);
    } else if top.len() < TOP_N {
        top.push_back(row);
    } else {
        let mut min_idx = 0u32;
        let mut min_score = top.get_unchecked(0).score;
        let mut j = 1u32;
        while j < top.len() {
            let entry = top.get_unchecked(j);
            if entry.score < min_score {
                min_score = entry.score;
                min_idx = j;
            }
            j += 1;
        }
        if row.score > min_score {
            top.set(min_idx, row);
        } else {
            return;
        }
    }

    sort_rows(&mut top);
    while top.len() > TOP_N {
        top.pop_back();
    }

    storage.set(&DataKey::Top(challenge_id), &top);
}

#[contractimpl]
impl Leaderboard {
    pub fn init(env: Env, admin: Address, verifier_id: Address, image_id: BytesN<32>) {
        let storage = env.storage().persistent();
        if storage.has(&DataKey::Admin) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        storage.set(&DataKey::Admin, &admin);
        storage.set(&DataKey::VerifierId, &verifier_id);
        storage.set(&DataKey::ImageId, &image_id);
    }

    pub fn set_challenge(env: Env, challenge_id: u32, prompt_hash: BytesN<32>) {
        require_admin(&env);
        env.storage()
            .persistent()
            .set(&DataKey::ChallengePromptHash(challenge_id), &prompt_hash);
    }

    pub fn set_current_challenge(env: Env, challenge_id: u32) {
        require_admin(&env);
        let storage = env.storage().persistent();
        if !storage.has(&DataKey::ChallengePromptHash(challenge_id)) {
            panic_with_error!(&env, Error::InvalidChallenge);
        }
        storage.set(&DataKey::CurrentChallengeId, &challenge_id);
    }

    pub fn get_current_challenge(env: Env) -> (u32, BytesN<32>) {
        let storage = env.storage().persistent();
        let challenge_id: u32 = storage
            .get(&DataKey::CurrentChallengeId)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized));
        let prompt_hash: BytesN<32> = storage
            .get(&DataKey::ChallengePromptHash(challenge_id))
            .unwrap_or_else(|| panic_with_error!(&env, Error::InvalidChallenge));
        (challenge_id, prompt_hash)
    }

    pub fn get_best(env: Env, challenge_id: u32, player: Address) -> Option<ScoreEntry> {
        env.storage()
            .persistent()
            .get(&DataKey::Best(challenge_id, player))
    }

    pub fn get_top(env: Env, challenge_id: u32) -> Vec<LeaderboardRow> {
        env.storage()
            .persistent()
            .get(&DataKey::Top(challenge_id))
            .unwrap_or_else(|| Vec::new(&env))
    }

    #[allow(clippy::too_many_arguments)]
    pub fn submit_score(
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
        seal: Bytes,
    ) {
        player.require_auth();

        validate_name(&env, &name);

        let storage = env.storage().persistent();
        let stored_prompt_hash: BytesN<32> = storage
            .get(&DataKey::ChallengePromptHash(challenge_id))
            .unwrap_or_else(|| panic_with_error!(&env, Error::InvalidChallenge));
        if stored_prompt_hash != prompt_hash {
            panic_with_error!(&env, Error::InvalidPromptHash);
        }

        let current_challenge: u32 = storage
            .get(&DataKey::CurrentChallengeId)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized));
        if challenge_id != current_challenge {
            panic_with_error!(&env, Error::InvalidChallenge);
        }

        let stored_image_id = read_image_id(&env);
        if stored_image_id != image_id {
            panic_with_error!(&env, Error::InvalidImageId);
        }

        let verifier_id = read_verifier_id(&env);
        if !verify_proof_stub(&env, &verifier_id, &journal_hash, &image_id, &seal) {
            panic_with_error!(&env, Error::ProofVerificationFailed);
        }

        let best_key = DataKey::Best(challenge_id, player.clone());
        let best_existing: Option<ScoreEntry> = storage.get(&best_key);
        let should_update = match best_existing {
            None => true,
            Some(ref entry) => score > entry.score,
        };
        if !should_update {
            return;
        }

        let entry = ScoreEntry {
            score,
            wpm_x100,
            accuracy_bps,
            duration_ms,
            name: name.clone(),
            submitted_ledger: env.ledger().sequence(),
        };
        storage.set(&best_key, &entry);

        let row = LeaderboardRow {
            player,
            name,
            score,
            wpm_x100,
            accuracy_bps,
        };
        upsert_top(&env, challenge_id, row);
    }
}

#[cfg(test)]
extern crate std;

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger, MockAuth, MockAuthInvoke};
    use soroban_sdk::{Bytes, IntoVal};
    use std::panic::{catch_unwind, AssertUnwindSafe};

    fn setup() -> (Env, Address, Address, Address, BytesN<32>) {
        let env = Env::default();
        let contract_id = env.register(Leaderboard, ());
        let client = LeaderboardClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let verifier = Address::generate(&env);
        let image_id = BytesN::from_array(&env, &[7u8; 32]);
        client.init(&admin, &verifier, &image_id);
        (env, contract_id, admin, verifier, image_id)
    }

    fn set_challenge(
        env: &Env,
        contract_id: &Address,
        client: &LeaderboardClient,
        admin: &Address,
        challenge_id: u32,
        prompt_hash: &BytesN<32>,
    ) {
        env.mock_auths(&[MockAuth {
            address: admin,
            invoke: &MockAuthInvoke {
                contract: contract_id,
                fn_name: "set_challenge",
                args: (challenge_id, prompt_hash).into_val(env),
                sub_invokes: &[],
            },
        }]);
        client.set_challenge(&challenge_id, prompt_hash);
    }

    fn set_current_challenge(
        env: &Env,
        contract_id: &Address,
        client: &LeaderboardClient,
        admin: &Address,
        challenge_id: u32,
    ) {
        env.mock_auths(&[MockAuth {
            address: admin,
            invoke: &MockAuthInvoke {
                contract: contract_id,
                fn_name: "set_current_challenge",
                args: (challenge_id,).into_val(env),
                sub_invokes: &[],
            },
        }]);
        client.set_current_challenge(&challenge_id);
    }

    fn submit_with_auth(
        env: &Env,
        contract_id: &Address,
        client: &LeaderboardClient,
        challenge_id: u32,
        player: &Address,
        name: &String,
        prompt_hash: &BytesN<32>,
        score: u64,
        wpm_x100: u32,
        accuracy_bps: u32,
        duration_ms: u32,
        journal_hash: &BytesN<32>,
        image_id: &BytesN<32>,
        seal: &Bytes,
    ) {
        env.mock_auths(&[MockAuth {
            address: player,
            invoke: &MockAuthInvoke {
                contract: contract_id,
                fn_name: "submit_score",
                args: (
                    challenge_id,
                    player,
                    name,
                    prompt_hash,
                    score,
                    wpm_x100,
                    accuracy_bps,
                    duration_ms,
                    journal_hash,
                    image_id,
                    seal,
                )
                    .into_val(env),
                sub_invokes: &[],
            },
        }]);
        client.submit_score(
            &challenge_id,
            player,
            name,
            prompt_hash,
            &score,
            &wpm_x100,
            &accuracy_bps,
            &duration_ms,
            journal_hash,
            image_id,
            seal,
        );
    }

    #[test]
    fn admin_only_checks() {
        let (env, contract_id, admin, _verifier, _image_id) = setup();
        let client = LeaderboardClient::new(&env, &contract_id);
        let prompt_hash = BytesN::from_array(&env, &[1u8; 32]);
        let non_admin = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &non_admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_challenge",
                args: (1u32, &prompt_hash).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        assert!(catch_unwind(AssertUnwindSafe(|| {
            client.set_challenge(&1, &prompt_hash)
        }))
        .is_err());

        set_challenge(&env, &contract_id, &client, &admin, 1, &prompt_hash);

        env.mock_auths(&[MockAuth {
            address: &non_admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_current_challenge",
                args: (1u32,).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        assert!(catch_unwind(AssertUnwindSafe(|| {
            client.set_current_challenge(&1)
        }))
        .is_err());

        set_current_challenge(&env, &contract_id, &client, &admin, 1);
    }

    #[test]
    fn rejects_invalid_inputs() {
        let (env, contract_id, admin, _verifier, image_id) = setup();
        let client = LeaderboardClient::new(&env, &contract_id);
        let prompt_hash = BytesN::from_array(&env, &[2u8; 32]);
        let other_prompt = BytesN::from_array(&env, &[3u8; 32]);
        set_challenge(&env, &contract_id, &client, &admin, 1, &prompt_hash);
        set_challenge(&env, &contract_id, &client, &admin, 2, &other_prompt);
        set_current_challenge(&env, &contract_id, &client, &admin, 1);

        let player = Address::generate(&env);
        let other_player = Address::generate(&env);
        let name = String::from_str(&env, "alice");
        let journal_hash = BytesN::from_array(&env, &[9u8; 32]);
        let seal = Bytes::from_slice(&env, &[1, 2, 3]);

        env.mock_auths(&[MockAuth {
            address: &other_player,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "submit_score",
                args: (
                    1u32,
                    &player,
                    &name,
                    &prompt_hash,
                    100u64,
                    12000u32,
                    9500u32,
                    60000u32,
                    &journal_hash,
                    &image_id,
                    &seal,
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }]);
        assert!(catch_unwind(AssertUnwindSafe(|| {
            client.submit_score(
                &1,
                &player,
                &name,
                &prompt_hash,
                &100,
                &12000,
                &9500,
                &60000,
                &journal_hash,
                &image_id,
                &seal,
            );
        }))
        .is_err());

        assert!(catch_unwind(AssertUnwindSafe(|| {
            submit_with_auth(
                &env,
                &contract_id,
                &client,
                1,
                &player,
                &name,
                &other_prompt,
                100,
                12000,
                9500,
                60000,
                &journal_hash,
                &image_id,
                &seal,
            );
        }))
        .is_err());

        assert!(catch_unwind(AssertUnwindSafe(|| {
            submit_with_auth(
                &env,
                &contract_id,
                &client,
                2,
                &player,
                &name,
                &other_prompt,
                100,
                12000,
                9500,
                60000,
                &journal_hash,
                &image_id,
                &seal,
            );
        }))
        .is_err());

        let bad_name = String::from_str(&env, "");
        assert!(catch_unwind(AssertUnwindSafe(|| {
            submit_with_auth(
                &env,
                &contract_id,
                &client,
                1,
                &player,
                &bad_name,
                &prompt_hash,
                100,
                12000,
                9500,
                60000,
                &journal_hash,
                &image_id,
                &seal,
            );
        }))
        .is_err());

        let wrong_image = BytesN::from_array(&env, &[8u8; 32]);
        assert!(catch_unwind(AssertUnwindSafe(|| {
            submit_with_auth(
                &env,
                &contract_id,
                &client,
                1,
                &player,
                &name,
                &prompt_hash,
                100,
                12000,
                9500,
                60000,
                &journal_hash,
                &wrong_image,
                &seal,
            );
        }))
        .is_err());
    }

    #[test]
    fn best_score_updates() {
        let (env, contract_id, admin, _verifier, image_id) = setup();
        let client = LeaderboardClient::new(&env, &contract_id);
        let prompt_hash = BytesN::from_array(&env, &[4u8; 32]);
        set_challenge(&env, &contract_id, &client, &admin, 1, &prompt_hash);
        set_current_challenge(&env, &contract_id, &client, &admin, 1);

        env.ledger().set_sequence_number(123);
        let player = Address::generate(&env);
        let name = String::from_str(&env, "bob");
        let journal_hash = BytesN::from_array(&env, &[5u8; 32]);
        let seal = Bytes::from_slice(&env, &[1]);

        submit_with_auth(
            &env,
            &contract_id,
            &client,
            1,
            &player,
            &name,
            &prompt_hash,
            100,
            11000,
            9900,
            60000,
            &journal_hash,
            &image_id,
            &seal,
        );

        submit_with_auth(
            &env,
            &contract_id,
            &client,
            1,
            &player,
            &name,
            &prompt_hash,
            90,
            10000,
            9800,
            60000,
            &journal_hash,
            &image_id,
            &seal,
        );

        let best = client.get_best(&1, &player).unwrap();
        assert_eq!(best.score, 100);
        assert_eq!(best.submitted_ledger, 123);

        submit_with_auth(
            &env,
            &contract_id,
            &client,
            1,
            &player,
            &name,
            &prompt_hash,
            150,
            13000,
            9950,
            60000,
            &journal_hash,
            &image_id,
            &seal,
        );

        let best = client.get_best(&1, &player).unwrap();
        assert_eq!(best.score, 150);
    }

    #[test]
    fn top_list_behaviour() {
        let (env, contract_id, admin, _verifier, image_id) = setup();
        let client = LeaderboardClient::new(&env, &contract_id);
        let prompt_hash = BytesN::from_array(&env, &[6u8; 32]);
        set_challenge(&env, &contract_id, &client, &admin, 1, &prompt_hash);
        set_current_challenge(&env, &contract_id, &client, &admin, 1);

        let journal_hash = BytesN::from_array(&env, &[7u8; 32]);
        let seal = Bytes::from_slice(&env, &[2, 3]);

        let mut players: std::vec::Vec<Address> = std::vec::Vec::new();
        for i in 0..20u32 {
            let player = Address::generate(&env);
            let name = String::from_str(&env, "p");
            let score = 100u64 - i as u64;
            submit_with_auth(
                &env,
                &contract_id,
                &client,
                1,
                &player,
                &name,
                &prompt_hash,
                score,
                10000,
                9900,
                60000,
                &journal_hash,
                &image_id,
                &seal,
            );
            players.push(player);
        }

        let top = client.get_top(&1);
        assert_eq!(top.len(), 20);

        let low_player = Address::generate(&env);
        let name = String::from_str(&env, "low");
        submit_with_auth(
            &env,
            &contract_id,
            &client,
            1,
            &low_player,
            &name,
            &prompt_hash,
            10,
            9000,
            9000,
            60000,
            &journal_hash,
            &image_id,
            &seal,
        );
        let top_after_low = client.get_top(&1);
        assert_eq!(top_after_low.len(), 20);

        let high_player = Address::generate(&env);
        let name = String::from_str(&env, "high");
        submit_with_auth(
            &env,
            &contract_id,
            &client,
            1,
            &high_player,
            &name,
            &prompt_hash,
            1000,
            20000,
            9999,
            60000,
            &journal_hash,
            &image_id,
            &seal,
        );
        let top_after_high = client.get_top(&1);
        assert_eq!(top_after_high.len(), 20);
        let first = top_after_high.get_unchecked(0);
        assert_eq!(first.player, high_player);

        let update_player = players[5].clone();
        let name = String::from_str(&env, "upd");
        submit_with_auth(
            &env,
            &contract_id,
            &client,
            1,
            &update_player,
            &name,
            &prompt_hash,
            2000,
            25000,
            9999,
            60000,
            &journal_hash,
            &image_id,
            &seal,
        );
        let top_after_update = client.get_top(&1);
        let first = top_after_update.get_unchecked(0);
        assert_eq!(first.player, update_player);

        let tie_score = 500;
        let tie_player_a = Address::generate(&env);
        let tie_player_b = Address::generate(&env);
        let name = String::from_str(&env, "tie");

        submit_with_auth(
            &env,
            &contract_id,
            &client,
            1,
            &tie_player_a,
            &name,
            &prompt_hash,
            tie_score,
            15000,
            9900,
            60000,
            &journal_hash,
            &image_id,
            &seal,
        );
        submit_with_auth(
            &env,
            &contract_id,
            &client,
            1,
            &tie_player_b,
            &name,
            &prompt_hash,
            tie_score,
            15000,
            9900,
            60000,
            &journal_hash,
            &image_id,
            &seal,
        );

        let top_after_tie = client.get_top(&1);
        let mut tie_positions: std::vec::Vec<Address> = std::vec::Vec::new();
        let mut idx = 0u32;
        while idx < top_after_tie.len() {
            let row = top_after_tie.get_unchecked(idx);
            if row.score == tie_score {
                tie_positions.push(row.player);
            }
            idx += 1;
        }
        if tie_player_a < tie_player_b {
            assert!(tie_positions.iter().position(|p| p == &tie_player_a)
                < tie_positions.iter().position(|p| p == &tie_player_b));
        } else {
            assert!(tie_positions.iter().position(|p| p == &tie_player_b)
                < tie_positions.iter().position(|p| p == &tie_player_a));
        }
    }
}
