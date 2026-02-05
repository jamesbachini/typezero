use hex::encode as hex_encode;
use typing_proof_host::digest_to_bytes;
use typing_proof_methods::TYPING_PROOF_GUEST_ID;

fn main() {
    let bytes = digest_to_bytes(TYPING_PROOF_GUEST_ID.into());
    println!("image_id: {}", hex_encode(bytes));
}
