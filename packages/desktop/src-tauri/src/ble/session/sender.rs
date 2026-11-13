use super::{Action, Clock, SessionEvent, ShareFile, ShareLimits};
use crate::ble::crypto::{derive_session_keys, sha256, CryptoError, DirCrypto};
use crate::ble::proto::{self, FileBegin, Frame, HelloBody, SealedBody};
use crate::ble::sanitize::sanitize_file_name;
use rand_core::{CryptoRng, RngCore};
use std::collections::VecDeque;
use std::sync::Arc;
use x25519_dalek::{PublicKey, StaticSecret};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    Idle,
    Handshaking,
    AwaitSas,
    Ready,
    Complete,
    Closed,
}

const TYPE_HELLO: u8 = 0x01;
const TYPE_CONFIRM: u8 = 0x04;
const TYPE_FILE_BEGIN: u8 = 0x10;
const TYPE_KEEPALIVE: u8 = 0x19;
const TYPE_SESSION_COMPLETE: u8 = 0x1a;
const MAX_WRITE_RETRIES: u8 = 5;

struct CryptoPair {
    incoming: DirCrypto,
    outgoing: DirCrypto,
}

struct InflightChunk {
    seq: u32,
    data: Vec<u8>,
    retries: u8,
}

pub struct SenderSession {
    clock: Arc<dyn Clock>,
    app_ver: String,
    label: String,
    phase: Phase,
    secret: StaticSecret,
    instance: [u8; 8],
    crypto: Option<CryptoPair>,
    local_confirm: bool,
    remote_confirm: bool,
    files: Vec<ShareFile>,
    file_index: usize,
    next_seq: u32,
    acked_through: Option<u32>,
    inflight: VecDeque<InflightChunk>,
    awaiting_accept: bool,
    end_sent: bool,
    end_retries: u8,
    ok_count: usize,
    fail_count: usize,
    started_at: u64,
    verify_since: u64,
    pending_since: u64,
    last_activity: u64,
    last_window_send: u64,
    decrypt_failures: u8,
    write_rejects: u8,
    pending_done: Option<(usize, usize)>,
}

impl SenderSession {
    pub fn new(
        rng: &mut (impl CryptoRng + RngCore),
        clock: Arc<dyn Clock>,
        app_ver: &str,
        label: &str,
        limits: ShareLimits,
        files: Vec<ShareFile>,
    ) -> Result<Self, String> {
        if files.len() > limits.max_files {
            return Err("ble-too-many-files".into());
        }
        let mut safe_files = Vec::with_capacity(files.len());
        for file in files {
            if file.bytes.len() as u64 > limits.max_file_bytes {
                return Err(format!("ble-too-large:{}", file.bytes.len()));
            }
            safe_files.push(ShareFile { name: sanitize_file_name(&file.name), bytes: file.bytes });
        }
        let mut instance = [0; 8];
        rng.fill_bytes(&mut instance);
        let now = clock.now_ms();
        Ok(Self {
            clock,
            app_ver: app_ver.chars().take(32).collect(),
            label: label.chars().take(32).collect(),
            phase: Phase::Idle,
            secret: StaticSecret::random_from_rng(rng),
            instance,
            crypto: None,
            local_confirm: false,
            remote_confirm: false,
            files: safe_files,
            file_index: 0,
            next_seq: 0,
            acked_through: None,
            inflight: VecDeque::new(),
            awaiting_accept: false,
            end_sent: false,
            end_retries: 0,
            ok_count: 0,
            fail_count: 0,
            started_at: now,
            verify_since: now,
            pending_since: now,
            last_activity: now,
            last_window_send: now,
            decrypt_failures: 0,
            write_rejects: 0,
            pending_done: None,
        })
    }

    pub fn on_connected(&mut self) -> Vec<Action> {
        if self.phase != Phase::Idle {
            return Vec::new();
        }
        let now = self.clock.now_ms();
        self.started_at = now;
        self.phase = Phase::Handshaking;
        self.write_rejects = 0;
        vec![self.hello_action()]
    }

    pub fn on_hello_ack(&mut self, body: HelloBody) -> Vec<Action> {
        if self.phase != Phase::Handshaking {
            return Vec::new();
        }
        if body.proto_ver != proto::PROTO_VER || body.max_frame as usize > proto::MAX_FRAME {
            return self.fail("ble-protocol-version", "unsupported protocol");
        }
        let Some(keys) = derive_session_keys(
            &self.secret,
            &self.instance,
            &PublicKey::from(body.ecdh_pub),
            &body.instance_id,
        ) else {
            return self.fail("ble-protocol-error", "non-contributory key exchange");
        };
        let sas_code = keys.sas_code.clone();
        self.crypto = Some(CryptoPair {
            incoming: DirCrypto::new(keys.key_r2s, 2, keys.session_id),
            outgoing: DirCrypto::new(keys.key_s2r, 1, keys.session_id),
        });
        self.phase = Phase::AwaitSas;
        self.verify_since = self.clock.now_ms();
        self.touch();
        vec![
            Action::Emit(SessionEvent::SasCode(sas_code)),
            Action::Emit(SessionEvent::ConfirmPending {
                peer_label: body.label,
                peer_version: body.app_ver,
            }),
        ]
    }

    pub fn on_user_confirm(&mut self, accepted: bool) -> Vec<Action> {
        if self.phase != Phase::AwaitSas {
            return Vec::new();
        }
        if !accepted {
            return self.cancel();
        }
        self.local_confirm = true;
        self.write_rejects = 0;
        let mut actions = vec![self.send(Frame::Confirm { accepted: true })];
        if self.remote_confirm {
            self.phase = Phase::Ready;
            actions.extend(self.begin_file());
        }
        actions
    }

    pub fn on_notify(&mut self, bytes: &[u8]) -> Vec<Action> {
        if matches!(self.phase, Phase::Closed | Phase::Complete) {
            return Vec::new();
        }
        let frame = match proto::decode(bytes) {
            Ok(frame) => frame,
            Err(_) => return self.fail("ble-protocol-error", "invalid frame"),
        };
        self.touch();
        match frame {
            Frame::HelloAck(body) => self.on_hello_ack(body),
            Frame::Sealed(sealed) => self.on_sealed(sealed),
            Frame::SessionCancel { .. } if !(self.local_confirm && self.remote_confirm) => self.cancel(),
            Frame::SessionCancel { .. } => Vec::new(),
            Frame::ProtoError { .. } => self.fail("ble-protocol-error", "peer rejected protocol"),
            frame if proto::is_cleartext_type(proto::encode_encrypted_body(&frame)[0]) => Vec::new(),
            frame => self.on_frame(frame),
        }
    }

    pub fn on_disconnect(&mut self) -> Vec<Action> {
        self.phase = Phase::Closed;
        self.clear_transfer();
        vec![Action::Emit(SessionEvent::Disconnected), Action::Teardown]
    }

    pub fn tick(&mut self) -> Vec<Action> {
        if matches!(self.phase, Phase::Idle | Phase::Closed | Phase::Complete) {
            return Vec::new();
        }
        let now = self.clock.now_ms();
        if self.phase == Phase::Handshaking && now.saturating_sub(self.started_at) >= 30_000 {
            return self.fail("ble-handshake-timeout", "handshake timed out");
        }
        if self.phase == Phase::AwaitSas && now.saturating_sub(self.verify_since) >= 300_000 {
            return self.fail("ble-timeout", "session confirmation timed out");
        }
        if self.awaiting_accept && now.saturating_sub(self.pending_since) >= 300_000 {
            return self.fail("ble-timeout", "file confirmation timed out");
        }
        if self.phase == Phase::Ready && !self.inflight.is_empty()
            && now.saturating_sub(self.last_window_send) >= 15_000
        {
            if self.inflight.iter().any(|chunk| chunk.retries >= 5) {
                self.fail_count += 1;
                let file_index = self.file_index as u16;
                let mut actions = vec![
                    self.send(Frame::FileCancel { file_index, reason: 4 }),
                    Action::Emit(SessionEvent::Failed {
                        code: "ble-timeout",
                        detail: "chunk retransmit limit reached".into(),
                    }),
                ];
                actions.extend(self.next_file());
                return actions;
            }
            let chunks: Vec<(u32, Vec<u8>)> = self.inflight.iter_mut().map(|chunk| {
                chunk.retries += 1;
                (chunk.seq, chunk.data.clone())
            }).collect();
            let file_index = self.file_index as u16;
            let mut actions = Vec::new();
            for (seq, data) in chunks {
                actions.push(self.send(Frame::Chunk { file_index, seq, data }));
            }
            self.last_window_send = now;
            return actions;
        }
        if self.phase == Phase::Ready && self.end_sent && self.inflight.is_empty()
            && now.saturating_sub(self.last_window_send) >= 15_000
        {
            if self.end_retries >= 5 {
                self.fail_count += 1;
                let file_index = self.file_index as u16;
                let mut actions = vec![self.send(Frame::FileCancel { file_index, reason: 4 })];
                actions.extend(self.next_file());
                return actions;
            }
            self.end_retries += 1;
            self.last_window_send = now;
            return vec![self.send(Frame::FileEnd { file_index: self.file_index as u16 })];
        }
        if self.phase == Phase::Ready && now.saturating_sub(self.last_activity) >= 10_000 {
            return vec![self.send(Frame::Keepalive)];
        }
        Vec::new()
    }

    pub fn on_user_cancel(&mut self) -> Vec<Action> {
        self.cancel()
    }

    /// The radio rejected one of our writes (ATT-level NACK or transient
    /// failure, not a disconnect). The frame is lost: handshake, pending
    /// file and session-completion frames are re-sent re-sealed with a
    /// fresh counter, chunk frames are left to the existing window
    /// retransmission in `tick`.
    pub fn on_write_rejected(&mut self, frame_type: u8) -> Vec<Action> {
        let retryable = match (self.phase, frame_type) {
            (Phase::Handshaking, TYPE_HELLO) => true,
            (Phase::AwaitSas, TYPE_CONFIRM) if self.local_confirm => true,
            (Phase::Ready, TYPE_CONFIRM | TYPE_FILE_BEGIN) if self.awaiting_accept => true,
            (Phase::Complete, TYPE_SESSION_COMPLETE) => true,
            _ => false,
        };
        if !retryable {
            return Vec::new();
        }
        if self.write_rejects >= MAX_WRITE_RETRIES {
            return self.fail("ble-protocol-error", "peer rejected repeated writes");
        }
        self.write_rejects += 1;
        match (self.phase, frame_type) {
            (Phase::Handshaking, _) => vec![self.hello_action()],
            (Phase::AwaitSas, _) => vec![self.send(Frame::Confirm { accepted: true })],
            (Phase::Ready, TYPE_CONFIRM) => vec![
                self.send(Frame::Confirm { accepted: true }),
                self.file_begin_action(),
            ],
            (Phase::Complete, _) => vec![self.send(Frame::SessionComplete), Action::Teardown],
            _ => vec![self.file_begin_action()],
        }
    }

    /// The radio accepted one of our writes. The success Done event may only
    /// exist after SESSION_COMPLETE actually landed on the peer; a pending
    /// Done is released exactly once.
    pub fn on_write_delivered(&mut self, frame_type: u8) -> Option<SessionEvent> {
        if frame_type == TYPE_SESSION_COMPLETE {
            if let Some((ok_count, fail_count)) = self.pending_done.take() {
                return Some(SessionEvent::Done { ok_count, fail_count });
            }
        }
        None
    }

    fn on_sealed(&mut self, sealed: SealedBody) -> Vec<Action> {
        let Some(crypto) = self.crypto.as_mut() else {
            return self.fail("ble-protocol-error", "encrypted frame before keys");
        };
        let sealed_frame = crate::ble::crypto::SealedFrame {
            counter: sealed.counter,
            ct: sealed.ct.clone(),
        };
        match crypto.incoming.open(&sealed_frame) {
            Ok(body) => {
                self.decrypt_failures = 0;
                match proto::decode_encrypted_body(sealed.frame_type, &body) {
                    Ok(frame) => self.on_frame(frame),
                    Err(_) => self.fail("ble-protocol-error", "invalid encrypted payload"),
                }
            }
            Err(CryptoError::Replayed) => Vec::new(),
            Err(CryptoError::OpenFailed) => {
                self.decrypt_failures = self.decrypt_failures.saturating_add(1);
                if self.decrypt_failures >= 3 {
                    self.fail("ble-protocol-error", "three undecryptable frames")
                } else {
                    Vec::new()
                }
            }
        }
    }

    fn on_frame(&mut self, frame: Frame) -> Vec<Action> {
        match frame {
            Frame::Confirm { accepted } => {
                if !accepted {
                    return self.cancel();
                }
                self.remote_confirm = true;
                if self.local_confirm && self.phase == Phase::AwaitSas {
                    self.phase = Phase::Ready;
                    return self.begin_file();
                }
                Vec::new()
            }
            Frame::FileAccept { file_index, accepted } => self.on_file_accept(file_index, accepted),
            Frame::ChunkAck { file_index, cum_seq } => self.on_chunk_ack(file_index, cum_seq),
            Frame::Resync { file_index, expected_seq } => self.on_resync(file_index, expected_seq),
            Frame::FileDone { file_index, ok } => self.on_file_done(file_index, ok),
            Frame::FileCancel { file_index, .. } => self.on_file_cancel(file_index),
            Frame::SessionCancel { .. } => self.cancel(),
            Frame::ProtoError { .. } => self.fail("ble-protocol-error", "peer protocol error"),
            _ => Vec::new(),
        }
    }

    fn on_file_accept(&mut self, file_index: u16, accepted: bool) -> Vec<Action> {
        if self.phase != Phase::Ready || file_index != self.file_index as u16 || !self.awaiting_accept {
            return Vec::new();
        }
        self.awaiting_accept = false;
        let mut actions = vec![Action::Emit(SessionEvent::FileResult { file_index, accepted })];
        if accepted {
            actions.extend(self.pump_chunks());
        } else {
            self.fail_count += 1;
            actions.extend(self.next_file());
        }
        actions
    }

    fn on_chunk_ack(&mut self, file_index: u16, cum_seq: u32) -> Vec<Action> {
        if file_index != self.file_index as u16 {
            return Vec::new();
        }
        self.acked_through = Some(self.acked_through.map_or(cum_seq, |previous| previous.max(cum_seq)));
        self.inflight.retain(|chunk| chunk.seq > cum_seq);
        self.last_window_send = self.clock.now_ms();
        let sent = self.files.get(self.file_index).map_or(0, |file| {
            file.bytes.len().min((cum_seq as usize + 1) * proto::MAX_CHUNK_DATA) as u64
        });
        let total = self.files.get(self.file_index).map_or(0, |file| file.bytes.len() as u64);
        let mut actions = vec![Action::Emit(SessionEvent::Progress { file_index, received: sent, total })];
        actions.extend(self.pump_chunks());
        actions
    }

    fn on_resync(&mut self, file_index: u16, expected_seq: u32) -> Vec<Action> {
        if file_index != self.file_index as u16 {
            return Vec::new();
        }
        self.next_seq = self.acked_through.map_or(expected_seq, |ack| expected_seq.max(ack + 1));
        self.inflight.clear();
        self.end_sent = false;
        self.last_window_send = self.clock.now_ms();
        self.pump_chunks()
    }

    fn on_file_done(&mut self, file_index: u16, ok: bool) -> Vec<Action> {
        if file_index != self.file_index as u16 {
            return Vec::new();
        }
        if ok { self.ok_count += 1; } else { self.fail_count += 1; }
        let mut actions = vec![Action::Emit(SessionEvent::FileVerified { file_index, ok })];
        if !ok {
            actions.push(Action::Emit(SessionEvent::Failed {
                code: "ble-hash-mismatch",
                detail: "receiver rejected file hash".into(),
            }));
        }
        actions.extend(self.next_file());
        actions
    }

    fn on_file_cancel(&mut self, file_index: u16) -> Vec<Action> {
        if file_index != self.file_index as u16 {
            return Vec::new();
        }
        self.fail_count += 1;
        let mut actions = vec![Action::Emit(SessionEvent::Failed {
            code: "ble-cancelled",
            detail: "receiver cancelled file".into(),
        })];
        actions.extend(self.next_file());
        actions
    }

    fn begin_file(&mut self) -> Vec<Action> {
        self.inflight.clear();
        self.next_seq = 0;
        self.acked_through = None;
        self.end_sent = false;
        self.end_retries = 0;
        self.pending_since = self.clock.now_ms();
        self.awaiting_accept = true;
        self.write_rejects = 0;
        if self.file_index >= self.files.len() {
            self.phase = Phase::Complete;
            self.pending_done = Some((self.ok_count, self.fail_count));
            let done = self.send(Frame::SessionComplete);
            self.files.clear();
            return vec![
                done,
                Action::Teardown,
            ];
        }
        vec![self.file_begin_action()]
    }

    fn hello_action(&mut self) -> Action {
        self.send(Frame::Hello(HelloBody {
            proto_ver: proto::PROTO_VER,
            max_frame: proto::MAX_FRAME as u16,
            instance_id: self.instance,
            ecdh_pub: PublicKey::from(&self.secret).to_bytes(),
            app_ver: self.app_ver.clone(),
            label: self.label.clone(),
        }))
    }

    fn file_begin_action(&mut self) -> Action {
        let file = &self.files[self.file_index];
        let file_index = self.file_index as u16;
        self.send(Frame::FileBegin(FileBegin {
            file_index,
            name: file.name.clone(),
            size: file.bytes.len() as u64,
            sha256: sha256(&file.bytes),
        }))
    }

    fn next_file(&mut self) -> Vec<Action> {
        self.file_index += 1;
        self.begin_file()
    }

    fn pump_chunks(&mut self) -> Vec<Action> {
        if self.awaiting_accept || self.file_index >= self.files.len() {
            return Vec::new();
        }
        let file_index = self.file_index as u16;
        let mut actions = Vec::new();
        while self.inflight.len() < 8 {
            let offset = self.next_seq as usize * proto::MAX_CHUNK_DATA;
            let file = &self.files[self.file_index];
            if offset >= file.bytes.len() {
                break;
            }
            let end = (offset + proto::MAX_CHUNK_DATA).min(file.bytes.len());
            let data = file.bytes[offset..end].to_vec();
            let seq = self.next_seq;
            self.next_seq += 1;
            self.inflight.push_back(InflightChunk { seq, data: data.clone(), retries: 0 });
            actions.push(self.send(Frame::Chunk { file_index, seq, data }));
        }
        let file = &self.files[self.file_index];
        if self.next_seq as usize * proto::MAX_CHUNK_DATA >= file.bytes.len()
            && self.inflight.is_empty() && !self.end_sent
        {
            self.end_sent = true;
            self.last_window_send = self.clock.now_ms();
            actions.push(self.send(Frame::FileEnd { file_index }));
        }
        actions
    }

    fn send(&mut self, frame: Frame) -> Action {
        let frame_type = proto::encode_encrypted_body(&frame)[0];
        self.touch();
        if proto::is_cleartext_type(frame_type)
            || (matches!(frame, Frame::SessionCancel { .. }) && !(self.local_confirm && self.remote_confirm))
        {
            return Action::Send(frame);
        }
        if let Some(crypto) = self.crypto.as_mut() {
            let sealed = crypto.outgoing.seal(&proto::encode_payload(&frame));
            return Action::Send(Frame::Sealed(SealedBody {
                frame_type,
                counter: sealed.counter,
                ct: sealed.ct,
            }));
        }
        Action::Send(frame)
    }

    fn cancel(&mut self) -> Vec<Action> {
        if self.phase == Phase::Closed {
            return Vec::new();
        }
        let send = self.send(Frame::SessionCancel { reason: 1 });
        self.phase = Phase::Closed;
        self.clear_transfer();
        vec![send, Action::Emit(SessionEvent::Cancelled), Action::Teardown]
    }

    fn fail(&mut self, code: &'static str, detail: &str) -> Vec<Action> {
        let send = self.send(Frame::SessionCancel { reason: 2 });
        self.phase = Phase::Closed;
        self.clear_transfer();
        vec![
            send,
            Action::Emit(SessionEvent::Failed { code, detail: detail.into() }),
            Action::Teardown,
        ]
    }

    fn clear_transfer(&mut self) {
        self.files.clear();
        self.inflight.clear();
        self.crypto = None;
        self.pending_done = None;
    }

    fn touch(&mut self) {
        self.last_activity = self.clock.now_ms();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ble::crypto::{derive_session_keys, DirCrypto, SessionKeys};
    use crate::ble::proto::{self, Frame, HelloBody, SealedBody};
    use rand_core::OsRng;
    use std::sync::Arc;
    use x25519_dalek::{PublicKey, StaticSecret};

    struct FakeClock(SharedTime);
    struct SharedTime(std::sync::Mutex<u64>);
    impl SharedTime {
        fn get(&self) -> u64 { *self.0.lock().unwrap() }
        fn set(&self, value: u64) { *self.0.lock().unwrap() = value; }
    }
    impl Clock for FakeClock { fn now_ms(&self) -> u64 { self.0.get() } }

    struct Harness {
        sender: SenderSession,
        clock: Arc<FakeClock>,
        receiver: DirCrypto,
        reader: DirCrypto,
        keys: SessionKeys,
    }

    fn limits() -> ShareLimits {
        ShareLimits { max_file_bytes: 2 * 1024 * 1024, max_files: 16 }
    }

    fn new_sender(files: Vec<ShareFile>) -> SenderSession {
        SenderSession::new(&mut OsRng, Arc::new(FakeClock(SharedTime(std::sync::Mutex::new(0)))), "0.1.10", "sender", limits(), files).unwrap()
    }

    fn harness(files: Vec<ShareFile>) -> Harness {
        let clock = Arc::new(FakeClock(SharedTime(std::sync::Mutex::new(0))));
        let mut sender = SenderSession::new(&mut OsRng, clock.clone(), "0.1.10", "sender", limits(), files).unwrap();
        let hello = sender.on_connected().into_iter().find_map(|action| match action {
            Action::Send(Frame::Hello(body)) => Some(body),
            _ => None,
        }).unwrap();
        let receiver_secret = StaticSecret::from([31; 32]);
        let receiver_instance = [41; 8];
        let acknowledgement = HelloBody {
            proto_ver: 1,
            max_frame: 180,
            instance_id: receiver_instance,
            ecdh_pub: PublicKey::from(&receiver_secret).to_bytes(),
            app_ver: "0.1.10".into(),
            label: "receiver".into(),
        };
        let keys = derive_session_keys(
            &receiver_secret,
            &receiver_instance,
            &PublicKey::from(hello.ecdh_pub),
            &hello.instance_id,
        ).unwrap();
        sender.on_hello_ack(acknowledgement);
        let receiver = DirCrypto::new(keys.key_r2s, 2, keys.session_id);
        let reader = DirCrypto::new(keys.key_s2r, 1, keys.session_id);
        Harness { sender, clock, receiver, reader, keys }
    }

    fn receive(h: &mut Harness, frame: Frame) -> Vec<Action> {
        let frame_type = proto::encode_encrypted_body(&frame)[0];
        let sealed = h.receiver.seal(&proto::encode_payload(&frame));
        let bytes = proto::encode(&Frame::Sealed(SealedBody {
            frame_type,
            counter: sealed.counter,
            ct: sealed.ct,
        })).unwrap();
        h.sender.on_notify(&bytes)
    }

    fn sent_frames(h: &mut Harness, actions: &[Action]) -> Vec<Frame> {
        actions.iter().filter_map(|action| match action {
            Action::Send(Frame::Sealed(sealed)) => {
                let body = h.reader.open(&crate::ble::crypto::SealedFrame {
                    counter: sealed.counter,
                    ct: sealed.ct.clone(),
                }).unwrap();
                Some(proto::decode_encrypted_body(sealed.frame_type, &body).unwrap())
            }
            Action::Send(frame) => Some(frame.clone()),
            _ => None,
        }).collect()
    }

    fn confirm(h: &mut Harness) {
        h.sender.on_user_confirm(true);
        receive(h, Frame::Confirm { accepted: true });
    }

    fn accept(h: &mut Harness, index: u16) {
        receive(h, Frame::FileAccept { file_index: index, accepted: true });
    }

    #[test]
    fn connected_starts_hello_and_handshake_timeout() {
        let clock = Arc::new(FakeClock(SharedTime(std::sync::Mutex::new(0))));
        let mut sender = SenderSession::new(&mut OsRng, clock.clone(), "1", "s", limits(), vec![]).unwrap();
        assert!(sender.tick().is_empty());
        let actions = sender.on_connected();
        assert_eq!(actions.iter().filter(|a| matches!(a, Action::Send(Frame::Hello(_)))).count(), 1);
        clock.0.set(30_001);
        let actions = sender.tick();
        assert!(actions.iter().any(|a| matches!(a, Action::Emit(SessionEvent::Failed { code: "ble-handshake-timeout", .. }))));
        assert!(actions.iter().any(|a| matches!(a, Action::Teardown)));
    }

    #[test]
    fn oversized_file_is_refused_before_radio() {
        let result = SenderSession::new(
            &mut OsRng,
            Arc::new(FakeClock(SharedTime(std::sync::Mutex::new(0)))),
            "1",
            "s",
            limits(),
            vec![ShareFile { name: "big.traj".into(), bytes: vec![0; 2 * 1024 * 1024 + 1] }],
        );
        assert!(result.is_err());
    }

    #[test]
    fn partial_ack_opens_only_one_new_slot() {
        let mut h = harness(vec![ShareFile { name: "a.traj".into(), bytes: vec![7; 2_000] }]);
        confirm(&mut h);
        accept(&mut h, 0);
        let actions = receive(&mut h, Frame::ChunkAck { file_index: 0, cum_seq: 0 });
        let chunks = sent_frames(&mut h, &actions).into_iter().filter(|f| matches!(f, Frame::Chunk { .. })).count();
        assert_eq!(chunks, 1);
    }

    #[test]
    fn resync_does_not_resend_acknowledged_chunks_and_reseals_retransmits() {
        let mut h = harness(vec![ShareFile { name: "a.traj".into(), bytes: vec![7; 2_000] }]);
        confirm(&mut h);
        accept(&mut h, 0);
        receive(&mut h, Frame::ChunkAck { file_index: 0, cum_seq: 2 });
        let actions = receive(&mut h, Frame::Resync { file_index: 0, expected_seq: 3 });
        let chunks = sent_frames(&mut h, &actions);
        assert!(!chunks.is_empty());
        assert!(chunks.iter().all(|f| matches!(f, Frame::Chunk { seq, .. } if *seq >= 3)));
    }

    #[test]
    fn retransmission_limit_cancels_the_file_without_reusing_counters() {
        let mut h = harness(vec![ShareFile { name: "a.traj".into(), bytes: vec![7; 500] }]);
        confirm(&mut h);
        accept(&mut h, 0);
        let mut previous = 0;
        for _ in 0..5 {
            h.clock.0.set(h.clock.0.get() + 15_001);
            let actions = h.sender.tick();
            for action in &actions {
                if let Action::Send(Frame::Sealed(sealed)) = action {
                    assert!(sealed.counter > previous);
                    previous = sealed.counter;
                }
            }
        }
        h.clock.0.set(h.clock.0.get() + 15_001);
        let actions = h.sender.tick();
        let frames = sent_frames(&mut h, &actions);
        assert!(frames.iter().any(|f| matches!(f, Frame::FileCancel { reason: 4, .. })));
    }

    #[test]
    fn multi_file_reject_and_complete_have_correct_counts() {
        let mut h = harness(vec![
            ShareFile { name: "a.traj".into(), bytes: vec![1; 800] },
            ShareFile { name: "b.traj".into(), bytes: vec![2; 10] },
            ShareFile { name: "c.traj".into(), bytes: vec![3; 100] },
        ]);
        confirm(&mut h);
        let mut done = false;
        for index in 0..3 {
            if index == 1 {
                receive(&mut h, Frame::FileAccept { file_index: index, accepted: false });
                continue;
            }
            accept(&mut h, index);
            let mut ack = 0;
            for _ in 0..100 {
                let actions = receive(&mut h, Frame::ChunkAck { file_index: index, cum_seq: ack });
                let frames = sent_frames(&mut h, &actions);
                if frames.iter().any(|f| matches!(f, Frame::FileEnd { .. })) {
                    let final_actions = receive(&mut h, Frame::FileDone { file_index: index, ok: true });
                    let complete_type = final_actions.iter().find_map(|action| match action {
                        Action::Send(Frame::Sealed(sealed)) if sealed.frame_type == TYPE_SESSION_COMPLETE => Some(sealed.frame_type),
                        _ => None,
                    });
                    if let Some(frame_type) = complete_type {
                        done |= matches!(
                            h.sender.on_write_delivered(frame_type),
                            Some(SessionEvent::Done { ok_count: 2, fail_count: 1 })
                        );
                    }
                    break;
                }
                ack += 1;
            }
        }
        assert!(done);
    }

    #[test]
    fn peer_cancel_and_user_cancel_are_terminal() {
        let mut h = harness(vec![ShareFile { name: "a.traj".into(), bytes: vec![1] }]);
        confirm(&mut h);
        let actions = receive(&mut h, Frame::SessionCancel { reason: 1 });
        assert!(actions.iter().any(|a| matches!(a, Action::Emit(SessionEvent::Cancelled))));
        assert!(actions.iter().any(|a| matches!(a, Action::Teardown)));

        let mut other = harness(vec![]);
        let actions = other.sender.on_user_cancel();
        assert!(actions.iter().any(|a| matches!(a, Action::Emit(SessionEvent::Cancelled))));
        assert!(actions.iter().any(|a| matches!(a, Action::Teardown)));
    }

    #[test]
    fn keepalive_and_long_active_sessions_have_no_global_cap() {
        let mut h = harness(vec![ShareFile { name: "a.traj".into(), bytes: vec![1; 2 * 1024 * 1024] }]);
        confirm(&mut h);
        accept(&mut h, 0);
        for seq in 0..2_700 {
            h.clock.0.set(h.clock.0.get() + 1_000);
            let actions = h.sender.tick();
            assert!(!actions.iter().any(|a| matches!(a, Action::Teardown)));
            let actions = receive(&mut h, Frame::ChunkAck { file_index: 0, cum_seq: seq });
            assert!(!actions.iter().any(|a| matches!(a, Action::Teardown)));
        }
    }

    fn sealed_counter(actions: &[Action], frame_type: u8) -> u64 {
        actions.iter().find_map(|action| match action {
            Action::Send(Frame::Sealed(sealed)) if sealed.frame_type == frame_type => Some(sealed.counter),
            _ => None,
        }).expect("expected a sealed frame of the given type")
    }

    #[test]
    fn write_retry_frame_types_match_the_wire_codec() {
        let hello = sender_hello_bytes();
        assert_eq!(proto::frame_type_of(&hello).unwrap(), TYPE_HELLO);
        assert_eq!(
            proto::frame_type_of(&proto::encode_encrypted_body(&Frame::Confirm { accepted: true })).unwrap(),
            TYPE_CONFIRM,
        );
        let file = ShareFile { name: "a.traj".into(), bytes: vec![1; 10] };
        let begin = Frame::FileBegin(FileBegin {
            file_index: 0,
            name: file.name.clone(),
            size: file.bytes.len() as u64,
            sha256: sha256(&file.bytes),
        });
        assert_eq!(
            proto::frame_type_of(&proto::encode_encrypted_body(&begin)).unwrap(),
            TYPE_FILE_BEGIN,
        );
    }

    fn sender_hello_bytes() -> Vec<u8> {
        let mut sender = new_sender(vec![]);
        sender.on_connected().into_iter().find_map(|action| match action {
            Action::Send(Frame::Hello(_)) => Some(()),
            _ => None,
        }).expect("on_connected sends hello");
        proto::encode_encrypted_body(&Frame::Hello(HelloBody {
            proto_ver: proto::PROTO_VER,
            max_frame: proto::MAX_FRAME as u16,
            instance_id: [0; 8],
            ecdh_pub: [0; 32],
            app_ver: String::new(),
            label: String::new(),
        }))
    }

    #[test]
    fn rejected_hello_retries_are_bounded_and_terminal() {
        let mut sender = new_sender(vec![]);
        let actions = sender.on_connected();
        assert!(actions.iter().any(|a| matches!(a, Action::Send(Frame::Hello(_)))));
        for _ in 0..5 {
            let retry = sender.on_write_rejected(TYPE_HELLO);
            assert!(
                retry.iter().any(|a| matches!(a, Action::Send(Frame::Hello(_)))),
                "each rejection within the bound must resend hello"
            );
        }
        let actions = sender.on_write_rejected(TYPE_HELLO);
        assert!(actions.iter().any(|a| matches!(a, Action::Emit(SessionEvent::Failed { code: "ble-protocol-error", .. }))));
        assert!(actions.iter().any(|a| matches!(a, Action::Teardown)));
        assert!(sender.on_write_rejected(TYPE_HELLO).is_empty(), "closed session ignores further rejections");
    }

    #[test]
    fn rejected_confirm_and_file_begin_reseal_with_fresh_counters() {
        let mut h = harness(vec![ShareFile { name: "a.traj".into(), bytes: vec![7; 300] }]);
        let actions = h.sender.on_user_confirm(true);
        let confirm_counter = sealed_counter(&actions, TYPE_CONFIRM);
        let retry = h.sender.on_write_rejected(TYPE_CONFIRM);
        assert!(sealed_counter(&retry, TYPE_CONFIRM) > confirm_counter);

        let begin_actions = receive(&mut h, Frame::Confirm { accepted: true });
        let begin_counter = sealed_counter(&begin_actions, TYPE_FILE_BEGIN);
        let retry = h.sender.on_write_rejected(TYPE_FILE_BEGIN);
        assert!(sealed_counter(&retry, TYPE_FILE_BEGIN) > begin_counter);
        let frames = sent_frames(&mut h, &retry);
        assert!(frames.iter().any(|f| matches!(f, Frame::FileBegin(file) if file.file_index == 0)));
    }

    #[test]
    fn rejected_confirm_after_ready_resends_confirm_then_file_begin() {
        let mut h = harness(vec![ShareFile { name: "a.traj".into(), bytes: vec![7; 300] }]);
        receive(&mut h, Frame::Confirm { accepted: true });
        let actions = h.sender.on_user_confirm(true);
        let confirm_counter = sealed_counter(&actions, TYPE_CONFIRM);
        let begin_counter = sealed_counter(&actions, TYPE_FILE_BEGIN);
        let retry = h.sender.on_write_rejected(TYPE_CONFIRM);
        assert!(sealed_counter(&retry, TYPE_CONFIRM) > confirm_counter.max(begin_counter));
        assert!(sealed_counter(&retry, TYPE_FILE_BEGIN) > confirm_counter.max(begin_counter));
        let frames = sent_frames(&mut h, &retry);
        assert!(frames.iter().any(|f| matches!(f, Frame::Confirm { accepted: true })));
        assert!(frames.iter().any(|f| matches!(f, Frame::FileBegin(file) if file.file_index == 0)));
    }

    #[test]
    fn rejected_chunk_and_keepalive_writes_defer_to_existing_recovery() {
        let mut h = harness(vec![ShareFile { name: "a.traj".into(), bytes: vec![7; 300] }]);
        confirm(&mut h);
        accept(&mut h, 0);
        let chunk_type = proto::frame_type_of(&proto::encode_encrypted_body(&Frame::Chunk {
            file_index: 0,
            seq: 0,
            data: vec![0],
        })).unwrap();
        assert!(h.sender.on_write_rejected(chunk_type).is_empty());
        assert!(h.sender.on_write_rejected(TYPE_KEEPALIVE).is_empty());
    }

    fn complete_harness() -> Harness {
        let mut h = harness(vec![ShareFile { name: "a.traj".into(), bytes: vec![] }]);
        confirm(&mut h);
        accept(&mut h, 0);
        h
    }

    #[test]
    fn session_complete_waits_for_delivery_before_done() {
        let mut h = complete_harness();
        let actions = receive(&mut h, Frame::FileDone { file_index: 0, ok: true });
        let complete = actions.iter().find_map(|action| match action {
            Action::Send(Frame::Sealed(sealed)) if sealed.frame_type == TYPE_SESSION_COMPLETE => Some(sealed.clone()),
            _ => None,
        }).expect("session complete must be sent");
        assert!(
            !actions.iter().any(|a| matches!(a, Action::Emit(SessionEvent::Done { .. }))),
            "Done must not ride the same list as the completion frame"
        );
        assert!(actions.iter().any(|a| matches!(a, Action::Teardown)));
        assert_eq!(
            h.sender.on_write_delivered(complete.frame_type),
            Some(SessionEvent::Done { ok_count: 1, fail_count: 0 })
        );
        assert!(
            h.sender.on_write_delivered(complete.frame_type).is_none(),
            "a repeated delivery must not repeat Done"
        );
    }

    #[test]
    fn rejected_session_complete_is_retried_bounded_with_fresh_counters() {
        let mut h = complete_harness();
        let actions = receive(&mut h, Frame::FileDone { file_index: 0, ok: true });
        let complete_counter = sealed_counter(&actions, TYPE_SESSION_COMPLETE);
        let mut previous = complete_counter;
        for _ in 0..5 {
            let retry = h.sender.on_write_rejected(TYPE_SESSION_COMPLETE);
            let counter = sealed_counter(&retry, TYPE_SESSION_COMPLETE);
            assert!(counter > previous, "each retry must be re-sealed with a fresh counter");
            previous = counter;
            assert!(retry.iter().any(|a| matches!(a, Action::Teardown)));
        }
        let actions = h.sender.on_write_rejected(TYPE_SESSION_COMPLETE);
        assert!(actions.iter().any(|a| matches!(a, Action::Emit(SessionEvent::Failed { code: "ble-protocol-error", .. }))));
        assert!(actions.iter().any(|a| matches!(a, Action::Teardown)));
        assert!(h.sender.on_write_rejected(TYPE_SESSION_COMPLETE).is_empty());
        assert!(
            h.sender.on_write_delivered(TYPE_SESSION_COMPLETE).is_none(),
            "exhausted retries must never release the pending Done"
        );
    }

    #[test]
    fn disconnect_clears_pending_done() {
        let mut h = complete_harness();
        let actions = receive(&mut h, Frame::FileDone { file_index: 0, ok: true });
        assert!(actions.iter().any(|a| matches!(a, Action::Send(Frame::Sealed(sealed)) if sealed.frame_type == TYPE_SESSION_COMPLETE)));
        let actions = h.sender.on_disconnect();
        assert!(actions.iter().any(|a| matches!(a, Action::Emit(SessionEvent::Disconnected))));
        assert!(
            h.sender.on_write_delivered(TYPE_SESSION_COMPLETE).is_none(),
            "a late delivery after close must not report success"
        );
    }
}
