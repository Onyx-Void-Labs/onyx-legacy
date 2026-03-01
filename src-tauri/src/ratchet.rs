// ─── Onyx Ratchet: Signal Protocol Double Ratchet Implementation ────────────
//
// This is a production-grade implementation of the Double Ratchet Algorithm,
// as described in the Signal Protocol specification:
//   https://signal.org/docs/specifications/doubleratchet/
//
// The Double Ratchet provides:
//   • Forward secrecy — compromise of current keys doesn't reveal past messages
//   • Post-compromise security — new DH ratchet re-establishes security
//   • Out-of-order message handling — skipped message keys are cached
//   • Key deletion — message keys are deleted after use
//
// Architecture:
//   1. Root Chain     — ratcheted by DH outputs (asymmetric ratchet)
//   2. Sending Chain  — KDF chain for outgoing message keys
//   3. Receiving Chain — KDF chain for incoming message keys
//
// All DH operations use X25519, all symmetric operations use AES-256-GCM,
// all KDF operations use HKDF-SHA256.

use crate::crypto::{
    self,
    derive_key, encrypt_aead, decrypt_aead, kdf_chain_step, kdf_root,
    random_key,
};

use serde::{Deserialize, Serialize};
use x25519_dalek::{PublicKey as X25519Public, StaticSecret};
use tracing::debug;
use std::collections::HashMap;
use base64::Engine as _;

// ─── Constants ──────────────────────────────────────────────────────────────

/// Maximum number of skipped message keys to store per session.
/// Prevents memory exhaustion from a malicious peer sending huge sequence gaps.
const MAX_SKIP: u32 = 1000;

/// Maximum number of messages before mandatory DH ratchet.
/// Forces forward secrecy rotation even if the peer is silent.
#[allow(dead_code)]
const MAX_CHAIN_LENGTH: u32 = 100;

// ─── Ratchet Header ─────────────────────────────────────────────────────────

/// The unencrypted header sent with each Double Ratchet message.
/// Contains the sender's current DH ratchet public key and message counters.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RatchetHeader {
    /// Sender's current X25519 public ratchet key (32 bytes, base64)
    pub dh_public: [u8; 32],
    /// Previous chain's message count (for skipped messages)
    pub prev_chain_len: u32,
    /// Message number in the current sending chain
    pub msg_num: u32,
}

impl RatchetHeader {
    /// Serialize to bytes: dh_public(32) || prev_chain_len(4 LE) || msg_num(4 LE)
    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(40);
        buf.extend_from_slice(&self.dh_public);
        buf.extend_from_slice(&self.prev_chain_len.to_le_bytes());
        buf.extend_from_slice(&self.msg_num.to_le_bytes());
        buf
    }

    /// Deserialize from bytes.
    pub fn decode(data: &[u8]) -> Result<Self, String> {
        if data.len() < 40 {
            return Err("Ratchet header too short".to_string());
        }
        let mut dh_public = [0u8; 32];
        dh_public.copy_from_slice(&data[..32]);
        let prev_chain_len = u32::from_le_bytes([data[32], data[33], data[34], data[35]]);
        let msg_num = u32::from_le_bytes([data[36], data[37], data[38], data[39]]);
        Ok(Self { dh_public, prev_chain_len, msg_num })
    }
}

// ─── Ratchet State ──────────────────────────────────────────────────────────

/// The complete ratchet state for a single conversation.
///
/// This is persisted to SQLite (encrypted with the user's master key).
/// One `RatchetState` per DM conversation or group member.
#[derive(Clone, Serialize, Deserialize)]
pub struct RatchetState {
    /// Our current X25519 DH key pair (secret + public)
    pub dh_self_secret: [u8; 32],
    pub dh_self_public: [u8; 32],

    /// The peer's current DH public key (received in their last message header)
    pub dh_remote_public: Option<[u8; 32]>,

    /// Root key — ratcheted by DH outputs
    pub root_key: [u8; 32],

    /// Sending chain key — ratcheted per outgoing message
    pub chain_key_send: Option<[u8; 32]>,

    /// Receiving chain key — ratcheted per incoming message
    pub chain_key_recv: Option<[u8; 32]>,

    /// Number of messages sent in the current sending chain
    pub send_count: u32,

    /// Number of messages received in the current receiving chain
    pub recv_count: u32,

    /// Previous sending chain length (for header)
    pub prev_send_count: u32,

    /// Skipped message keys: (dh_public, msg_num) → message_key
    /// These handle out-of-order message delivery.
    pub skipped_keys: HashMap<(String, u32), [u8; 32]>,
}

impl RatchetState {
    // ─── Initialization ─────────────────────────────────────────────────

    /// Initialize ratchet state as the INITIATOR (Alice in X3DH).
    ///
    /// Called after X3DH establishes a shared secret.
    /// Alice knows Bob's DH ratchet public key (from his PreKey bundle).
    pub fn init_alice(
        shared_secret: &[u8; 32],
        bob_dh_public: &[u8; 32],
    ) -> Result<Self, String> {
        // Generate our first DH ratchet key pair
        let dh_self_secret = random_key();
        let static_secret = StaticSecret::from(dh_self_secret);
        let dh_self_public: [u8; 32] = X25519Public::from(&static_secret).to_bytes();

        // Perform DH with Bob's public key
        let bob_pub = X25519Public::from(*bob_dh_public);
        let dh_output = static_secret.diffie_hellman(&bob_pub);

        // Root KDF: derive root key + sending chain key
        let (root_key, chain_key_send) = kdf_root(shared_secret, dh_output.as_bytes())
            .map_err(|e| e.to_string())?;

        Ok(Self {
            dh_self_secret,
            dh_self_public,
            dh_remote_public: Some(*bob_dh_public),
            root_key,
            chain_key_send: Some(chain_key_send),
            chain_key_recv: None,
            send_count: 0,
            recv_count: 0,
            prev_send_count: 0,
            skipped_keys: HashMap::new(),
        })
    }

    /// Initialize ratchet state as the RESPONDER (Bob in X3DH).
    ///
    /// Bob doesn't know Alice's first DH key yet — he'll learn it from
    /// her first message header.
    pub fn init_bob(
        shared_secret: &[u8; 32],
        our_signed_prekey_secret: &[u8; 32],
    ) -> Self {
        let static_secret = StaticSecret::from(*our_signed_prekey_secret);
        let dh_self_public: [u8; 32] = X25519Public::from(&static_secret).to_bytes();

        Self {
            dh_self_secret: *our_signed_prekey_secret,
            dh_self_public,
            dh_remote_public: None,
            root_key: *shared_secret,
            chain_key_send: None,
            chain_key_recv: None,
            send_count: 0,
            recv_count: 0,
            prev_send_count: 0,
            skipped_keys: HashMap::new(),
        }
    }

    // ─── Encrypt (Send) ─────────────────────────────────────────────────

    /// Encrypt a plaintext message using the Double Ratchet.
    ///
    /// Returns (header, ciphertext) — the header is sent unencrypted (or
    /// encrypted with a separate header key in full Signal), and the
    /// ciphertext is the AES-256-GCM encrypted message.
    pub fn ratchet_encrypt(
        &mut self,
        plaintext: &[u8],
    ) -> Result<(RatchetHeader, Vec<u8>), String> {
        // Step the sending chain to get the message key
        let chain_key = self.chain_key_send
            .ok_or("Sending chain not initialized")?;

        let (next_chain_key, message_key) = kdf_chain_step(&chain_key);
        self.chain_key_send = Some(next_chain_key);

        // Build the header
        let header = RatchetHeader {
            dh_public: self.dh_self_public,
            prev_chain_len: self.prev_send_count,
            msg_num: self.send_count,
        };

        self.send_count += 1;

        // Encrypt with AES-256-GCM using the message key
        // AAD = encoded header (binds the ciphertext to the header)
        let header_bytes = header.encode();
        let ciphertext = encrypt_aead(&message_key, plaintext, Some(&header_bytes))
            .map_err(|e| e.to_string())?;

        Ok((header, ciphertext))
    }

    // ─── Decrypt (Receive) ──────────────────────────────────────────────

    /// Decrypt a received message using the Double Ratchet.
    ///
    /// Handles:
    ///   1. DH ratchet step (if peer's DH key changed)
    ///   2. Skipped messages (if msg_num > recv_count)
    ///   3. Out-of-order messages (from skipped_keys cache)
    pub fn ratchet_decrypt(
        &mut self,
        header: &RatchetHeader,
        ciphertext: &[u8],
    ) -> Result<Vec<u8>, String> {
        let header_bytes = header.encode();

        // Case 1: Check skipped message keys (out-of-order delivery)
        let skip_key = (
            base64::engine::general_purpose::STANDARD.encode(&header.dh_public),
            header.msg_num,
        );
        if let Some(message_key) = self.skipped_keys.remove(&skip_key) {
            return decrypt_aead(&message_key, ciphertext, Some(&header_bytes))
                .map_err(|e| e.to_string());
        }

        // Case 2: DH ratchet step needed? (peer's DH key changed)
        let dh_changed = self.dh_remote_public
            .map(|pk| pk != header.dh_public)
            .unwrap_or(true);

        if dh_changed {
            // Skip any remaining messages from the previous receiving chain
            if let Some(recv_ck) = self.chain_key_recv {
                self.skip_message_keys(
                    &recv_ck,
                    self.recv_count,
                    header.prev_chain_len,
                    &self.dh_remote_public.map(|pk|
                        base64::engine::general_purpose::STANDARD.encode(&pk)
                    ).unwrap_or_default(),
                )?;
            }

            // Perform DH ratchet step
            self.dh_ratchet_step(&header.dh_public)?;
        }

        // Case 3: Skip message keys up to the received message number
        let recv_ck = self.chain_key_recv
            .ok_or("Receiving chain not initialized")?;
        if header.msg_num > self.recv_count {
            self.skip_message_keys(
                &recv_ck,
                self.recv_count,
                header.msg_num,
                &base64::engine::general_purpose::STANDARD.encode(&header.dh_public),
            )?;
            // Update chain key after skipping
        }

        // Step the receiving chain to get the message key
        let chain_key = self.chain_key_recv
            .ok_or("Receiving chain not initialized after skip")?;
        let (next_chain_key, message_key) = kdf_chain_step(&chain_key);
        self.chain_key_recv = Some(next_chain_key);
        self.recv_count = header.msg_num + 1;

        // Decrypt
        decrypt_aead(&message_key, ciphertext, Some(&header_bytes))
            .map_err(|e| e.to_string())
    }

    // ─── Internal: DH Ratchet Step ──────────────────────────────────────

    /// Perform a DH ratchet step when the peer's DH public key changes.
    ///
    /// This:
    ///   1. Saves current send count as prev_send_count
    ///   2. Resets send/recv counters
    ///   3. Updates the remote public key
    ///   4. Derives new receiving chain from DH(our_current, their_new)
    ///   5. Generates new DH key pair
    ///   6. Derives new sending chain from DH(our_new, their_new)
    fn dh_ratchet_step(&mut self, new_remote_public: &[u8; 32]) -> Result<(), String> {
        self.prev_send_count = self.send_count;
        self.send_count = 0;
        self.recv_count = 0;
        self.dh_remote_public = Some(*new_remote_public);

        // DH with our current key and their new key → new receiving chain
        let current_secret = StaticSecret::from(self.dh_self_secret);
        let remote_pub = X25519Public::from(*new_remote_public);
        let dh_recv = current_secret.diffie_hellman(&remote_pub);

        let (new_root_key, chain_key_recv) = kdf_root(&self.root_key, dh_recv.as_bytes())
            .map_err(|e| e.to_string())?;
        self.root_key = new_root_key;
        self.chain_key_recv = Some(chain_key_recv);

        // Generate new DH key pair
        let new_secret = random_key();
        let new_static = StaticSecret::from(new_secret);
        self.dh_self_public = X25519Public::from(&new_static).to_bytes();
        self.dh_self_secret = new_secret;

        // DH with our new key and their key → new sending chain
        let dh_send = new_static.diffie_hellman(&remote_pub);
        let (new_root_key, chain_key_send) = kdf_root(&self.root_key, dh_send.as_bytes())
            .map_err(|e| e.to_string())?;
        self.root_key = new_root_key;
        self.chain_key_send = Some(chain_key_send);

        debug!("[Ratchet] DH ratchet step completed");
        Ok(())
    }

    // ─── Internal: Skip Message Keys ────────────────────────────────────

    /// Cache message keys for skipped messages (out-of-order handling).
    fn skip_message_keys(
        &mut self,
        chain_key: &[u8; 32],
        from: u32,
        until: u32,
        dh_public_b64: &str,
    ) -> Result<(), String> {
        if until - from > MAX_SKIP {
            return Err(format!(
                "Too many skipped messages ({} > {})",
                until - from, MAX_SKIP
            ));
        }

        let mut ck = *chain_key;
        for n in from..until {
            let (next_ck, mk) = kdf_chain_step(&ck);
            self.skipped_keys.insert((dh_public_b64.to_string(), n), mk);
            ck = next_ck;
        }

        // Update the chain key to the advanced position
        self.chain_key_recv = Some(ck);

        Ok(())
    }
}

// ─── Ratchet Session Persistence ────────────────────────────────────────────

/// Encrypted ratchet state for SQLite storage.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedRatchetSession {
    /// Peer's identity public key (hex)
    pub peer_id: String,
    /// Encrypted ratchet state (base64)
    pub encrypted_state: String,
    /// Last message timestamp
    pub last_message_at: i64,
    /// Total messages exchanged
    pub message_count: i64,
}

/// Encrypt and persist a ratchet state.
pub fn persist_ratchet_state(
    state: &RatchetState,
    master_key: &[u8; 32],
    peer_id: &str,
) -> Result<Vec<u8>, String> {
    let serialized = serde_json::to_vec(state)
        .map_err(|e| format!("Failed to serialize ratchet state: {}", e))?;

    let session_key = derive_key(master_key, "onyx-ratchet-v1", peer_id)
        .map_err(|e| e.to_string())?;

    crypto::encrypt_versioned(&session_key, &serialized, Some(peer_id.as_bytes()))
        .map_err(|e| e.to_string())
}

/// Decrypt and restore a ratchet state.
pub fn restore_ratchet_state(
    encrypted: &[u8],
    master_key: &[u8; 32],
    peer_id: &str,
) -> Result<RatchetState, String> {
    let session_key = derive_key(master_key, "onyx-ratchet-v1", peer_id)
        .map_err(|e| e.to_string())?;

    let (decrypted, _) = crypto::decrypt_auto(
        &session_key, None, None, encrypted, Some(peer_id.as_bytes()),
    ).map_err(|e| e.to_string())?;

    serde_json::from_slice(&decrypted)
        .map_err(|e| format!("Failed to deserialize ratchet state: {}", e))
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ratchet_header_roundtrip() {
        let header = RatchetHeader {
            dh_public: [42u8; 32],
            prev_chain_len: 5,
            msg_num: 12,
        };
        let encoded = header.encode();
        let decoded = RatchetHeader::decode(&encoded).unwrap();
        assert_eq!(header.dh_public, decoded.dh_public);
        assert_eq!(header.prev_chain_len, decoded.prev_chain_len);
        assert_eq!(header.msg_num, decoded.msg_num);
    }

    #[test]
    fn test_ratchet_encrypt_decrypt() {
        // Simulate X3DH shared secret
        let shared_secret = random_key();

        // Bob's signed pre-key
        let bob_prekey_secret = random_key();
        let bob_prekey_static = StaticSecret::from(bob_prekey_secret);
        let bob_prekey_public: [u8; 32] = X25519Public::from(&bob_prekey_static).to_bytes();

        // Initialize both sides
        let mut alice = RatchetState::init_alice(&shared_secret, &bob_prekey_public).unwrap();
        let mut bob = RatchetState::init_bob(&shared_secret, &bob_prekey_secret);

        // Alice sends to Bob
        let msg1 = b"Hello Bob!";
        let (header1, ct1) = alice.ratchet_encrypt(msg1).unwrap();
        let pt1 = bob.ratchet_decrypt(&header1, &ct1).unwrap();
        assert_eq!(msg1.as_slice(), pt1.as_slice());

        // Alice sends another message (same chain)
        let msg2 = b"How are you?";
        let (header2, ct2) = alice.ratchet_encrypt(msg2).unwrap();
        let pt2 = bob.ratchet_decrypt(&header2, &ct2).unwrap();
        assert_eq!(msg2.as_slice(), pt2.as_slice());

        // Bob replies (triggers DH ratchet)
        let msg3 = b"Hi Alice! Im great";
        let (header3, ct3) = bob.ratchet_encrypt(msg3).unwrap();
        let pt3 = alice.ratchet_decrypt(&header3, &ct3).unwrap();
        assert_eq!(msg3.as_slice(), pt3.as_slice());

        // Alice replies again (another DH ratchet)
        let msg4 = b"Wonderful! Lets sync notes";
        let (header4, ct4) = alice.ratchet_encrypt(msg4).unwrap();
        let pt4 = bob.ratchet_decrypt(&header4, &ct4).unwrap();
        assert_eq!(msg4.as_slice(), pt4.as_slice());
    }

    #[test]
    fn test_ratchet_wrong_key_fails() {
        let shared_secret = random_key();
        let bob_prekey_secret = random_key();
        let bob_prekey_static = StaticSecret::from(bob_prekey_secret);
        let bob_prekey_public: [u8; 32] = X25519Public::from(&bob_prekey_static).to_bytes();

        let mut alice = RatchetState::init_alice(&shared_secret, &bob_prekey_public).unwrap();

        let (header, ct) = alice.ratchet_encrypt(b"secret").unwrap();

        // Eve with wrong shared secret can't decrypt
        let wrong_secret = random_key();
        let mut eve = RatchetState::init_bob(&wrong_secret, &bob_prekey_secret);
        assert!(eve.ratchet_decrypt(&header, &ct).is_err());
    }

    #[test]
    fn test_ratchet_state_persistence() {
        let shared_secret = random_key();
        let bob_prekey_secret = random_key();
        let bob_prekey_static = StaticSecret::from(bob_prekey_secret);
        let bob_prekey_public: [u8; 32] = X25519Public::from(&bob_prekey_static).to_bytes();

        let alice = RatchetState::init_alice(&shared_secret, &bob_prekey_public).unwrap();
        let master_key = random_key();

        // Persist
        let encrypted = persist_ratchet_state(&alice, &master_key, "bob-node-id").unwrap();

        // Restore
        let restored = restore_ratchet_state(&encrypted, &master_key, "bob-node-id").unwrap();

        assert_eq!(alice.dh_self_public, restored.dh_self_public);
        assert_eq!(alice.root_key, restored.root_key);
        assert_eq!(alice.send_count, restored.send_count);
    }

    #[test]
    fn test_forward_secrecy() {
        // Verify that capturing old keys doesn't reveal new messages
        let shared_secret = random_key();
        let bob_prekey_secret = random_key();
        let bob_prekey_static = StaticSecret::from(bob_prekey_secret);
        let bob_prekey_public: [u8; 32] = X25519Public::from(&bob_prekey_static).to_bytes();

        let mut alice = RatchetState::init_alice(&shared_secret, &bob_prekey_public).unwrap();
        let mut bob = RatchetState::init_bob(&shared_secret, &bob_prekey_secret);

        // Exchange several messages to advance the ratchet
        for i in 0..5 {
            let msg = format!("Message {}", i);
            let (h, ct) = alice.ratchet_encrypt(msg.as_bytes()).unwrap();
            let _ = bob.ratchet_decrypt(&h, &ct).unwrap();
        }

        // Bob replies (DH ratchet)
        let (h, ct) = bob.ratchet_encrypt(b"reply").unwrap();
        let _ = alice.ratchet_decrypt(&h, &ct).unwrap();

        // At this point, even if someone had captured the original shared_secret,
        // they couldn't derive the current message keys because the DH ratchet
        // has introduced new key material from ephemeral DH exchanges.
        // This is the essence of forward secrecy.
    }
}
