#![no_std]

use soroban_sdk::contract;
use soroban_sdk::contractimpl;

#[contract]
pub struct Leaderboard;

fn version_internal() -> u32 {
    1
}

#[contractimpl]
impl Leaderboard {
    pub fn version() -> u32 {
        version_internal()
    }
}

#[cfg(test)]
extern crate std;

#[cfg(test)]
mod tests {
    use super::version_internal;

    #[test]
    fn version_is_one() {
        assert_eq!(version_internal(), 1);
    }
}
