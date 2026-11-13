use chacha20poly1305::{aead::{Aead, Payload}, ChaCha20Poly1305, KeyInit};
use hkdf::Hkdf;
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey, StaticSecret};

#[derive(Debug, PartialEq, Eq)]
pub struct SessionKeys {
    pub session_id: [u8; 8],
    pub key_s2r: [u8; 32],
    pub key_r2s: [u8; 32],
    pub sas_code: String,
}

pub fn derive_session_keys(
    my_sk: &StaticSecret,
    my_instance: &[u8; 8],
    peer_pk: &PublicKey,
    peer_instance: &[u8; 8],
) -> Option<SessionKeys> {
    let shared = my_sk.diffie_hellman(peer_pk);
    if !shared.was_contributory() {
        return None;
    }
    let mut salt = [0; 16];
    let (first, second) = if my_instance <= peer_instance {
        (my_instance, peer_instance)
    } else {
        (peer_instance, my_instance)
    };
    salt[..8].copy_from_slice(first);
    salt[8..].copy_from_slice(second);
    let hkdf = Hkdf::<Sha256>::new(Some(&salt), shared.as_bytes());
    let mut keys = [0; 64];
    hkdf.expand(b"PathBlender-BLE-v1", &mut keys).expect("HKDF output length is fixed");
    let mut session_id = [0; 8];
    hkdf.expand(b"pb-ble-sid", &mut session_id).expect("HKDF output length is fixed");
    let mut sas = [0; 4];
    hkdf.expand(b"pb-ble-sas-v1", &mut sas).expect("HKDF output length is fixed");
    Some(SessionKeys {
        session_id,
        key_s2r: keys[..32].try_into().expect("32-byte key"),
        key_r2s: keys[32..].try_into().expect("32-byte key"),
        sas_code: format!("{:06}", u32::from_be_bytes(sas) % 1_000_000),
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SealedFrame {
    pub counter: u64,
    pub ct: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CryptoError {
    Replayed,
    OpenFailed,
}

pub struct DirCrypto {
    key: [u8; 32],
    dir_tag: u32,
    session_id: [u8; 8],
    next_counter: u64,
    last_accepted: u64,
}

impl DirCrypto {
    pub fn new(key: [u8; 32], dir_tag: u32, session_id: [u8; 8]) -> Self {
        Self {
            key,
            dir_tag,
            session_id,
            next_counter: 1,
            last_accepted: 0,
        }
    }

    pub fn seal(&mut self, plaintext: &[u8]) -> SealedFrame {
        let counter = self.next_counter;
        self.next_counter = self.next_counter.checked_add(1).expect("BLE counter space exhausted");
        let cipher = ChaCha20Poly1305::new(&self.key.into());
        let (nonce, aad) = self.nonce_and_aad(counter);
        let ct = cipher
            .encrypt(&nonce.into(), Payload { msg: plaintext, aad: &aad })
            .expect("bounded BLE frames cannot exceed the AEAD limit");
        SealedFrame { counter, ct }
    }

    pub fn open(&mut self, sealed: &SealedFrame) -> Result<Vec<u8>, CryptoError> {
        if sealed.counter <= self.last_accepted {
            return Err(CryptoError::Replayed);
        }
        let cipher = ChaCha20Poly1305::new(&self.key.into());
        let (nonce, aad) = self.nonce_and_aad(sealed.counter);
        let plaintext = cipher
            .decrypt(&nonce.into(), Payload { msg: &sealed.ct, aad: &aad })
            .map_err(|_| CryptoError::OpenFailed)?;
        self.last_accepted = sealed.counter;
        Ok(plaintext)
    }

    fn nonce_and_aad(&self, counter: u64) -> ([u8; 12], [u8; 16]) {
        let mut nonce = [0; 12];
        nonce[..4].copy_from_slice(&self.dir_tag.to_le_bytes());
        nonce[4..].copy_from_slice(&counter.to_le_bytes());
        let mut aad = [0; 16];
        aad[..8].copy_from_slice(&self.session_id);
        aad[8..].copy_from_slice(&counter.to_le_bytes());
        (nonce, aad)
    }
}

pub fn sha256(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ble::proto::{self, FileBegin, Frame};
    use x25519_dalek::{PublicKey, StaticSecret};

    fn hex(input: &str) -> Vec<u8> {
        input.as_bytes().chunks_exact(2).map(|pair| {
            u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap()
        }).collect()
    }

    #[test]
    fn x25519_matches_rfc7748() {
        let alice_bytes: [u8; 32] = hex("77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c6a").try_into().unwrap();
        let bob_bytes: [u8; 32] = hex("5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb").try_into().unwrap();
        let alice = StaticSecret::from(alice_bytes);
        let bob = StaticSecret::from(bob_bytes);
        let alice_public = PublicKey::from(&alice);
        let bob_public = PublicKey::from(&bob);
        assert_eq!(alice_public.to_bytes().as_slice(), hex("8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a"));
        assert_eq!(bob_public.to_bytes().as_slice(), hex("de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f"));
        assert_eq!(alice.diffie_hellman(&bob_public).to_bytes().as_slice(), hex("4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742"));
    }

    #[test]
    fn hkdf_matches_rfc5869_case_one() {
        let ikm = hex(&"0b".repeat(22));
        let (prk, hkdf) = Hkdf::<Sha256>::extract(Some(&hex("000102030405060708090a0b0c")), &ikm);
        assert_eq!(prk.as_slice(), hex("077709362c2e32df0ddc3f0dc47bba6390b6c73bb50f9c3122ec844ad7c2b3e5"));
        let mut okm = [0; 42];
        hkdf.expand(&hex("f0f1f2f3f4f5f6f7f8f9"), &mut okm).unwrap();
        assert_eq!(okm.as_slice(), hex("3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865"));
    }

    #[test]
    fn chacha20_poly1305_matches_rfc8439() {
        let key: [u8; 32] = hex("808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f").try_into().unwrap();
        let cipher = ChaCha20Poly1305::new(&key.into());
        let nonce = hex("070000004041424344454647");
        let aad = hex("50515253c0c1c2c3c4c5c6c7");
        let plaintext = b"Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.";
        let encrypted = cipher.encrypt(nonce.as_slice().into(), Payload { msg: plaintext, aad: &aad }).unwrap();
        assert_eq!(encrypted, hex(concat!(
            "d31a8d34648e60db7b86afbc53ef7ec2a4aded51296e08fea9e2b5a736ee62d63dbea45e8ca9671282fafb69da92728b1a71de0a9e060b2905d6a5b67ecd3b3692ddbd7f2d778b8c9803aee328091b58fab324e4fad675945585808b4831d7bc3ff4def08e4b7a9de576d26586cec64b6116",
            "1ae10b594f09e26a7e902ecbd0600691"
        )));
    }

    #[test]
    fn session_keys_are_symmetric_and_sas_is_stable() {
        let a = StaticSecret::from([1; 32]);
        let b = StaticSecret::from([2; 32]);
        let a_keys = derive_session_keys(&a, &[3; 8], &PublicKey::from(&b), &[4; 8]).unwrap();
        let b_keys = derive_session_keys(&b, &[4; 8], &PublicKey::from(&a), &[3; 8]).unwrap();
        assert_eq!(a_keys, b_keys);
        assert_eq!(a_keys.sas_code.len(), 6);
        assert!(a_keys.sas_code.bytes().all(|c| c.is_ascii_digit()));
        let changed = derive_session_keys(&a, &[3; 8], &PublicKey::from(&StaticSecret::from([9; 32])), &[4; 8]).unwrap();
        assert_ne!(a_keys.sas_code, changed.sas_code);
    }

    #[test]
    fn crypto_round_trip_and_tamper_failure_do_not_advance_state() {
        let mut writer = DirCrypto::new([7; 32], 1, [8; 8]);
        let mut reader = DirCrypto::new([7; 32], 1, [8; 8]);
        let sealed = writer.seal(b"hello");
        assert_eq!(reader.open(&sealed).unwrap(), b"hello");
        let second = writer.seal(b"hello");
        let mut tampered = second.clone();
        tampered.ct[0] ^= 1;
        assert_eq!(reader.open(&tampered), Err(CryptoError::OpenFailed));
        assert_eq!(reader.open(&tampered), Err(CryptoError::OpenFailed));
        assert_ne!(sealed.counter, second.counter);
        assert_ne!(sealed.ct, second.ct);
        assert_eq!(reader.open(&second).unwrap(), b"hello");
    }

    #[test]
    fn lost_frames_replays_and_retransmits_follow_counter_contract() {
        let mut writer = DirCrypto::new([3; 32], 2, [5; 8]);
        let mut reader = DirCrypto::new([3; 32], 2, [5; 8]);
        let frames: Vec<_> = (0..5).map(|_| writer.seal(b"data")).collect();
        assert_eq!(reader.open(&frames[0]).unwrap(), b"data");
        assert_eq!(reader.open(&frames[4]).unwrap(), b"data");
        assert_eq!(reader.open(&frames[4]), Err(CryptoError::Replayed));
        assert_eq!(reader.open(&frames[0]), Err(CryptoError::Replayed));
    }

    #[test]
    fn non_contributory_x25519_handshakes_are_rejected() {
        let private = StaticSecret::from([1; 32]);
        let low_order = PublicKey::from([0; 32]);
        assert!(derive_session_keys(&private, &[3; 8], &low_order, &[4; 8]).is_none());
    }

    #[test]
    fn all_largest_encrypted_frames_stay_within_180_bytes() {
        let frames = vec![
            Frame::Confirm { accepted: true },
            Frame::FileBegin(FileBegin { file_index: 1, name: "x".repeat(proto::MAX_NAME_BYTES), size: 10, sha256: [1; 32] }),
            Frame::FileAccept { file_index: 1, accepted: true },
            Frame::Chunk { file_index: 1, seq: 1, data: vec![1; proto::MAX_CHUNK_DATA] },
            Frame::ChunkAck { file_index: 1, cum_seq: 1 },
            Frame::Resync { file_index: 1, expected_seq: 1 },
            Frame::FileEnd { file_index: 1 },
            Frame::FileDone { file_index: 1, ok: true },
            Frame::FileCancel { file_index: 1, reason: 1 },
            Frame::SessionCancel { reason: 1 },
            Frame::Keepalive,
        ];
        let mut crypto = DirCrypto::new([1; 32], 1, [2; 8]);
        for frame in frames {
            let payload = proto::encode_payload(&frame);
            let frame_type = proto::encode_encrypted_body(&frame)[0];
            let sealed = crypto.seal(&payload);
            let wire = proto::encode(&Frame::Sealed(proto::SealedBody { frame_type, counter: sealed.counter, ct: sealed.ct })).unwrap();
            assert!(wire.len() <= proto::MAX_FRAME);
            if matches!(frame, Frame::Chunk { .. } | Frame::FileBegin(_)) {
                assert_eq!(wire.len(), proto::MAX_FRAME);
            }
        }
    }
}
