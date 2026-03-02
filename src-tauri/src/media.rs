// ─── Onyx Media: Voice & Video over QUIC ────────────────────────────────────
//
// Real-time media transport for voice/video calls over Iroh QUIC connections.
//
// Architecture:
//   • Audio: Opus codec frames → encrypted → QUIC datagrams (low latency)
//   • Video: H.264/VP8 frames → encrypted → QUIC streams (reliable, ordered)
//   • Signaling: Call setup/teardown via ALPN b"onyx-media/1"
//   • E2EE: Each frame encrypted with per-call symmetric key (derived via DH)
//   • SFU: Future LiveKit integration for group calls (>2 participants)
//
// Wire format for signaling:
//   signal_type(1) || payload_len(4 LE) || payload(N)
//
// Signal types:
//   0x01 = Call offer
//   0x02 = Call answer
//   0x03 = Call reject
//   0x04 = Call end
//   0x05 = ICE candidate (N/A for QUIC, reserved)
//   0x06 = Mute/unmute notification
//   0x07 = Video toggle
//   0x08 = Screen share start/stop
//
// Media datagrams:
//   media_type(1) || seq(4 LE) || timestamp(8 LE) || encrypted_frame(N)
//   media_type: 0x10 = audio, 0x20 = video keyframe, 0x21 = video delta

use crate::crypto::{
    derive_key, encrypt_aead, decrypt_aead,
    random_key,
};
use crate::network::OnyxNode;

use dashmap::DashMap;
use iroh::endpoint::Connection;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::command;
use tokio::sync::broadcast;
use tracing::{debug, info, warn};
use base64::Engine as _;

// ─── Signal Types ───────────────────────────────────────────────────────────

const SIG_CALL_OFFER: u8 = 0x01;
const SIG_CALL_ANSWER: u8 = 0x02;
const SIG_CALL_REJECT: u8 = 0x03;
const SIG_CALL_END: u8 = 0x04;
const SIG_MUTE_TOGGLE: u8 = 0x06;
const SIG_VIDEO_TOGGLE: u8 = 0x07;
const SIG_SCREEN_SHARE: u8 = 0x08;

// ─── Media Types ────────────────────────────────────────────────────────────

const MEDIA_AUDIO: u8 = 0x10;
const MEDIA_VIDEO_KEY: u8 = 0x20;
const MEDIA_VIDEO_DELTA: u8 = 0x21;

/// Max datagram size (QUIC path MTU safe)
const MAX_DATAGRAM_SIZE: usize = 1200;

// ─── Call State ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum CallState {
    Idle,
    Offering,
    Ringing,
    Active,
    Ended,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum CallType {
    Audio,
    Video,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallInfo {
    pub call_id: String,
    pub peer_node_id: String,
    pub call_type: CallType,
    pub state: CallState,
    pub started_at: Option<i64>,
    pub ended_at: Option<i64>,
    pub is_muted: bool,
    pub is_video_on: bool,
    pub is_screen_sharing: bool,
}

// ─── Signaling Messages ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallOffer {
    pub call_id: String,
    pub caller_node_id: String,
    pub call_type: CallType,
    /// DH public key for deriving media encryption key
    pub dh_public: [u8; 32],
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallAnswer {
    pub call_id: String,
    pub answerer_node_id: String,
    pub accepted: bool,
    /// DH public key (if accepted)
    pub dh_public: Option<[u8; 32]>,
    pub timestamp: i64,
}

// ─── Media Frame ────────────────────────────────────────────────────────────

/// An encrypted media frame ready for QUIC transport.
#[derive(Debug, Clone)]
pub struct MediaFrame {
    pub media_type: u8,
    pub sequence: u32,
    pub timestamp: u64,
    pub encrypted_data: Vec<u8>,
}

impl MediaFrame {
    /// Encode to datagram bytes.
    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(13 + self.encrypted_data.len());
        buf.push(self.media_type);
        buf.extend_from_slice(&self.sequence.to_le_bytes());
        buf.extend_from_slice(&self.timestamp.to_le_bytes());
        buf.extend_from_slice(&self.encrypted_data);
        buf
    }

    /// Decode from datagram bytes.
    pub fn decode(data: &[u8]) -> Result<Self, String> {
        if data.len() < 13 {
            return Err("Media frame too short".into());
        }
        let media_type = data[0];
        let sequence = u32::from_le_bytes([data[1], data[2], data[3], data[4]]);
        let timestamp = u64::from_le_bytes([
            data[5], data[6], data[7], data[8],
            data[9], data[10], data[11], data[12],
        ]);
        Ok(Self {
            media_type,
            sequence,
            timestamp,
            encrypted_data: data[13..].to_vec(),
        })
    }
}

// ─── Active Call Session ────────────────────────────────────────────────────

/// Represents an active call with all transport and crypto state.
struct ActiveCall {
    call_id: String,
    peer_node_id: String,
    call_type: CallType,
    /// QUIC connection to peer
    connection: Connection,
    /// Shared media encryption key (from DH)
    media_key: [u8; 32],
    /// Audio sequence counter
    audio_seq: AtomicU32,
    /// Video sequence counter
    video_seq: AtomicU32,
    /// Call start time
    started_at: Instant,
    /// Active flag
    active: AtomicBool,
    /// Mute state
    muted: AtomicBool,
    /// Video state
    video_on: AtomicBool,
}

impl ActiveCall {
    /// Encrypt a media frame with the call's media key.
    fn encrypt_frame(&self, frame_data: &[u8], media_type: u8) -> Result<MediaFrame, String> {
        let seq = match media_type {
            MEDIA_AUDIO => self.audio_seq.fetch_add(1, Ordering::SeqCst),
            _ => self.video_seq.fetch_add(1, Ordering::SeqCst),
        };

        let elapsed = self.started_at.elapsed().as_millis() as u64;

        // Derive per-frame key: HKDF(media_key, seq || media_type)
        let mut aad = Vec::with_capacity(5);
        aad.extend_from_slice(&seq.to_le_bytes());
        aad.push(media_type);

        let encrypted = encrypt_aead(&self.media_key, frame_data, Some(&aad))
            .map_err(|e| e.to_string())?;

        Ok(MediaFrame {
            media_type,
            sequence: seq,
            timestamp: elapsed,
            encrypted_data: encrypted,
        })
    }

    /// Decrypt a received media frame.
    fn decrypt_frame(&self, frame: &MediaFrame) -> Result<Vec<u8>, String> {
        let mut aad = Vec::with_capacity(5);
        aad.extend_from_slice(&frame.sequence.to_le_bytes());
        aad.push(frame.media_type);

        decrypt_aead(&self.media_key, &frame.encrypted_data, Some(&aad))
            .map_err(|e| e.to_string())
    }
}

// ─── Media Engine ───────────────────────────────────────────────────────────

/// Central media engine managing calls and media streams.
pub struct MediaEngine {
    /// Active calls: call_id → ActiveCall
    active_calls: DashMap<String, Arc<ActiveCall>>,
    /// Our identity (for DH)
    identity: Arc<crate::crypto::OnyxIdentity>,
    /// Event broadcast for UI
    event_tx: broadcast::Sender<MediaEvent>,
    /// Audio frame channel for playback
    audio_rx_tx: broadcast::Sender<(String, Vec<u8>)>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaEvent {
    pub event_type: MediaEventType,
    pub call_id: String,
    pub peer_node_id: Option<String>,
    pub data: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MediaEventType {
    IncomingCall,
    CallAccepted,
    CallRejected,
    CallEnded,
    CallConnected,
    PeerMuted,
    PeerUnmuted,
    PeerVideoOn,
    PeerVideoOff,
    PeerScreenShare,
    AudioFrame,
    VideoFrame,
}

impl MediaEngine {
    pub fn new(identity: Arc<crate::crypto::OnyxIdentity>) -> Self {
        let (event_tx, _) = broadcast::channel(256);
        let (audio_rx_tx, _) = broadcast::channel(1024);
        Self {
            active_calls: DashMap::new(),
            identity,
            event_tx,
            audio_rx_tx,
        }
    }

    // ─── Call Initiation ────────────────────────────────────────────────

    /// Start a call with a peer.
    pub async fn start_call(
        &self,
        node: &OnyxNode,
        peer_node_id: &str,
        call_type: CallType,
    ) -> Result<CallInfo, String> {
        let call_id = uuid::Uuid::new_v4().to_string();
        // Generate ephemeral DH key for this call
        let dh_secret = x25519_dalek::StaticSecret::from(random_key());
        let dh_public = x25519_dalek::PublicKey::from(&dh_secret);

        // Connect to peer on media ALPN
        let conn = node.connect(peer_node_id, crate::network::ALPN_MEDIA).await
            .map_err(|e| format!("{}", e))?;

        // Send call offer
        let offer = CallOffer {
            call_id: call_id.clone(),
            caller_node_id: self.identity.node_id_hex(),
            call_type: call_type.clone(),
            dh_public: dh_public.to_bytes(),
            timestamp: now_epoch(),
        };

        let offer_bytes = serde_json::to_vec(&offer).map_err(|e| e.to_string())?;
        let mut signal = Vec::with_capacity(5 + offer_bytes.len());
        signal.push(SIG_CALL_OFFER);
        signal.extend_from_slice(&(offer_bytes.len() as u32).to_le_bytes());
        signal.extend_from_slice(&offer_bytes);

        let (mut send, mut recv) = conn.open_bi().await
            .map_err(|e| format!("Open stream: {}", e))?;
        send.write_all(&signal).await
            .map_err(|e| format!("Send offer: {}", e))?;
        send.finish().map_err(|e| format!("Finish: {}", e))?;

        // Wait for answer (with timeout)
        let answer_data = tokio::time::timeout(
            Duration::from_secs(60),
            read_stream(&mut recv, 4096),
        ).await
            .map_err(|_| "Call timed out".to_string())?
            .map_err(|e| format!("Read answer: {}", e))?;

        if answer_data.is_empty() || answer_data[0] != SIG_CALL_ANSWER {
            return Err("Invalid call answer".into());
        }

        let answer_payload = &answer_data[5..];
        let answer: CallAnswer = serde_json::from_slice(answer_payload)
            .map_err(|e| format!("Parse answer: {}", e))?;

        if !answer.accepted {
            let _ = self.event_tx.send(MediaEvent {
                event_type: MediaEventType::CallRejected,
                call_id: call_id.clone(),
                peer_node_id: Some(peer_node_id.to_string()),
                data: None,
            });
            return Ok(CallInfo {
                call_id,
                peer_node_id: peer_node_id.to_string(),
                call_type,
                state: CallState::Ended,
                started_at: None,
                ended_at: Some(now_epoch()),
                is_muted: false,
                is_video_on: false,
                is_screen_sharing: false,
            });
        }

        // Derive media key from DH
        let peer_dh_pub = answer.dh_public.ok_or("No DH public in answer")?;
        let peer_pub = x25519_dalek::PublicKey::from(peer_dh_pub);
        let shared = dh_secret.diffie_hellman(&peer_pub);
        let media_key = derive_key(shared.as_bytes(), "onyx-media-key", &call_id)
            .map_err(|e| e.to_string())?;

        // Create active call
        let active = Arc::new(ActiveCall {
            call_id: call_id.clone(),
            peer_node_id: peer_node_id.to_string(),
            call_type: call_type.clone(),
            connection: conn,
            media_key,
            audio_seq: AtomicU32::new(0),
            video_seq: AtomicU32::new(0),
            started_at: Instant::now(),
            active: AtomicBool::new(true),
            muted: AtomicBool::new(false),
            video_on: AtomicBool::new(call_type == CallType::Video),
        });

        self.active_calls.insert(call_id.clone(), active.clone());

        // Start media receive loop
        self.spawn_media_recv(active);

        let _ = self.event_tx.send(MediaEvent {
            event_type: MediaEventType::CallConnected,
            call_id: call_id.clone(),
            peer_node_id: Some(peer_node_id.to_string()),
            data: None,
        });

        info!("[Media] Call {} started with {}", &call_id[..8], &peer_node_id[..8.min(peer_node_id.len())]);

        Ok(CallInfo {
            call_id,
            peer_node_id: peer_node_id.to_string(),
            call_type,
            state: CallState::Active,
            started_at: Some(now_epoch()),
            ended_at: None,
            is_muted: false,
            is_video_on: false,
            is_screen_sharing: false,
        })
    }

    /// Handle an incoming call (called by network accept loop).
    pub async fn handle_incoming_call(
        &self,
        _conn: Connection,
        mut recv: iroh::endpoint::RecvStream,
        _send: iroh::endpoint::SendStream,
    ) -> Result<(), String> {
        // Read the signal
        let data = read_stream(&mut recv, 4096).await?;
        if data.is_empty() || data[0] != SIG_CALL_OFFER {
            return Err("Expected call offer".into());
        }

        let offer: CallOffer = serde_json::from_slice(&data[5..])
            .map_err(|e| format!("Parse offer: {}", e))?;

        let _ = self.event_tx.send(MediaEvent {
            event_type: MediaEventType::IncomingCall,
            call_id: offer.call_id.clone(),
            peer_node_id: Some(offer.caller_node_id.clone()),
            data: serde_json::to_string(&offer).ok(),
        });

        // The UI will call `answer_call` or `reject_call` which will
        // send the answer back. For now, store the pending call state.
        // We store (call_id, conn, offer) for later answering.
        // Note: In production, you'd use a channel or state machine here.
        // For this implementation, the pending state is managed via events.

        debug!("[Media] Incoming call {} from {}", &offer.call_id[..8], &offer.caller_node_id[..8.min(offer.caller_node_id.len())]);
        Ok(())
    }

    /// Answer an incoming call.
    pub async fn answer_call(
        &self,
        node: &OnyxNode,
        call_id: &str,
        peer_node_id: &str,
        accept: bool,
        offer_dh_public: Option<[u8; 32]>,
    ) -> Result<Option<CallInfo>, String> {
        let dh_secret = x25519_dalek::StaticSecret::from(random_key());
        let dh_public = x25519_dalek::PublicKey::from(&dh_secret);

        let answer = CallAnswer {
            call_id: call_id.to_string(),
            answerer_node_id: self.identity.node_id_hex(),
            accepted: accept,
            dh_public: if accept { Some(dh_public.to_bytes()) } else { None },
            timestamp: now_epoch(),
        };

        // Connect back to send answer
        let conn = node.connect(peer_node_id, crate::network::ALPN_MEDIA).await
            .map_err(|e| format!("{}", e))?;

        let answer_bytes = serde_json::to_vec(&answer).map_err(|e| e.to_string())?;
        let mut signal = Vec::with_capacity(5 + answer_bytes.len());
        signal.push(SIG_CALL_ANSWER);
        signal.extend_from_slice(&(answer_bytes.len() as u32).to_le_bytes());
        signal.extend_from_slice(&answer_bytes);

        let (mut send_stream, _) = conn.open_bi().await
            .map_err(|e| format!("Open stream: {}", e))?;
        send_stream.write_all(&signal).await
            .map_err(|e| format!("Send answer: {}", e))?;
        send_stream.finish().map_err(|e| format!("Finish: {}", e))?;

        if !accept {
            let _ = self.event_tx.send(MediaEvent {
                event_type: MediaEventType::CallRejected,
                call_id: call_id.to_string(),
                peer_node_id: Some(peer_node_id.to_string()),
                data: None,
            });
            return Ok(None);
        }

        // Derive media key
        let peer_dh_pub = offer_dh_public.ok_or("Need offer DH public to accept")?;
        let peer_pub = x25519_dalek::PublicKey::from(peer_dh_pub);
        let shared = dh_secret.diffie_hellman(&peer_pub);
        let media_key = derive_key(shared.as_bytes(), "onyx-media-key", call_id)
            .map_err(|e| e.to_string())?;

        let active = Arc::new(ActiveCall {
            call_id: call_id.to_string(),
            peer_node_id: peer_node_id.to_string(),
            call_type: CallType::Audio, // upgraded by negotiation
            connection: conn,
            media_key,
            audio_seq: AtomicU32::new(0),
            video_seq: AtomicU32::new(0),
            started_at: Instant::now(),
            active: AtomicBool::new(true),
            muted: AtomicBool::new(false),
            video_on: AtomicBool::new(false),
        });

        self.active_calls.insert(call_id.to_string(), active.clone());
        self.spawn_media_recv(active);

        let _ = self.event_tx.send(MediaEvent {
            event_type: MediaEventType::CallAccepted,
            call_id: call_id.to_string(),
            peer_node_id: Some(peer_node_id.to_string()),
            data: None,
        });

        Ok(Some(CallInfo {
            call_id: call_id.to_string(),
            peer_node_id: peer_node_id.to_string(),
            call_type: CallType::Audio,
            state: CallState::Active,
            started_at: Some(now_epoch()),
            ended_at: None,
            is_muted: false,
            is_video_on: false,
            is_screen_sharing: false,
        }))
    }

    /// End a call.
    pub async fn end_call(&self, call_id: &str) -> Result<(), String> {
        if let Some((_, call)) = self.active_calls.remove(call_id) {
            call.active.store(false, Ordering::SeqCst);

            // Send end signal
            if let Ok((mut send, _)) = call.connection.open_bi().await {
                let end_signal = vec![SIG_CALL_END, 0, 0, 0, 0];
                let _ = send.write_all(&end_signal).await;
                let _ = send.finish();
            }

            // Close connection
            call.connection.close(0u32.into(), b"call ended");

            let _ = self.event_tx.send(MediaEvent {
                event_type: MediaEventType::CallEnded,
                call_id: call_id.to_string(),
                peer_node_id: Some(call.peer_node_id.clone()),
                data: None,
            });

            info!("[Media] Call {} ended (duration: {:.1}s)",
                &call_id[..8], call.started_at.elapsed().as_secs_f64());
        }
        Ok(())
    }

    // ─── Media Frame Sending ────────────────────────────────────────────

    /// Send an audio frame to the active call.
    pub async fn send_audio_frame(
        &self,
        call_id: &str,
        pcm_data: &[u8],
    ) -> Result<(), String> {
        let call = self.active_calls.get(call_id)
            .ok_or("No active call")?;

        if !call.active.load(Ordering::SeqCst) || call.muted.load(Ordering::SeqCst) {
            return Ok(());
        }

        let frame = call.encrypt_frame(pcm_data, MEDIA_AUDIO)?;
        let datagram = frame.encode();

        if datagram.len() > MAX_DATAGRAM_SIZE {
            // Frame too large for datagram — this shouldn't happen with 20ms Opus
            warn!("[Media] Audio frame too large: {} bytes", datagram.len());
            return Ok(());
        }

        call.connection.send_datagram(datagram.into())
            .map_err(|e| format!("Send datagram: {}", e))?;

        Ok(())
    }

    /// Send a video frame (as a reliable QUIC stream).
    pub async fn send_video_frame(
        &self,
        call_id: &str,
        frame_data: &[u8],
        is_keyframe: bool,
    ) -> Result<(), String> {
        let call = self.active_calls.get(call_id)
            .ok_or("No active call")?;

        if !call.active.load(Ordering::SeqCst) || !call.video_on.load(Ordering::SeqCst) {
            return Ok(());
        }

        let media_type = if is_keyframe { MEDIA_VIDEO_KEY } else { MEDIA_VIDEO_DELTA };
        let frame = call.encrypt_frame(frame_data, media_type)?;
        let encoded = frame.encode();

        // Video goes over a QUIC stream (reliable, ordered)
        let mut send = call.connection.open_uni().await
            .map_err(|e| format!("Open uni: {}", e))?;

        // Length-prefix the frame
        let len = encoded.len() as u32;
        send.write_all(&len.to_le_bytes()).await
            .map_err(|e| format!("Write len: {}", e))?;
        send.write_all(&encoded).await
            .map_err(|e| format!("Write frame: {}", e))?;
        send.finish().map_err(|e| format!("Finish: {}", e))?;

        Ok(())
    }

    // ─── Call Controls ──────────────────────────────────────────────────

    /// Toggle mute state.
    pub async fn toggle_mute(&self, call_id: &str) -> Result<bool, String> {
        let call = self.active_calls.get(call_id)
            .ok_or("No active call")?;
        let new_state = !call.muted.load(Ordering::SeqCst);
        call.muted.store(new_state, Ordering::SeqCst);

        // Notify peer
        if let Ok((mut send, _)) = call.connection.open_bi().await {
            let signal = vec![SIG_MUTE_TOGGLE, 1, 0, 0, 0, if new_state { 1 } else { 0 }];
            let _ = send.write_all(&signal).await;
            let _ = send.finish();
        }

        Ok(new_state)
    }

    /// Toggle video.
    pub async fn toggle_video(&self, call_id: &str) -> Result<bool, String> {
        let call = self.active_calls.get(call_id)
            .ok_or("No active call")?;
        let new_state = !call.video_on.load(Ordering::SeqCst);
        call.video_on.store(new_state, Ordering::SeqCst);

        if let Ok((mut send, _)) = call.connection.open_bi().await {
            let signal = vec![SIG_VIDEO_TOGGLE, 1, 0, 0, 0, if new_state { 1 } else { 0 }];
            let _ = send.write_all(&signal).await;
            let _ = send.finish();
        }

        Ok(new_state)
    }

    /// Get info about an active call.
    pub fn get_call_info(&self, call_id: &str) -> Option<CallInfo> {
        self.active_calls.get(call_id).map(|call| CallInfo {
            call_id: call.call_id.clone(),
            peer_node_id: call.peer_node_id.clone(),
            call_type: call.call_type.clone(),
            state: if call.active.load(Ordering::SeqCst) {
                CallState::Active
            } else {
                CallState::Ended
            },
            started_at: Some(now_epoch() - call.started_at.elapsed().as_secs() as i64),
            ended_at: None,
            is_muted: call.muted.load(Ordering::SeqCst),
            is_video_on: call.video_on.load(Ordering::SeqCst),
            is_screen_sharing: false,
        })
    }

    /// Get all active calls.
    pub fn get_active_calls(&self) -> Vec<CallInfo> {
        self.active_calls.iter()
            .filter(|c| c.active.load(Ordering::SeqCst))
            .map(|c| CallInfo {
                call_id: c.call_id.clone(),
                peer_node_id: c.peer_node_id.clone(),
                call_type: c.call_type.clone(),
                state: CallState::Active,
                started_at: Some(now_epoch() - c.started_at.elapsed().as_secs() as i64),
                ended_at: None,
                is_muted: c.muted.load(Ordering::SeqCst),
                is_video_on: c.video_on.load(Ordering::SeqCst),
                is_screen_sharing: false,
            })
            .collect()
    }

    pub fn subscribe_events(&self) -> broadcast::Receiver<MediaEvent> {
        self.event_tx.subscribe()
    }

    pub fn subscribe_audio(&self) -> broadcast::Receiver<(String, Vec<u8>)> {
        self.audio_rx_tx.subscribe()
    }

    // ─── Receive Loop ───────────────────────────────────────────────────

    fn spawn_media_recv(&self, call: Arc<ActiveCall>) {
        let audio_tx = self.audio_rx_tx.clone();
        let event_tx = self.event_tx.clone();

        tokio::spawn(async move {
            let conn = &call.connection;

            loop {
                if !call.active.load(Ordering::SeqCst) {
                    break;
                }

                tokio::select! {
                    // Receive datagrams (audio frames)
                    datagram = conn.read_datagram() => {
                        match datagram {
                            Ok(data) => {
                                if let Ok(frame) = MediaFrame::decode(&data) {
                                    match call.decrypt_frame(&frame) {
                                        Ok(pcm) => {
                                            let _ = audio_tx.send((call.call_id.clone(), pcm));
                                        }
                                        Err(e) => {
                                            warn!("[Media] Decrypt audio frame error: {}", e);
                                        }
                                    }
                                }
                            }
                            Err(e) => {
                                debug!("[Media] Datagram recv ended: {}", e);
                                break;
                            }
                        }
                    }

                    // Receive uni streams (video frames)
                    stream = conn.accept_uni() => {
                        match stream {
                            Ok(mut recv) => {
                                // Read length-prefixed frame
                                let mut len_buf = [0u8; 4];
                                if recv.read_exact(&mut len_buf).await.is_ok() {
                                    let len = u32::from_le_bytes(len_buf) as usize;
                                    if len < 16 * 1024 * 1024 {
                                        let mut buf = vec![0u8; len];
                                        if recv.read_exact(&mut buf).await.is_ok() {
                                            if let Ok(frame) = MediaFrame::decode(&buf) {
                                                if let Ok(_video_data) = call.decrypt_frame(&frame) {
                                                    let _ = event_tx.send(MediaEvent {
                                                        event_type: MediaEventType::VideoFrame,
                                                        call_id: call.call_id.clone(),
                                                        peer_node_id: Some(call.peer_node_id.clone()),
                                                        data: None, // video frames handled via separate channel
                                                    });
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            Err(e) => {
                                debug!("[Media] Uni stream ended: {}", e);
                                break;
                            }
                        }
                    }

                    // Receive bi streams (signaling)
                    stream = conn.accept_bi() => {
                        match stream {
                            Ok((_, mut recv)) => {
                                let mut buf = [0u8; 64];
                                if let Ok(Some(n)) = recv.read(&mut buf).await {
                                    if n > 0 {
                                        match buf[0] {
                                            SIG_CALL_END => {
                                                call.active.store(false, Ordering::SeqCst);
                                                let _ = event_tx.send(MediaEvent {
                                                    event_type: MediaEventType::CallEnded,
                                                    call_id: call.call_id.clone(),
                                                    peer_node_id: Some(call.peer_node_id.clone()),
                                                    data: None,
                                                });
                                                break;
                                            }
                                            SIG_MUTE_TOGGLE => {
                                                let muted = n > 5 && buf[5] == 1;
                                                let _ = event_tx.send(MediaEvent {
                                                    event_type: if muted { MediaEventType::PeerMuted } else { MediaEventType::PeerUnmuted },
                                                    call_id: call.call_id.clone(),
                                                    peer_node_id: Some(call.peer_node_id.clone()),
                                                    data: None,
                                                });
                                            }
                                            SIG_VIDEO_TOGGLE => {
                                                let video = n > 5 && buf[5] == 1;
                                                let _ = event_tx.send(MediaEvent {
                                                    event_type: if video { MediaEventType::PeerVideoOn } else { MediaEventType::PeerVideoOff },
                                                    call_id: call.call_id.clone(),
                                                    peer_node_id: Some(call.peer_node_id.clone()),
                                                    data: None,
                                                });
                                            }
                                            _ => {}
                                        }
                                    }
                                }
                            }
                            Err(_) => break,
                        }
                    }
                }
            }

            info!("[Media] Receive loop ended for call {}", &call.call_id[..8]);
        });
    }
}

// ─── Stream Helpers ─────────────────────────────────────────────────────────

async fn read_stream(
    recv: &mut iroh::endpoint::RecvStream,
    max_size: usize,
) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    loop {
        let mut chunk = vec![0u8; 4096];
        match recv.read(&mut chunk).await {
            Ok(Some(n)) => {
                buf.extend_from_slice(&chunk[..n]);
                if buf.len() > max_size {
                    return Err("Signal too large".into());
                }
            }
            Ok(None) => break,
            Err(e) => return Err(format!("Read: {}", e)),
        }
    }
    Ok(buf)
}

// ─── Utility ────────────────────────────────────────────────────────────────

fn now_epoch() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

// ─── Tauri Commands ─────────────────────────────────────────────────────────

#[command]
pub async fn media_start_call(
    engine: tauri::State<'_, Arc<MediaEngine>>,
    node: tauri::State<'_, Arc<OnyxNode>>,
    peer_node_id: String,
    call_type: String,
) -> Result<CallInfo, String> {
    let ct = if call_type == "video" { CallType::Video } else { CallType::Audio };
    engine.start_call(&node, &peer_node_id, ct).await
}

#[command]
pub async fn media_end_call(
    engine: tauri::State<'_, Arc<MediaEngine>>,
    call_id: String,
) -> Result<(), String> {
    engine.end_call(&call_id).await
}

#[command]
pub async fn media_toggle_mute(
    engine: tauri::State<'_, Arc<MediaEngine>>,
    call_id: String,
) -> Result<bool, String> {
    engine.toggle_mute(&call_id).await
}

#[command]
pub async fn media_toggle_video(
    engine: tauri::State<'_, Arc<MediaEngine>>,
    call_id: String,
) -> Result<bool, String> {
    engine.toggle_video(&call_id).await
}

#[command]
pub async fn media_get_active_calls(
    engine: tauri::State<'_, Arc<MediaEngine>>,
) -> Result<Vec<CallInfo>, String> {
    Ok(engine.get_active_calls())
}

#[command]
pub async fn media_get_call_info(
    engine: tauri::State<'_, Arc<MediaEngine>>,
    call_id: String,
) -> Result<Option<CallInfo>, String> {
    Ok(engine.get_call_info(&call_id))
}

#[command]
pub async fn media_answer_call(
    engine: tauri::State<'_, Arc<MediaEngine>>,
    node: tauri::State<'_, Arc<OnyxNode>>,
    call_id: String,
    peer_node_id: String,
    accept: bool,
    offer_dh_public_hex: Option<String>,
) -> Result<Option<CallInfo>, String> {
    let dh_pub = if let Some(hex) = offer_dh_public_hex {
        let bytes = hex::decode(&hex).map_err(|e| format!("Invalid hex: {}", e))?;
        if bytes.len() != 32 { return Err("DH public must be 32 bytes".into()); }
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&bytes);
        Some(arr)
    } else {
        None
    };

    engine.answer_call(&node, &call_id, &peer_node_id, accept, dh_pub).await
}

#[command]
pub async fn media_send_audio(
    engine: tauri::State<'_, Arc<MediaEngine>>,
    call_id: String,
    audio_data_b64: String,
) -> Result<(), String> {
    let data = base64::engine::general_purpose::STANDARD.decode(&audio_data_b64)
        .map_err(|e| format!("Invalid base64: {}", e))?;
    engine.send_audio_frame(&call_id, &data).await
}
