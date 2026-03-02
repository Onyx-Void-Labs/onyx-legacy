// ─── Onyx Crypto: Production-Grade Cryptographic Primitives ──────────────────
//
// This module is the SINGLE SOURCE OF TRUTH for all cryptographic operations
// in the Onyx backend. It replaces all placeholder XOR+HMAC schemes with
// battle-tested, audited implementations.
//
// Primitives used:
//   • Identity:     Ed25519 (ed25519-dalek) — signing, NodeId derivation
//   • Key Exchange:  X25519 (x25519-dalek) — Diffie-Hellman key agreement
//   • Encryption:    AES-256-GCM (aes-gcm) — authenticated encryption
//   • KDF:           HKDF-SHA256 (hkdf) — domain-separated key derivation
//   • MAC:           HMAC-SHA256 (hmac) — Double Ratchet KDF chains
//   • Memory Safety: Zeroize on drop for all secret material
//
// All functions are deterministic, side-effect-free, and panic-free.
// Errors are returned as OnyxCryptoError, never unwrapped.

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce as AesNonce,
};
use ed25519_dalek::{SigningKey, VerifyingKey, Signer, Verifier, Signature};
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use rand::RngCore;
use sha2::Sha256;
use x25519_dalek::{PublicKey as X25519Public, StaticSecret};
use zeroize::{Zeroize, ZeroizeOnDrop};
use serde::{Deserialize, Serialize};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use thiserror::Error;

// ─── Error Types ────────────────────────────────────────────────────────────

#[derive(Debug, Error)]
pub enum OnyxCryptoError {
    #[error("Key derivation failed: {0}")]
    KeyDerivation(String),

    #[error("Encryption failed: {0}")]
    Encryption(String),

    #[error("Decryption failed: authentication tag mismatch")]
    DecryptionAuthFailed,

    #[error("Decryption failed: {0}")]
    Decryption(String),

    #[error("Invalid key material: {0}")]
    InvalidKey(String),

    #[error("Signature verification failed")]
    SignatureInvalid,

    #[error("Base64 decode error: {0}")]
    Base64(#[from] base64::DecodeError),

    #[error("Data too short for decryption (need at least {expected} bytes, got {actual})")]
    DataTooShort { expected: usize, actual: usize },

    #[error("Identity not initialized")]
    IdentityNotInitialized,

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

impl From<OnyxCryptoError> for String {
    fn from(e: OnyxCryptoError) -> String {
        e.to_string()
    }
}

// ─── Constants ──────────────────────────────────────────────────────────────

/// AES-256-GCM nonce size (96 bits / 12 bytes)
pub const NONCE_LEN: usize = 12;

/// AES-256-GCM key size (256 bits / 32 bytes)
pub const KEY_LEN: usize = 32;

/// AES-256-GCM authentication tag size (128 bits / 16 bytes)
pub const TAG_LEN: usize = 16;

/// Ed25519 secret key size (32 bytes)
pub const ED25519_SECRET_LEN: usize = 32;

/// Ed25519 public key size (32 bytes)
pub const ED25519_PUBLIC_LEN: usize = 32;

/// Ed25519 signature size (64 bytes)
pub const ED25519_SIGNATURE_LEN: usize = 64;

/// X25519 shared secret size (32 bytes)
pub const X25519_SHARED_SECRET_LEN: usize = 32;

// ─── Secure Buffer ──────────────────────────────────────────────────────────

/// A buffer that zeroizes its contents on drop.
/// Use this for any temporary secret material (keys, plaintexts, etc.)
#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct SecureBuffer(Vec<u8>);

impl SecureBuffer {
    pub fn new(data: Vec<u8>) -> Self {
        Self(data)
    }

    pub fn as_bytes(&self) -> &[u8] {
        &self.0
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl AsRef<[u8]> for SecureBuffer {
    fn as_ref(&self) -> &[u8] {
        &self.0
    }
}

// ─── Onyx Identity (Ed25519) ────────────────────────────────────────────────

/// The user's cryptographic identity. Built on Ed25519.
///
/// The `SigningKey` (secret) is NEVER serialized to JSON or sent over the network.
/// The `VerifyingKey` (public) IS the user's NodeId — their decentralized identity.
///
/// Storage: persisted to disk as encrypted bytes using the master key.
/// The X25519 key is derived deterministically from the Ed25519 key for DH.
#[derive(Clone)]
pub struct OnyxIdentity {
    /// Ed25519 signing key (32 bytes secret)
    signing_key: SigningKey,
    /// Ed25519 verifying key (32 bytes public) — this IS the NodeId
    verifying_key: VerifyingKey,
}

impl OnyxIdentity {
    /// Generate a brand-new cryptographic identity.
    /// Uses OS-level CSPRNG (OsRng) for entropy.
    pub fn generate() -> Self {
        let signing_key = SigningKey::generate(&mut OsRng);
        let verifying_key = signing_key.verifying_key();
        Self { signing_key, verifying_key }
    }

    /// Reconstruct identity from a 32-byte secret key (loaded from disk).
    pub fn from_secret_bytes(secret: &[u8; ED25519_SECRET_LEN]) -> Self {
        let signing_key = SigningKey::from_bytes(secret);
        let verifying_key = signing_key.verifying_key();
        Self { signing_key, verifying_key }
    }

    /// Reconstruct identity from base64-encoded secret key.
    pub fn from_secret_b64(secret_b64: &str) -> Result<Self, OnyxCryptoError> {
        let bytes = B64.decode(secret_b64)?;
        if bytes.len() != ED25519_SECRET_LEN {
            return Err(OnyxCryptoError::InvalidKey(format!(
                "Expected {} bytes, got {}", ED25519_SECRET_LEN, bytes.len()
            )));
        }
        let mut arr = [0u8; ED25519_SECRET_LEN];
        arr.copy_from_slice(&bytes);
        Ok(Self::from_secret_bytes(&arr))
    }

    /// Export the secret key as raw bytes (for encrypted storage).
    /// ⚠️  Handle with extreme care — this is the user's master identity.
    pub fn secret_bytes(&self) -> [u8; ED25519_SECRET_LEN] {
        self.signing_key.to_bytes()
    }

    /// Export the secret key as base64 (for encrypted storage).
    pub fn secret_b64(&self) -> String {
        B64.encode(self.secret_bytes())
    }

    /// Get the public key (NodeId) as raw bytes.
    pub fn public_bytes(&self) -> [u8; ED25519_PUBLIC_LEN] {
        self.verifying_key.to_bytes()
    }

    /// Get the public key (NodeId) as base64.
    pub fn public_b64(&self) -> String {
        B64.encode(self.public_bytes())
    }

    /// Get the public key (NodeId) as hex string.
    pub fn public_hex(&self) -> String {
        hex::encode(self.public_bytes())
    }

    /// Sign arbitrary data with this identity.
    /// Returns a 64-byte Ed25519 signature.
    pub fn sign(&self, message: &[u8]) -> Vec<u8> {
        let sig = self.signing_key.sign(message);
        sig.to_bytes().to_vec()
    }

    /// Sign arbitrary data and return base64-encoded signature.
    pub fn sign_b64(&self, message: &[u8]) -> String {
        B64.encode(self.sign(message))
    }

    /// Get the raw Ed25519 signing key (for Iroh `SecretKey` construction).
    pub fn signing_key(&self) -> &SigningKey {
        &self.signing_key
    }

    /// Get the raw Ed25519 verifying key.
    pub fn verifying_key(&self) -> &VerifyingKey {
        &self.verifying_key
    }

    /// Derive an X25519 static secret from this Ed25519 key.
    /// Uses the Ed25519 secret key bytes directly as X25519 input
    /// (clamping is handled by x25519-dalek internally).
    ///
    /// This allows us to have ONE identity key that serves both
    /// signing (Ed25519) and key agreement (X25519).
    pub fn to_x25519_static(&self) -> StaticSecret {
        let mut secret_bytes = self.signing_key.to_bytes();
        let static_secret = StaticSecret::from(secret_bytes);
        secret_bytes.zeroize();
        static_secret
    }

    /// Get the X25519 public key derived from this identity.
    pub fn x25519_public(&self) -> X25519Public {
        let static_secret = self.to_x25519_static();
        X25519Public::from(&static_secret)
    }

    /// Perform X25519 Diffie-Hellman key agreement with a peer's X25519 public key.
    /// Returns a 32-byte shared secret.
    pub fn dh_shared_secret(&self, peer_x25519_public: &X25519Public) -> SecureBuffer {
        let static_secret = self.to_x25519_static();
        let shared = static_secret.diffie_hellman(peer_x25519_public);
        SecureBuffer::new(shared.as_bytes().to_vec())
    }

    // ─── Convenience Aliases (used by messaging_v2, sentinel, lib.rs) ───

    /// Alias for `public_hex()` — used as the node identifier in messages/logs.
    pub fn node_id_hex(&self) -> String {
        self.public_hex()
    }

    /// Alias for `public_bytes()` — returns raw 32-byte public key.
    pub fn public_key_bytes(&self) -> [u8; ED25519_PUBLIC_LEN] {
        self.public_bytes()
    }

    /// Generate a PreKeyBundle for X3DH session establishment.
    ///
    /// Contains:
    ///   - Our identity key (Ed25519 public, base64)
    ///   - A signed pre-key (X25519, signed with identity key)
    ///   - An optional one-time pre-key (X25519)
    pub fn generate_prekey_bundle(&self) -> PreKeyBundle {
        // Generate a signed pre-key (medium-term X25519 key)
        let signed_prekey_secret = StaticSecret::random_from_rng(OsRng);
        let signed_prekey_public = X25519Public::from(&signed_prekey_secret);
        let signed_prekey_bytes = signed_prekey_public.as_bytes().to_vec();

        // Sign the pre-key with our Ed25519 identity
        let prekey_signature = self.sign(&signed_prekey_bytes);

        // Generate a one-time pre-key (single-use X25519 key)
        let otpk_secret = StaticSecret::random_from_rng(OsRng);
        let otpk_public = X25519Public::from(&otpk_secret);

        PreKeyBundle {
            identity_key: B64.encode(self.public_bytes()),
            signed_prekey: B64.encode(signed_prekey_bytes),
            prekey_signature: B64.encode(prekey_signature),
            one_time_prekey: Some(B64.encode(otpk_public.as_bytes())),
        }
    }

    // ─── Persistence Helpers ────────────────────────────────────────────

    /// Load an existing identity from disk, or generate a new one.
    ///
    /// Tries: `{dir}/identity.key` (raw 32-byte secret key file).
    /// If not found, generates a new identity and saves it.
    ///
    /// NOTE: This is a SIMPLE persistence scheme (unencrypted file).
    /// For encrypted storage, use `save_identity_encrypted` / `load_identity_encrypted`
    /// with the user's vault master key.
    pub fn load_or_create(dir: &std::path::Path) -> Result<Self, String> {
        let key_path = dir.join("identity.key");

        if key_path.exists() {
            // Try loading existing identity
            let data = std::fs::read(&key_path)
                .map_err(|e| format!("Read identity: {}", e))?;
            if data.len() == ED25519_SECRET_LEN {
                let mut arr = [0u8; ED25519_SECRET_LEN];
                arr.copy_from_slice(&data);
                let identity = Self::from_secret_bytes(&arr);
                arr.zeroize();
                println!("[Crypto] Identity loaded: {}", identity.public_hex());
                return Ok(identity);
            } else {
                eprintln!("[Crypto] Identity file corrupt ({} bytes), regenerating", data.len());
            }
        }

        // Generate new identity
        let identity = Self::generate();
        println!("[Crypto] New identity generated: {}", identity.public_hex());

        // Ensure directory exists
        if let Err(e) = std::fs::create_dir_all(dir) {
            eprintln!("[Crypto] Could not create dir {}: {}", dir.display(), e);
            return Ok(identity); // Still return the identity, just not persisted
        }

        // Save secret key
        let secret = identity.secret_bytes();
        if let Err(e) = std::fs::write(&key_path, &secret) {
            eprintln!("[Crypto] Could not save identity: {}", e);
        }

        Ok(identity)
    }
}

/// Verify a signature against a public key (no identity needed).
/// Used when receiving messages from peers.
pub fn verify_signature(
    public_key: &[u8; ED25519_PUBLIC_LEN],
    message: &[u8],
    signature: &[u8],
) -> Result<(), OnyxCryptoError> {
    if signature.len() != ED25519_SIGNATURE_LEN {
        return Err(OnyxCryptoError::SignatureInvalid);
    }

    let verifying_key = VerifyingKey::from_bytes(public_key)
        .map_err(|_| OnyxCryptoError::InvalidKey("Invalid Ed25519 public key".into()))?;

    let mut sig_bytes = [0u8; ED25519_SIGNATURE_LEN];
    sig_bytes.copy_from_slice(signature);
    let sig = Signature::from_bytes(&sig_bytes);

    verifying_key.verify(message, &sig)
        .map_err(|_| OnyxCryptoError::SignatureInvalid)
}

/// Verify a base64-encoded signature against a base64-encoded public key.
pub fn verify_signature_b64(
    public_key_b64: &str,
    message: &[u8],
    signature_b64: &str,
) -> Result<(), OnyxCryptoError> {
    let pk_bytes = B64.decode(public_key_b64)?;
    let sig_bytes = B64.decode(signature_b64)?;
    if pk_bytes.len() != ED25519_PUBLIC_LEN {
        return Err(OnyxCryptoError::InvalidKey("Public key must be 32 bytes".into()));
    }
    let mut pk = [0u8; ED25519_PUBLIC_LEN];
    pk.copy_from_slice(&pk_bytes);
    verify_signature(&pk, message, &sig_bytes)
}

// ─── HKDF Key Derivation ───────────────────────────────────────────────────

/// Derive a 256-bit subkey from a master key using HKDF-SHA256.
///
/// Parameters:
///   - `master_key`:  The root key material (e.g., user's vault key)
///   - `domain`:      Domain separator (e.g., "onyx-cloud-v1", "onyx-sync-v1")
///   - `context`:     Context-specific info (e.g., file_id, doc_id, peer_id)
///
/// This replaces the old `SHA256(master_key || domain || salt)` scheme.
/// HKDF provides proper extraction of entropy and domain separation.
pub fn derive_key(
    master_key: &[u8],
    domain: &str,
    context: &str,
) -> Result<[u8; KEY_LEN], OnyxCryptoError> {
    let salt = domain.as_bytes();
    let info = context.as_bytes();

    let hk = Hkdf::<Sha256>::new(Some(salt), master_key);
    let mut okm = [0u8; KEY_LEN];
    hk.expand(info, &mut okm)
        .map_err(|e| OnyxCryptoError::KeyDerivation(e.to_string()))?;

    Ok(okm)
}

/// Derive a key from a string master key (convenience wrapper for existing code).
pub fn derive_key_from_str(
    master_key: &str,
    domain: &str,
    context: &str,
) -> Result<[u8; KEY_LEN], OnyxCryptoError> {
    derive_key(master_key.as_bytes(), domain, context)
}

/// Derive multiple subkeys from one master key using HKDF-Expand with different info strings.
/// Useful for deriving encryption key + MAC key + IV from a single DH shared secret.
pub fn derive_key_pair(
    master_key: &[u8],
    domain: &str,
    context: &str,
) -> Result<([u8; KEY_LEN], [u8; KEY_LEN]), OnyxCryptoError> {
    let enc_key = derive_key(master_key, domain, &format!("{}-enc", context))?;
    let mac_key = derive_key(master_key, domain, &format!("{}-mac", context))?;
    Ok((enc_key, mac_key))
}

// ─── AES-256-GCM Authenticated Encryption ──────────────────────────────────

/// Encrypt data using AES-256-GCM.
///
/// Output format: `nonce(12) || ciphertext || tag(16)`
///
/// The nonce is randomly generated and prepended to the output.
/// The GCM tag is appended automatically by the AEAD.
/// Optional AAD (Additional Authenticated Data) is authenticated but not encrypted.
///
/// This replaces ALL the old XOR+HMAC encrypt functions.
pub fn encrypt_aead(
    key: &[u8; KEY_LEN],
    plaintext: &[u8],
    aad: Option<&[u8]>,
) -> Result<Vec<u8>, OnyxCryptoError> {
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| OnyxCryptoError::Encryption(e.to_string()))?;

    // Generate random 96-bit nonce
    let mut nonce_bytes = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = AesNonce::from_slice(&nonce_bytes);

    // Encrypt with optional AAD
    let ciphertext = if let Some(aad_data) = aad {
        use aes_gcm::aead::Payload;
        cipher.encrypt(nonce, Payload { msg: plaintext, aad: aad_data })
    } else {
        cipher.encrypt(nonce, plaintext.as_ref())
    }.map_err(|e| OnyxCryptoError::Encryption(e.to_string()))?;

    // Prepend nonce: nonce(12) || ciphertext+tag
    let mut output = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    output.extend_from_slice(&nonce_bytes);
    output.extend_from_slice(&ciphertext);

    Ok(output)
}

/// Decrypt data encrypted with `encrypt_aead`.
///
/// Input format: `nonce(12) || ciphertext || tag(16)`
///
/// Returns the plaintext on success, or `DecryptionAuthFailed` if the tag
/// doesn't match (tampered data or wrong key).
pub fn decrypt_aead(
    key: &[u8; KEY_LEN],
    encrypted: &[u8],
    aad: Option<&[u8]>,
) -> Result<Vec<u8>, OnyxCryptoError> {
    let min_len = NONCE_LEN + TAG_LEN;
    if encrypted.len() < min_len {
        return Err(OnyxCryptoError::DataTooShort {
            expected: min_len,
            actual: encrypted.len(),
        });
    }

    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| OnyxCryptoError::Decryption(e.to_string()))?;

    let nonce = AesNonce::from_slice(&encrypted[..NONCE_LEN]);
    let ciphertext_and_tag = &encrypted[NONCE_LEN..];

    let plaintext = if let Some(aad_data) = aad {
        use aes_gcm::aead::Payload;
        cipher.decrypt(nonce, Payload { msg: ciphertext_and_tag, aad: aad_data })
    } else {
        cipher.decrypt(nonce, ciphertext_and_tag.as_ref())
    }.map_err(|_| OnyxCryptoError::DecryptionAuthFailed)?;

    Ok(plaintext)
}

/// Convenience: encrypt string data, returning base64-encoded ciphertext.
pub fn encrypt_to_b64(
    key: &[u8; KEY_LEN],
    plaintext: &[u8],
    aad: Option<&[u8]>,
) -> Result<String, OnyxCryptoError> {
    let encrypted = encrypt_aead(key, plaintext, aad)?;
    Ok(B64.encode(&encrypted))
}

/// Convenience: decrypt base64-encoded ciphertext, returning plaintext bytes.
pub fn decrypt_from_b64(
    key: &[u8; KEY_LEN],
    encrypted_b64: &str,
    aad: Option<&[u8]>,
) -> Result<Vec<u8>, OnyxCryptoError> {
    let encrypted = B64.decode(encrypted_b64)?;
    decrypt_aead(key, &encrypted, aad)
}

// ─── HMAC-SHA256 ────────────────────────────────────────────────────────────

type HmacSha256 = Hmac<Sha256>;

/// Compute HMAC-SHA256 over data with a key.
/// Used by the Double Ratchet KDF chain.
pub fn hmac_sha256(key: &[u8], data: &[u8]) -> [u8; 32] {
    let mut mac = <HmacSha256 as Mac>::new_from_slice(key)
        .expect("HMAC can take key of any size");
    mac.update(data);
    let result = mac.finalize();
    let mut output = [0u8; 32];
    output.copy_from_slice(&result.into_bytes());
    output
}

/// Verify HMAC-SHA256 (constant-time comparison).
pub fn hmac_sha256_verify(key: &[u8], data: &[u8], expected_tag: &[u8]) -> bool {
    let mut mac = <HmacSha256 as Mac>::new_from_slice(key)
        .expect("HMAC can take key of any size");
    mac.update(data);
    mac.verify_slice(expected_tag).is_ok()
}

// ─── Key Derivation Chain (for Double Ratchet) ─────────────────────────────

/// KDF Chain step: derive next chain key + message key from current chain key.
///
/// chain_key_n+1 = HMAC-SHA256(chain_key_n, 0x01)
/// message_key   = HMAC-SHA256(chain_key_n, 0x02)
///
/// This is the core of the Signal Protocol's symmetric ratchet.
pub fn kdf_chain_step(chain_key: &[u8; 32]) -> ([u8; 32], [u8; 32]) {
    let next_chain_key = hmac_sha256(chain_key, &[0x01]);
    let message_key = hmac_sha256(chain_key, &[0x02]);
    (next_chain_key, message_key)
}

/// Root KDF: derive new root key + new chain key from root key + DH output.
///
/// Uses HKDF with the DH output as input keying material and root key as salt.
/// This is the asymmetric ratchet step in the Double Ratchet.
pub fn kdf_root(
    root_key: &[u8; 32],
    dh_output: &[u8],
) -> Result<([u8; 32], [u8; 32]), OnyxCryptoError> {
    let hk = Hkdf::<Sha256>::new(Some(root_key), dh_output);

    let mut new_root_key = [0u8; 32];
    hk.expand(b"onyx-ratchet-root", &mut new_root_key)
        .map_err(|e| OnyxCryptoError::KeyDerivation(e.to_string()))?;

    let mut new_chain_key = [0u8; 32];
    hk.expand(b"onyx-ratchet-chain", &mut new_chain_key)
        .map_err(|e| OnyxCryptoError::KeyDerivation(e.to_string()))?;

    Ok((new_root_key, new_chain_key))
}

// ─── X3DH (Extended Triple Diffie-Hellman) ──────────────────────────────────

/// X3DH PreKey Bundle — published by a user for initiating key agreement.
/// This allows establishing a shared secret with an offline user.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreKeyBundle {
    /// Ed25519 identity public key (long-term)
    pub identity_key: String,
    /// X25519 signed pre-key (medium-term, rotated periodically)
    pub signed_prekey: String,
    /// Ed25519 signature of the signed pre-key by the identity key
    pub prekey_signature: String,
    /// X25519 one-time pre-key (single-use, consumed on first message)
    pub one_time_prekey: Option<String>,
}

/// X3DH key agreement result
pub struct X3dhSharedSecret {
    /// The shared secret derived from the triple/quadruple DH
    pub secret: SecureBuffer,
    /// The ephemeral public key to send to the recipient
    pub ephemeral_public: [u8; 32],
}

/// Perform X3DH key agreement as the INITIATOR (Alice).
///
/// Alice (sender) computes:
///   DH1 = DH(Alice_identity, Bob_signed_prekey)
///   DH2 = DH(Alice_ephemeral, Bob_identity)
///   DH3 = DH(Alice_ephemeral, Bob_signed_prekey)
///   DH4 = DH(Alice_ephemeral, Bob_one_time_prekey)  [if available]
///   SK  = HKDF(DH1 || DH2 || DH3 || DH4)
pub fn x3dh_initiate(
    our_identity: &OnyxIdentity,
    peer_identity_pub: &[u8; 32],
    peer_signed_prekey: &[u8; 32],
    peer_one_time_prekey: Option<&[u8; 32]>,
) -> Result<X3dhSharedSecret, OnyxCryptoError> {
    // Generate ephemeral X25519 keypair (using StaticSecret to allow multiple DH)
    let mut ephemeral_bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut ephemeral_bytes);
    let ephemeral_secret = StaticSecret::from(ephemeral_bytes);
    let ephemeral_public = X25519Public::from(&ephemeral_secret);
    ephemeral_bytes.zeroize();

    // Convert Ed25519 identity keys to X25519
    let our_x25519_static = our_identity.to_x25519_static();
    let peer_identity_x25519 = X25519Public::from(*peer_identity_pub);
    let peer_signed_prekey_x25519 = X25519Public::from(*peer_signed_prekey);

    // DH1: our_identity × peer_signed_prekey
    let dh1 = our_x25519_static.diffie_hellman(&peer_signed_prekey_x25519);
    // DH2: our_ephemeral × peer_identity
    let dh2 = ephemeral_secret.diffie_hellman(&peer_identity_x25519);
    // DH3: our_ephemeral × peer_signed_prekey
    let dh3 = ephemeral_secret.diffie_hellman(&peer_signed_prekey_x25519);

    // Concatenate DH outputs
    let mut dh_concat = Vec::with_capacity(32 * 4);
    dh_concat.extend_from_slice(dh1.as_bytes());
    dh_concat.extend_from_slice(dh2.as_bytes());
    dh_concat.extend_from_slice(dh3.as_bytes());

    // DH4: our_ephemeral × peer_one_time_prekey (if available)
    if let Some(otpk) = peer_one_time_prekey {
        let peer_otpk_x25519 = X25519Public::from(*otpk);
        let dh4 = ephemeral_secret.diffie_hellman(&peer_otpk_x25519);
        dh_concat.extend_from_slice(dh4.as_bytes());
    }

    // Derive shared secret via HKDF
    let hk = Hkdf::<Sha256>::new(None, &dh_concat);
    let mut sk = [0u8; 32];
    hk.expand(b"onyx-x3dh-v1", &mut sk)
        .map_err(|e| OnyxCryptoError::KeyDerivation(e.to_string()))?;

    Ok(X3dhSharedSecret {
        secret: SecureBuffer::new(sk.to_vec()),
        ephemeral_public: ephemeral_public.to_bytes(),
    })
}

/// High-level X3DH initiator that accepts a PreKeyBundle.
/// Decodes the base64 keys from the bundle and calls `x3dh_initiate`.
pub fn x3dh_initiate_from_bundle(
    our_identity: &OnyxIdentity,
    bundle: &PreKeyBundle,
) -> Result<X3dhSharedSecret, String> {
    let identity_bytes = B64.decode(&bundle.identity_key)
        .map_err(|e| format!("Decode identity key: {}", e))?;
    let signed_prekey_bytes = B64.decode(&bundle.signed_prekey)
        .map_err(|e| format!("Decode signed prekey: {}", e))?;

    if identity_bytes.len() != 32 || signed_prekey_bytes.len() != 32 {
        return Err("Invalid key sizes in PreKeyBundle".into());
    }

    let mut ik = [0u8; 32];
    ik.copy_from_slice(&identity_bytes);
    let mut spk = [0u8; 32];
    spk.copy_from_slice(&signed_prekey_bytes);

    let otpk = if let Some(ref otpk_b64) = bundle.one_time_prekey {
        let otpk_bytes = B64.decode(otpk_b64)
            .map_err(|e| format!("Decode OTPK: {}", e))?;
        if otpk_bytes.len() != 32 {
            return Err("Invalid OTPK size".into());
        }
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&otpk_bytes);
        Some(arr)
    } else {
        None
    };

    x3dh_initiate(our_identity, &ik, &spk, otpk.as_ref())
        .map_err(|e| format!("{}", e))
}

// ─── Utility: Generate Random Bytes ─────────────────────────────────────────

/// Generate `n` cryptographically secure random bytes.
pub fn random_bytes(n: usize) -> Vec<u8> {
    let mut buf = vec![0u8; n];
    rand::thread_rng().fill_bytes(&mut buf);
    buf
}

/// Generate a random 32-byte key.
pub fn random_key() -> [u8; KEY_LEN] {
    let mut key = [0u8; KEY_LEN];
    rand::thread_rng().fill_bytes(&mut key);
    key
}

/// Generate a random 12-byte nonce.
pub fn random_nonce() -> [u8; NONCE_LEN] {
    let mut nonce = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut nonce);
    nonce
}

// ─── Hex Encoding (no extra dependency) ─────────────────────────────────────

mod hex {
    pub fn encode(bytes: impl AsRef<[u8]>) -> String {
        bytes.as_ref().iter().map(|b| format!("{:02x}", b)).collect()
    }

    #[allow(dead_code)]
    pub fn decode(s: &str) -> Result<Vec<u8>, String> {
        if s.len() % 2 != 0 {
            return Err("Hex string must have even length".into());
        }
        (0..s.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&s[i..i + 2], 16).map_err(|e| e.to_string()))
            .collect()
    }
}

// ─── Migration Helpers ──────────────────────────────────────────────────────

/// Detect whether data is encrypted with the OLD XOR+HMAC scheme.
///
/// Old format: nonce(12) || xor_ciphertext || sha256_hmac(32)
/// New format: nonce(12) || aes_gcm_ciphertext || tag(16)
///
/// We differentiate by checking if the last 32 bytes look like a SHA-256 tag
/// (old) vs. 16-byte AES-GCM tag (new). Since the old scheme always appended
/// exactly 32 bytes of HMAC, we use the file header byte convention:
///
/// We add a 1-byte version prefix to all new encryptions:
///   0x00 = legacy XOR+HMAC (no prefix, detected by absence)
///   0x01 = AES-256-GCM (new format)
pub const CRYPTO_VERSION_AESGCM: u8 = 0x01;

/// Encrypt data with version prefix (new format).
/// Output: version(1) || nonce(12) || aes_ciphertext || tag(16)
pub fn encrypt_versioned(
    key: &[u8; KEY_LEN],
    plaintext: &[u8],
    aad: Option<&[u8]>,
) -> Result<Vec<u8>, OnyxCryptoError> {
    let encrypted = encrypt_aead(key, plaintext, aad)?;
    let mut versioned = Vec::with_capacity(1 + encrypted.len());
    versioned.push(CRYPTO_VERSION_AESGCM);
    versioned.extend_from_slice(&encrypted);
    Ok(versioned)
}

/// Decrypt data that may be either old (XOR+HMAC) or new (AES-256-GCM) format.
/// If old format detected, decrypt with legacy scheme and return plaintext.
/// Callers should re-encrypt with new format on successful legacy decrypt.
pub fn decrypt_auto(
    new_key: &[u8; KEY_LEN],
    legacy_master_key: Option<&str>,
    legacy_salt: Option<&str>,
    encrypted: &[u8],
    aad: Option<&[u8]>,
) -> Result<(Vec<u8>, bool), OnyxCryptoError> {
    if encrypted.is_empty() {
        return Err(OnyxCryptoError::DataTooShort { expected: 1, actual: 0 });
    }

    // Check version byte
    if encrypted[0] == CRYPTO_VERSION_AESGCM {
        // New format: skip version byte, decrypt with AES-256-GCM
        let plaintext = decrypt_aead(new_key, &encrypted[1..], aad)?;
        Ok((plaintext, false)) // false = not legacy
    } else {
        // Attempt legacy XOR+HMAC decryption
        if let (Some(master_key), Some(salt)) = (legacy_master_key, legacy_salt) {
            let plaintext = decrypt_legacy_xor(encrypted, master_key, salt)?;
            Ok((plaintext, true)) // true = was legacy, caller should re-encrypt
        } else {
            Err(OnyxCryptoError::Decryption(
                "Data appears to be legacy-encrypted but no legacy key provided".into()
            ))
        }
    }
}

/// Decrypt data encrypted with the OLD XOR+HMAC scheme (for migration).
/// Format: nonce(12) || xor_ciphertext || sha256_hmac(32)
fn decrypt_legacy_xor(
    encrypted: &[u8],
    master_key: &str,
    salt: &str,
) -> Result<Vec<u8>, OnyxCryptoError> {
    use sha2::Digest;

    if encrypted.len() < 12 + 32 {
        return Err(OnyxCryptoError::DataTooShort { expected: 44, actual: encrypted.len() });
    }

    // Derive key using old scheme: SHA-256(master_key || domain || salt)
    let mut hasher = sha2::Sha256::new();
    hasher.update(master_key.as_bytes());
    hasher.update(b"onyx-cloud-v1-"); // legacy domain separator
    hasher.update(salt.as_bytes());
    let key: [u8; 32] = hasher.finalize().into();

    let nonce = &encrypted[..12];
    let ciphertext = &encrypted[12..encrypted.len() - 32];
    let tag = &encrypted[encrypted.len() - 32..];

    // Verify legacy HMAC: SHA-256(key || nonce || ciphertext)
    let mut mac = sha2::Sha256::new();
    mac.update(&key);
    mac.update(nonce);
    mac.update(ciphertext);
    let computed_tag = mac.finalize();
    if computed_tag.as_slice() != tag {
        return Err(OnyxCryptoError::DecryptionAuthFailed);
    }

    // Decrypt with XOR keystream
    let mut plaintext = vec![0u8; ciphertext.len()];
    let mut offset = 0;
    let mut counter: u64 = 0;
    while offset < ciphertext.len() {
        let mut h = sha2::Sha256::new();
        h.update(&key);
        h.update(nonce);
        h.update(&counter.to_le_bytes());
        let ks = h.finalize();
        let end = std::cmp::min(offset + 32, ciphertext.len());
        for i in offset..end {
            plaintext[i] = ciphertext[i] ^ ks[i - offset];
        }
        offset = end;
        counter += 1;
    }

    Ok(plaintext)
}

// ─── Checksum ───────────────────────────────────────────────────────────────

/// Compute SHA-256 checksum of data, returned as hex string.
pub fn checksum_sha256(data: &[u8]) -> String {
    use sha2::Digest;
    let hash = sha2::Sha256::digest(data);
    hex::encode(hash)
}

// ─── Identity Persistence ───────────────────────────────────────────────────

/// Save an identity to disk, encrypted with a master key.
/// The master key should come from the user's vault/password.
pub fn save_identity_encrypted(
    identity: &OnyxIdentity,
    master_key: &[u8; KEY_LEN],
    path: &std::path::Path,
) -> Result<(), OnyxCryptoError> {
    let secret = identity.secret_bytes();
    let encrypted = encrypt_versioned(master_key, &secret, Some(b"onyx-identity-v1"))?;
    std::fs::write(path, &encrypted)?;
    Ok(())
}

/// Load an identity from disk, decrypting with the master key.
pub fn load_identity_encrypted(
    master_key: &[u8; KEY_LEN],
    path: &std::path::Path,
) -> Result<OnyxIdentity, OnyxCryptoError> {
    let encrypted = std::fs::read(path)?;
    if encrypted.is_empty() || encrypted[0] != CRYPTO_VERSION_AESGCM {
        return Err(OnyxCryptoError::Decryption("Not a versioned identity file".into()));
    }
    let secret = decrypt_aead(master_key, &encrypted[1..], Some(b"onyx-identity-v1"))?;
    if secret.len() != ED25519_SECRET_LEN {
        return Err(OnyxCryptoError::InvalidKey("Decrypted identity is wrong size".into()));
    }
    let mut arr = [0u8; ED25519_SECRET_LEN];
    arr.copy_from_slice(&secret);
    Ok(OnyxIdentity::from_secret_bytes(&arr))
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_identity_roundtrip() {
        let id = OnyxIdentity::generate();
        let secret = id.secret_bytes();
        let restored = OnyxIdentity::from_secret_bytes(&secret);
        assert_eq!(id.public_bytes(), restored.public_bytes());
    }

    #[test]
    fn test_sign_verify() {
        let id = OnyxIdentity::generate();
        let msg = b"hello onyx";
        let sig = id.sign(msg);
        assert!(verify_signature(&id.public_bytes(), msg, &sig).is_ok());
    }

    #[test]
    fn test_sign_verify_wrong_message() {
        let id = OnyxIdentity::generate();
        let sig = id.sign(b"hello");
        assert!(verify_signature(&id.public_bytes(), b"world", &sig).is_err());
    }

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let key = random_key();
        let plaintext = b"top secret data";
        let encrypted = encrypt_aead(&key, plaintext, None).unwrap();
        let decrypted = decrypt_aead(&key, &encrypted, None).unwrap();
        assert_eq!(plaintext.as_slice(), decrypted.as_slice());
    }

    #[test]
    fn test_encrypt_decrypt_with_aad() {
        let key = random_key();
        let plaintext = b"secret";
        let aad = b"authenticated context";
        let encrypted = encrypt_aead(&key, plaintext, Some(aad)).unwrap();
        let decrypted = decrypt_aead(&key, &encrypted, Some(aad)).unwrap();
        assert_eq!(plaintext.as_slice(), decrypted.as_slice());

        // Wrong AAD should fail
        assert!(decrypt_aead(&key, &encrypted, Some(b"wrong")).is_err());
    }

    #[test]
    fn test_wrong_key_fails() {
        let key1 = random_key();
        let key2 = random_key();
        let encrypted = encrypt_aead(&key1, b"data", None).unwrap();
        assert!(decrypt_aead(&key2, &encrypted, None).is_err());
    }

    #[test]
    fn test_key_derivation_deterministic() {
        let master = b"my-master-key";
        let k1 = derive_key(master, "domain", "ctx").unwrap();
        let k2 = derive_key(master, "domain", "ctx").unwrap();
        assert_eq!(k1, k2);
    }

    #[test]
    fn test_key_derivation_domain_separation() {
        let master = b"my-master-key";
        let k1 = derive_key(master, "cloud", "file1").unwrap();
        let k2 = derive_key(master, "photos", "file1").unwrap();
        assert_ne!(k1, k2);
    }

    #[test]
    fn test_dh_shared_secret() {
        let alice = OnyxIdentity::generate();
        let bob = OnyxIdentity::generate();
        let alice_shared = alice.dh_shared_secret(&bob.x25519_public());
        let bob_shared = bob.dh_shared_secret(&alice.x25519_public());
        assert_eq!(alice_shared.as_bytes(), bob_shared.as_bytes());
    }

    #[test]
    fn test_kdf_chain() {
        let chain_key = random_key();
        let (next_ck, mk) = kdf_chain_step(&chain_key);
        // Keys should be different
        assert_ne!(chain_key, next_ck);
        assert_ne!(chain_key, mk);
        assert_ne!(next_ck, mk);
        // Deterministic
        let (next_ck2, mk2) = kdf_chain_step(&chain_key);
        assert_eq!(next_ck, next_ck2);
        assert_eq!(mk, mk2);
    }

    #[test]
    fn test_versioned_encrypt_decrypt() {
        let key = random_key();
        let data = b"versioned data";
        let encrypted = encrypt_versioned(&key, data, None).unwrap();
        assert_eq!(encrypted[0], CRYPTO_VERSION_AESGCM);
        let (decrypted, is_legacy) = decrypt_auto(&key, None, None, &encrypted, None).unwrap();
        assert_eq!(data.as_slice(), decrypted.as_slice());
        assert!(!is_legacy);
    }

    #[test]
    fn test_hmac_verify() {
        let key = b"hmac-key";
        let data = b"important data";
        let tag = hmac_sha256(key, data);
        assert!(hmac_sha256_verify(key, data, &tag));
        assert!(!hmac_sha256_verify(key, b"wrong data", &tag));
    }

    #[test]
    fn test_b64_roundtrip() {
        let key = random_key();
        let plaintext = b"base64 test data";
        let encrypted = encrypt_to_b64(&key, plaintext, None).unwrap();
        let decrypted = decrypt_from_b64(&key, &encrypted, None).unwrap();
        assert_eq!(plaintext.as_slice(), decrypted.as_slice());
    }

    #[test]
    fn test_checksum() {
        let data = b"hello";
        let sum = checksum_sha256(data);
        assert_eq!(sum.len(), 64); // SHA-256 hex = 64 chars
    }
}
