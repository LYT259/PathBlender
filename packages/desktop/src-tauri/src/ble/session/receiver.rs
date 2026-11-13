use super::{Action, AttResult, Clock, ReceivedFile, SessionEvent, ShareLimits};
use crate::ble::crypto::{derive_session_keys, sha256, CryptoError, DirCrypto, SessionKeys};
use crate::ble::proto::{self, Frame, HelloBody, SealedBody};
use crate::ble::sanitize::sanitize_file_name;
use rand_core::{CryptoRng, RngCore};
use std::collections::BTreeSet;
use std::sync::Arc;
use x25519_dalek::{PublicKey, StaticSecret};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    AwaitHello,
    AwaitSas,
    Ready,
    Complete,
    Closed,
}

struct CryptoPair {
    incoming: DirCrypto,
    outgoing: DirCrypto,
}

struct CurrentFile {
    index: u16,
    name: String,
    size: u64,
    sha256: [u8; 32],
    bytes: Vec<u8>,
    next_seq: u32,
    approved: bool,
}

pub struct ReceiverSession {
    clock: Arc<dyn Clock>,
    app_ver: String,
    label: String,
    limits: ShareLimits,
    phase: Phase,
    secret: StaticSecret,
    instance: [u8; 8],
    crypto: Option<CryptoPair>,
    local_confirm: bool,
    remote_confirm: bool,
    current: Option<CurrentFile>,
    seen: BTreeSet<u16>,
    completed: Vec<ReceivedFile>,
    ok_count: usize,
    fail_count: usize,
    last_peer_activity: u64,
    last_keepalive: u64,
    started_at: u64,
    decrypt_failures: u8,
}

impl ReceiverSession {
    pub fn new(
        rng: &mut (impl CryptoRng + RngCore),
        clock: Arc<dyn Clock>,
        app_ver: &str,
        label: &str,
        limits: ShareLimits,
    ) -> Self {
        let mut instance = [0; 8];
        rng.fill_bytes(&mut instance);
        let now = clock.now_ms();
        Self {
            clock,
            app_ver: app_ver.chars().take(32).collect(),
            label: label.chars().take(32).collect(),
            limits,
            phase: Phase::AwaitHello,
            secret: StaticSecret::random_from_rng(rng),
            instance,
            crypto: None,
            local_confirm: false,
            remote_confirm: false,
            current: None,
            seen: BTreeSet::new(),
            completed: Vec::new(),
            ok_count: 0,
            fail_count: 0,
            last_peer_activity: now,
            last_keepalive: now,
            started_at: now,
            decrypt_failures: 0,
        }
    }

    pub fn on_write(&mut self, bytes: &[u8]) -> (Vec<Action>, AttResult) {
        if matches!(self.phase, Phase::Closed | Phase::Complete) {
            return (Vec::new(), AttResult::Success);
        }
        let frame = match proto::decode(bytes) {
            Ok(frame) => frame,
            Err(_) => {
                return (
                    vec![Action::Emit(SessionEvent::Failed {
                        code: "ble-protocol-error",
                        detail: "invalid frame".into(),
                    })],
                    AttResult::RequestNotSupported,
                );
            }
        };
        self.touch();
        let actions = match frame {
            Frame::Hello(body) => self.on_hello(body),
            Frame::Sealed(sealed) => return self.on_sealed(sealed),
            Frame::SessionCancel { .. } if !(self.local_confirm && self.remote_confirm) => {
                self.cancel()
            }
            Frame::SessionCancel { .. } => Vec::new(),
            Frame::ProtoError { .. } => self.fail("ble-protocol-error", "peer rejected protocol"),
            frame if proto::is_cleartext_type(proto::encode_encrypted_body(&frame)[0]) => Vec::new(),
            frame => self.on_frame(frame),
        };
        (actions, AttResult::Success)
    }

    pub fn on_user_confirm(&mut self, accepted: bool) -> Vec<Action> {
        if self.phase != Phase::AwaitSas {
            return Vec::new();
        }
        if !accepted {
            return self.cancel();
        }
        self.local_confirm = true;
        let mut actions = vec![self.send(Frame::Confirm { accepted: true })];
        if self.remote_confirm {
            self.phase = Phase::Ready;
            actions.push(Action::Emit(SessionEvent::Confirmed));
        }
        actions
    }

    pub fn on_user_file(&mut self, file_index: u16, accepted: bool) -> Vec<Action> {
        let Some(file) = self.current.as_mut() else { return Vec::new() };
        if file.index != file_index || file.approved {
            return Vec::new();
        }
        if !accepted {
            self.current = None;
            self.fail_count += 1;
            return vec![
                self.send(Frame::FileAccept { file_index, accepted: false }),
                Action::Emit(SessionEvent::FileResult { file_index, accepted: false }),
            ];
        }
        file.approved = true;
        vec![
            self.send(Frame::FileAccept { file_index, accepted: true }),
            Action::Emit(SessionEvent::FileResult { file_index, accepted: true }),
        ]
    }

    pub fn on_user_cancel(&mut self) -> Vec<Action> {
        self.cancel()
    }

    pub fn on_disconnect(&mut self) -> Vec<Action> {
        self.phase = Phase::Closed;
        self.current = None;
        self.completed.clear();
        self.crypto = None;
        vec![Action::Emit(SessionEvent::Disconnected), Action::Teardown]
    }

    pub fn tick(&mut self) -> Vec<Action> {
        if matches!(self.phase, Phase::Closed | Phase::Complete) {
            return Vec::new();
        }
        let now = self.clock.now_ms();
        if self.phase == Phase::AwaitHello && now.saturating_sub(self.started_at) >= 30_000 {
            return self.fail("ble-handshake-timeout", "handshake timed out");
        }
        let peer_idle = now.saturating_sub(self.last_peer_activity);
        let waiting_for_confirmation = self.phase == Phase::AwaitSas
            || self.current.as_ref().is_some_and(|file| !file.approved);
        if waiting_for_confirmation && peer_idle >= 300_000 {
            return self.fail("ble-timeout", "confirmation timed out");
        }
        if self.phase == Phase::Ready
            && self.current.as_ref().is_some_and(|file| file.approved)
            && peer_idle >= 30_000
        {
            return self.fail("ble-timeout", "file transfer timed out");
        }
        if self.phase == Phase::Ready && peer_idle >= 10_000
            && now.saturating_sub(self.last_keepalive) >= 10_000
        {
            self.last_keepalive = now;
            return vec![self.send(Frame::Keepalive)];
        }
        Vec::new()
    }

    pub fn take_files(&mut self) -> Vec<ReceivedFile> {
        if self.phase != Phase::Complete {
            return Vec::new();
        }
        self.phase = Phase::Closed;
        std::mem::take(&mut self.completed)
    }

    fn on_hello(&mut self, body: HelloBody) -> Vec<Action> {
        if self.phase != Phase::AwaitHello {
            return Vec::new();
        }
        if body.proto_ver != proto::PROTO_VER || body.max_frame as usize > proto::MAX_FRAME {
            self.phase = Phase::Closed;
            return vec![
                Action::Send(Frame::ProtoError { code: 1 }),
                Action::Teardown,
            ];
        }
        let Some(keys) = derive_session_keys(
            &self.secret,
            &self.instance,
            &PublicKey::from(body.ecdh_pub),
            &body.instance_id,
        ) else {
            self.phase = Phase::Closed;
            return vec![Action::Send(Frame::ProtoError { code: 2 }), Action::Teardown];
        };
        let sas_code = keys.sas_code.clone();
        self.install_keys(keys);
        self.phase = Phase::AwaitSas;
        self.touch();
        vec![
            self.send(Frame::HelloAck(HelloBody {
                proto_ver: proto::PROTO_VER,
                max_frame: proto::MAX_FRAME as u16,
                instance_id: self.instance,
                ecdh_pub: PublicKey::from(&self.secret).to_bytes(),
                app_ver: self.app_ver.clone(),
                label: self.label.clone(),
            })),
            Action::Emit(SessionEvent::SasCode(sas_code)),
            Action::Emit(SessionEvent::ConfirmPending {
                peer_label: body.label,
                peer_version: body.app_ver,
            }),
        ]
    }

    fn install_keys(&mut self, keys: SessionKeys) {
        self.crypto = Some(CryptoPair {
            incoming: DirCrypto::new(keys.key_s2r, 1, keys.session_id),
            outgoing: DirCrypto::new(keys.key_r2s, 2, keys.session_id),
        });
    }

    fn on_sealed(&mut self, sealed: SealedBody) -> (Vec<Action>, AttResult) {
        let Some(crypto) = self.crypto.as_mut() else {
            return (Vec::new(), AttResult::RequestNotSupported);
        };
        let sealed_frame = crate::ble::crypto::SealedFrame {
            counter: sealed.counter,
            ct: sealed.ct.clone(),
        };
        match crypto.incoming.open(&sealed_frame) {
            Ok(body) => {
                self.decrypt_failures = 0;
                match proto::decode_encrypted_body(sealed.frame_type, &body) {
                    Ok(frame) => (self.on_frame(frame), AttResult::Success),
                    Err(_) => (
                        vec![Action::Emit(SessionEvent::Failed {
                            code: "ble-protocol-error",
                            detail: "invalid encrypted payload".into(),
                        })],
                        AttResult::RequestNotSupported,
                    ),
                }
            }
            Err(CryptoError::Replayed) => (Vec::new(), AttResult::Success),
            Err(CryptoError::OpenFailed) => {
                self.decrypt_failures = self.decrypt_failures.saturating_add(1);
                if self.decrypt_failures >= 3 {
                    (self.fail("ble-protocol-error", "three undecryptable frames"), AttResult::RequestNotSupported)
                } else if let Some(file) = self.current.as_ref() {
                    (
                        vec![self.send(Frame::Resync {
                            file_index: file.index,
                            expected_seq: file.next_seq,
                        })],
                        AttResult::RequestNotSupported,
                    )
                } else {
                    (Vec::new(), AttResult::RequestNotSupported)
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
                    return vec![Action::Emit(SessionEvent::Confirmed)];
                }
                Vec::new()
            }
            Frame::FileBegin(file) => self.on_file_begin(file),
            Frame::Chunk { file_index, seq, data } => self.on_chunk(file_index, seq, data),
            Frame::FileEnd { file_index } => self.on_file_end(file_index),
            Frame::FileCancel { file_index, .. } => {
                if self.current.as_ref().is_some_and(|file| file.index == file_index) {
                    self.current = None;
                    self.fail_count += 1;
                }
                vec![Action::Emit(SessionEvent::Failed {
                    code: "ble-cancelled",
                    detail: "peer cancelled file".into(),
                })]
            }
            Frame::SessionComplete => {
                if self.phase != Phase::Ready || self.current.is_some() {
                    return vec![self.send(Frame::FileCancel {
                        file_index: self.current.as_ref().map_or(0, |file| file.index),
                        reason: 3,
                    })];
                }
                self.phase = Phase::Complete;
                vec![
                    Action::Teardown,
                    Action::Emit(SessionEvent::Done {
                        ok_count: self.ok_count,
                        fail_count: self.fail_count,
                    }),
                ]
            }
            Frame::SessionCancel { .. } => self.cancel(),
            Frame::ProtoError { .. } => self.fail("ble-protocol-error", "peer protocol error"),
            _ => Vec::new(),
        }
    }

    fn on_file_begin(&mut self, file: proto::FileBegin) -> Vec<Action> {
        if self.phase != Phase::Ready {
            return vec![self.send(Frame::FileCancel { file_index: file.file_index, reason: 3 })];
        }
        let duplicate_of_current = self.current.as_ref().is_some_and(|current| {
            current.index == file.file_index
                && current.size == file.size
                && current.sha256 == file.sha256
                && current.name == sanitize_file_name(&file.name)
        });
        if duplicate_of_current {
            if self.current.as_ref().is_some_and(|current| current.approved) {
                return vec![self.send(Frame::FileAccept { file_index: file.file_index, accepted: true })];
            }
            return Vec::new();
        }
        if let Some(abandoned) = self.current.take() {
            self.fail_count += 1;
            return vec![
                self.send(Frame::FileCancel { file_index: file.file_index, reason: 3 }),
                Action::Emit(SessionEvent::Failed {
                    code: "ble-protocol-error",
                    detail: format!("file begin {} replaced active file {}", file.file_index, abandoned.index),
                }),
            ];
        }
        if self.seen.len() >= self.limits.max_files || !self.seen.insert(file.file_index) {
            return vec![self.send(Frame::FileCancel { file_index: file.file_index, reason: 3 })];
        }
        if file.size > self.limits.max_file_bytes {
            self.fail_count += 1;
            return vec![self.send(Frame::FileCancel { file_index: file.file_index, reason: 5 })];
        }
        let name = sanitize_file_name(&file.name);
        self.current = Some(CurrentFile {
            index: file.file_index,
            name: name.clone(),
            size: file.size,
            sha256: file.sha256,
            bytes: Vec::with_capacity(file.size as usize),
            next_seq: 0,
            approved: false,
        });
        vec![Action::Emit(SessionEvent::FileRequest {
            file_index: file.file_index,
            name,
            size: file.size,
        })]
    }

    fn on_chunk(&mut self, file_index: u16, seq: u32, data: Vec<u8>) -> Vec<Action> {
        let valid = self.current.as_ref().is_some_and(|file| file.approved && file.index == file_index);
        if !valid {
            return vec![self.send(Frame::FileCancel { file_index, reason: 3 })];
        }
        let mut file = self.current.take().unwrap();
        if seq < file.next_seq {
            let cum_seq = file.next_seq - 1;
            self.current = Some(file);
            return vec![self.send(Frame::ChunkAck { file_index, cum_seq })];
        }
        if seq > file.next_seq {
            let expected_seq = file.next_seq;
            self.current = Some(file);
            return vec![self.send(Frame::Resync { file_index, expected_seq })];
        }
        if file.bytes.len() as u64 + data.len() as u64 > file.size {
            self.fail_count += 1;
            return vec![
                self.send(Frame::FileCancel { file_index, reason: 3 }),
                Action::Emit(SessionEvent::Failed {
                    code: "ble-protocol-error",
                    detail: "chunk exceeds declared file size".into(),
                }),
            ];
        }
        file.bytes.extend_from_slice(&data);
        file.next_seq += 1;
        let received = file.bytes.len() as u64;
        let total = file.size;
        self.current = Some(file);
        self.touch();
        vec![
            self.send(Frame::ChunkAck { file_index, cum_seq: seq }),
            Action::Emit(SessionEvent::Progress { file_index, received, total }),
        ]
    }

    fn on_file_end(&mut self, file_index: u16) -> Vec<Action> {
        let Some(file) = self.current.take() else {
            return vec![self.send(Frame::FileCancel { file_index, reason: 3 })];
        };
        if file.index != file_index || !file.approved {
            self.current = Some(file);
            return Vec::new();
        }
        let ok = file.bytes.len() as u64 == file.size && sha256(&file.bytes) == file.sha256;
        if ok {
            self.completed.push(ReceivedFile {
                index: file.index,
                name: file.name,
                bytes: file.bytes,
            });
            self.ok_count += 1;
        } else {
            self.fail_count += 1;
        }
        let mut actions = vec![
            self.send(Frame::FileDone { file_index, ok }),
            Action::Emit(SessionEvent::FileVerified { file_index, ok }),
        ];
        if !ok {
            actions.push(Action::Emit(SessionEvent::Failed {
                code: "ble-hash-mismatch",
                detail: "received bytes differ from declared hash".into(),
            }));
        }
        actions
    }

    fn send(&mut self, frame: Frame) -> Action {
        let frame_type = proto::encode_encrypted_body(&frame)[0];
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
        self.current = None;
        self.completed.clear();
        self.crypto = None;
        vec![send, Action::Emit(SessionEvent::Cancelled), Action::Teardown]
    }

    fn fail(&mut self, code: &'static str, detail: &str) -> Vec<Action> {
        let send = self.send(Frame::SessionCancel { reason: 2 });
        self.phase = Phase::Closed;
        self.current = None;
        self.completed.clear();
        self.crypto = None;
        vec![
            send,
            Action::Emit(SessionEvent::Failed { code, detail: detail.into() }),
            Action::Teardown,
        ]
    }

    fn touch(&mut self) {
        self.last_peer_activity = self.clock.now_ms();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ble::crypto::{derive_session_keys, sha256, DirCrypto};
    use crate::ble::proto::{self, FileBegin, Frame, HelloBody, SealedBody};
    use rand_core::OsRng;
    use std::sync::Arc;
    use x25519_dalek::{PublicKey, StaticSecret};

    struct FakeClock(SharedTime);
    struct SharedTime(std::sync::Mutex<u64>);
    impl SharedTime {
        fn get(&self) -> u64 { *self.0.lock().unwrap() }
        fn set(&self, value: u64) { *self.0.lock().unwrap() = value; }
    }
    impl Clock for FakeClock {
        fn now_ms(&self) -> u64 { self.0.get() }
    }

    struct Harness {
        session: ReceiverSession,
        clock: Arc<FakeClock>,
        sender: DirCrypto,
        reader: DirCrypto,
        sender_secret: StaticSecret,
        sender_instance: [u8; 8],
    }

    fn harness() -> Harness {
        let clock = Arc::new(FakeClock(SharedTime(std::sync::Mutex::new(0))));
        let mut session = ReceiverSession::new(
            &mut OsRng,
            clock.clone(),
            "0.1.10",
            "receiver",
            ShareLimits { max_file_bytes: 2 * 1024 * 1024, max_files: 16 },
        );
        let sender_secret = StaticSecret::from([11; 32]);
        let sender_instance = [22; 8];
        let hello = HelloBody {
            proto_ver: proto::PROTO_VER,
            max_frame: proto::MAX_FRAME as u16,
            instance_id: sender_instance,
            ecdh_pub: PublicKey::from(&sender_secret).to_bytes(),
            app_ver: "0.1.10".into(),
            label: "sender".into(),
        };
        let actions = session.on_write(&proto::encode(&Frame::Hello(hello)).unwrap()).0;
        let acknowledgement = actions.into_iter().find_map(|action| match action {
            Action::Send(Frame::HelloAck(body)) => Some(body),
            _ => None,
        }).unwrap();
        let keys = derive_session_keys(
            &sender_secret,
            &sender_instance,
            &PublicKey::from(acknowledgement.ecdh_pub),
            &acknowledgement.instance_id,
        ).unwrap();
        let sender = DirCrypto::new(keys.key_s2r, 1, keys.session_id);
        let reader = DirCrypto::new(keys.key_r2s, 2, keys.session_id);
        Harness { session, clock, sender, reader, sender_secret, sender_instance }
    }

    fn send(h: &mut Harness, frame: Frame) -> Vec<Action> {
        let sealed = h.sender.seal(&proto::encode_payload(&frame));
        let frame_type = proto::encode_encrypted_body(&frame)[0];
        let bytes = proto::encode(&Frame::Sealed(SealedBody {
            frame_type,
            counter: sealed.counter,
            ct: sealed.ct,
        })).unwrap();
        h.session.on_write(&bytes).0
    }

    fn confirm(h: &mut Harness) {
        h.session.on_user_confirm(true);
        let actions = send(h, Frame::Confirm { accepted: true });
        assert!(actions.iter().any(|a| matches!(a, Action::Emit(SessionEvent::Confirmed))));
    }

    fn offer(h: &mut Harness, index: u16, name: &str, bytes: &[u8]) {
        let actions = send(h, Frame::FileBegin(FileBegin {
            file_index: index,
            name: name.into(),
            size: bytes.len() as u64,
            sha256: sha256(bytes),
        }));
        assert!(actions.iter().any(|a| matches!(a, Action::Emit(SessionEvent::FileRequest { .. }))));
    }

    fn outgoing_frames(h: &mut Harness, actions: &[Action]) -> Vec<Frame> {
        actions.iter().filter_map(|action| match action {
            Action::Send(Frame::Sealed(sealed)) => {
                let body = h.reader.open(&crate::ble::crypto::SealedFrame {
                    counter: sealed.counter,
                    ct: sealed.ct.clone(),
                }).ok()?;
                proto::decode_encrypted_body(sealed.frame_type, &body).ok()
            }
            Action::Send(frame) => Some(frame.clone()),
            _ => None,
        }).collect()
    }

    #[test]
    fn wrong_version_is_rejected_before_crypto() {
        let clock = Arc::new(FakeClock(SharedTime(std::sync::Mutex::new(0))));
        let mut session = ReceiverSession::new(&mut OsRng, clock, "1", "r", ShareLimits { max_file_bytes: 100, max_files: 2 });
        let secret = StaticSecret::from([8; 32]);
        let hello = HelloBody {
            proto_ver: 2,
            max_frame: 180,
            instance_id: [1; 8],
            ecdh_pub: PublicKey::from(&secret).to_bytes(),
            app_ver: "1".into(),
            label: "s".into(),
        };
        let (actions, att) = session.on_write(&proto::encode(&Frame::Hello(hello)).unwrap());
        assert_eq!(att, AttResult::Success);
        assert!(actions.iter().any(|a| matches!(a, Action::Send(Frame::ProtoError { code: 1 }))));
        assert!(actions.iter().any(|a| matches!(a, Action::Teardown)));
    }

    #[test]
    fn confirmation_is_required_and_rejection_cancels() {
        let mut h = harness();
        h.session.on_user_confirm(true);
        assert!(send(&mut h, Frame::Confirm { accepted: true }).iter().any(|a| matches!(a, Action::Emit(SessionEvent::Confirmed))));

        let mut denied = harness();
        let actions = denied.session.on_user_confirm(false);
        assert!(actions.iter().any(|a| matches!(a, Action::Send(Frame::SessionCancel { reason: 1 }))));
        assert!(actions.iter().any(|a| matches!(a, Action::Teardown)));
    }

    #[test]
    fn cleartext_cancel_is_ignored_after_confirmation() {
        let mut h = harness();
        confirm(&mut h);
        let bytes = proto::encode(&Frame::SessionCancel { reason: 1 }).unwrap();
        assert!(h.session.on_write(&bytes).0.is_empty());
    }

    #[test]
    fn rejected_file_cannot_send_chunks() {
        let mut h = harness();
        confirm(&mut h);
        offer(&mut h, 0, "a.traj", b"abc");
        let actions = h.session.on_user_file(0, false);
        assert!(actions.iter().any(|a| matches!(a, Action::Send(Frame::Sealed(SealedBody { frame_type: 0x11, .. })))));
        let actions = send(&mut h, Frame::Chunk { file_index: 0, seq: 0, data: b"abc".to_vec() });
        assert!(actions.iter().any(|a| matches!(a, Action::Send(Frame::Sealed(SealedBody { frame_type: 0x17, .. })))));
    }

    #[test]
    fn verified_file_is_returned_only_after_session_complete() {
        let mut h = harness();
        confirm(&mut h);
        let bytes = vec![42; 800];
        offer(&mut h, 0, "../route.traj", &bytes);
        h.session.on_user_file(0, true);
        for (seq, chunk) in bytes.chunks(proto::MAX_CHUNK_DATA).enumerate() {
            send(&mut h, Frame::Chunk { file_index: 0, seq: seq as u32, data: chunk.to_vec() });
        }
        send(&mut h, Frame::FileEnd { file_index: 0 });
        assert!(h.session.take_files().is_empty());
        let actions = send(&mut h, Frame::SessionComplete);
        assert!(actions.iter().any(|a| matches!(a, Action::Emit(SessionEvent::Done { ok_count: 1, fail_count: 0 }))));
        let files = h.session.take_files();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].name, "route.traj");
        assert_eq!(files[0].bytes, bytes);
    }

    #[test]
    fn replay_is_silent_and_counter_gaps_are_allowed() {
        let mut h = harness();
        confirm(&mut h);
        offer(&mut h, 0, "a.traj", b"abcdef");
        h.session.on_user_file(0, true);
        let sealed = h.sender.seal(&proto::encode_payload(&Frame::Chunk { file_index: 0, seq: 0, data: b"abc".to_vec() }));
        let wire = proto::encode(&Frame::Sealed(SealedBody { frame_type: 0x12, counter: sealed.counter, ct: sealed.ct })).unwrap();
        let first = h.session.on_write(&wire).0;
        let second = h.session.on_write(&wire).0;
        assert_eq!(first.iter().filter(|a| matches!(a, Action::Emit(SessionEvent::Progress { .. }))).count(), 1);
        assert!(second.is_empty());
        let duplicate = send(&mut h, Frame::Chunk { file_index: 0, seq: 0, data: b"abc".to_vec() });
        assert!(duplicate.iter().any(|a| matches!(a, Action::Send(Frame::Sealed(SealedBody { frame_type: 0x13, .. })))));
        assert!(!duplicate.iter().any(|a| matches!(a, Action::Emit(SessionEvent::Progress { .. }))));
        h.sender.seal(b"discard one");
        h.sender.seal(b"discard two");
        let actions = send(&mut h, Frame::Chunk { file_index: 0, seq: 1, data: b"def".to_vec() });
        assert!(actions.iter().any(|a| matches!(a, Action::Emit(SessionEvent::Progress { received: 6, .. }))));
    }

    #[test]
    fn hash_mismatch_is_never_returned_as_a_file() {
        let mut h = harness();
        confirm(&mut h);
        let actions = send(&mut h, Frame::FileBegin(FileBegin { file_index: 0, name: "bad.traj".into(), size: 3, sha256: [0; 32] }));
        assert!(actions.iter().any(|a| matches!(a, Action::Emit(SessionEvent::FileRequest { .. }))));
        h.session.on_user_file(0, true);
        send(&mut h, Frame::Chunk { file_index: 0, seq: 0, data: b"abc".to_vec() });
        let actions = send(&mut h, Frame::FileEnd { file_index: 0 });
        assert!(actions.iter().any(|a| matches!(a, Action::Emit(SessionEvent::Failed { code: "ble-hash-mismatch", .. }))));
        send(&mut h, Frame::SessionComplete);
        assert!(h.session.take_files().is_empty());
    }

    #[test]
    fn oversized_and_overlong_file_metadata_are_refused() {
        let mut h = harness();
        confirm(&mut h);
        let actions = send(&mut h, Frame::FileBegin(FileBegin { file_index: 0, name: "big.traj".into(), size: 2 * 1024 * 1024 + 1, sha256: [0; 32] }));
        assert!(actions.iter().any(|a| matches!(a, Action::Send(Frame::Sealed(SealedBody { frame_type: 0x17, .. })))));

        let mut raw = vec![0x10, 154, 0, 0, 0, 111];
        raw.extend_from_slice(&vec![b'x'; 111]);
        raw.extend_from_slice(&[0; 40]);
        let (actions, att) = h.session.on_write(&raw);
        assert_eq!(att, AttResult::RequestNotSupported);
        assert!(!actions.iter().any(|a| matches!(a, Action::Emit(SessionEvent::FileRequest { .. }))));
    }

    #[test]
    fn timeouts_and_disconnect_have_explicit_terminal_states() {
        let clock = Arc::new(FakeClock(SharedTime(std::sync::Mutex::new(0))));
        let mut h = ReceiverSession::new(&mut OsRng, clock.clone(), "1", "r", ShareLimits { max_file_bytes: 100, max_files: 2 });
        clock.0.set(30_001);
        let actions = h.tick();
        assert!(actions.iter().any(|a| matches!(a, Action::Emit(SessionEvent::Failed { code: "ble-handshake-timeout", .. }))));
        assert!(actions.iter().any(|a| matches!(a, Action::Teardown)));

        let mut waiting = harness();
        waiting.clock.0.set(300_001);
        assert!(waiting.session.tick().iter().any(|a| matches!(a, Action::Emit(SessionEvent::Failed { code: "ble-timeout", .. }))));

        let mut connected = harness();
        confirm(&mut connected);
        let actions = connected.session.on_disconnect();
        assert!(actions.iter().any(|a| matches!(a, Action::Emit(SessionEvent::Disconnected))));
        assert!(actions.iter().any(|a| matches!(a, Action::Teardown)));
    }

    #[test]
    fn keepalive_and_sustained_activity_have_no_global_session_cap() {
        let mut h = harness();
        confirm(&mut h);
        h.clock.0.set(10_001);
        assert!(h.session.tick().iter().any(|a| matches!(a, Action::Send(Frame::Sealed(SealedBody { frame_type: 0x19, .. })))));
        for _ in 0..2_700 {
            h.clock.0.set(h.clock.0.get() + 1_000);
            let actions = h.session.tick();
            assert!(!actions.iter().any(|a| matches!(a, Action::Teardown)));
        }
    }

    #[test]
    fn keepalive_cadence_does_not_refresh_transfer_idle_timeout() {
        let mut h = harness();
        confirm(&mut h);
        offer(&mut h, 0, "a.traj", b"abcdef");
        h.session.on_user_file(0, true);
        h.clock.0.set(10_001);
        assert!(h.session.tick().iter().any(|a| matches!(a, Action::Send(Frame::Sealed(SealedBody { frame_type: 0x19, .. })))), "keepalive must still be sent while idle");
        h.clock.0.set(20_002);
        assert!(h.session.tick().iter().any(|a| matches!(a, Action::Send(Frame::Sealed(SealedBody { frame_type: 0x19, .. })))), "keepalive must still be sent while idle");
        h.clock.0.set(30_001);
        let actions = h.session.tick();
        assert!(actions.iter().any(|a| matches!(a, Action::Emit(SessionEvent::Failed { code: "ble-timeout", detail }) if detail == "file transfer timed out")));
        assert!(actions.iter().any(|a| matches!(a, Action::Teardown)));
    }

    #[test]
    fn keepalive_cadence_does_not_refresh_file_confirmation_timeout() {
        let mut h = harness();
        confirm(&mut h);
        offer(&mut h, 0, "a.traj", b"abc");
        for second in 1..=29u64 {
            h.clock.0.set(second * 10_000);
            let actions = h.session.tick();
            assert!(actions.iter().any(|a| matches!(a, Action::Send(Frame::Sealed(SealedBody { frame_type: 0x19, .. })))), "keepalive expected at {}s", second * 10);
            assert!(!actions.iter().any(|a| matches!(a, Action::Teardown)), "pending confirmation must not hit the transfer timeout at {}s", second * 10);
        }
        h.clock.0.set(300_000);
        let actions = h.session.tick();
        assert!(actions.iter().any(|a| matches!(a, Action::Emit(SessionEvent::Failed { code: "ble-timeout", detail }) if detail == "confirmation timed out")));
        assert!(actions.iter().any(|a| matches!(a, Action::Teardown)));
    }

    #[test]
    fn duplicate_file_begin_for_pending_file_is_idempotent() {
        let mut h = harness();
        confirm(&mut h);
        offer(&mut h, 0, "a.traj", b"abc");
        let actions = send(&mut h, Frame::FileBegin(FileBegin {
            file_index: 0,
            name: "a.traj".into(),
            size: 3,
            sha256: sha256(b"abc"),
        }));
        assert!(actions.is_empty(), "duplicate begin must not cancel the pending file: {actions:?}");
        h.session.on_user_file(0, true);
        let actions = send(&mut h, Frame::Chunk { file_index: 0, seq: 0, data: b"abc".to_vec() });
        assert!(actions.iter().any(|a| matches!(a, Action::Emit(SessionEvent::Progress { received: 3, .. }))));
        send(&mut h, Frame::FileEnd { file_index: 0 });
        let actions = send(&mut h, Frame::SessionComplete);
        assert!(actions.iter().any(|a| matches!(a, Action::Emit(SessionEvent::Done { ok_count: 1, fail_count: 0 }))));
        assert_eq!(h.session.take_files().len(), 1);
    }

    #[test]
    fn duplicate_file_begin_mid_transfer_preserves_progress() {
        let mut h = harness();
        confirm(&mut h);
        offer(&mut h, 0, "a.traj", b"abcdef");
        h.session.on_user_file(0, true);
        send(&mut h, Frame::Chunk { file_index: 0, seq: 0, data: b"abc".to_vec() });
        let actions = send(&mut h, Frame::FileBegin(FileBegin {
            file_index: 0,
            name: "a.traj".into(),
            size: 6,
            sha256: sha256(b"abcdef"),
        }));
        let frames = outgoing_frames(&mut h, &actions);
        assert_eq!(frames, vec![Frame::FileAccept { file_index: 0, accepted: true }]);
        let actions = send(&mut h, Frame::Chunk { file_index: 0, seq: 1, data: b"def".to_vec() });
        assert!(actions.iter().any(|a| matches!(a, Action::Emit(SessionEvent::Progress { received: 6, .. }))));
        send(&mut h, Frame::FileEnd { file_index: 0 });
        let actions = send(&mut h, Frame::SessionComplete);
        assert!(actions.iter().any(|a| matches!(a, Action::Emit(SessionEvent::Done { ok_count: 1, fail_count: 0 }))));
        assert_eq!(h.session.take_files().len(), 1);
    }

    #[test]
    fn conflicting_file_begin_fails_active_file_and_lets_session_complete() {
        let mut h = harness();
        confirm(&mut h);
        offer(&mut h, 0, "a.traj", b"abcdef");
        h.session.on_user_file(0, true);
        send(&mut h, Frame::Chunk { file_index: 0, seq: 0, data: b"abc".to_vec() });
        let actions = send(&mut h, Frame::FileBegin(FileBegin {
            file_index: 1,
            name: "b.traj".into(),
            size: 3,
            sha256: sha256(b"xyz"),
        }));
        let frames = outgoing_frames(&mut h, &actions);
        assert!(frames.iter().any(|f| matches!(f, Frame::FileCancel { file_index: 1, reason: 3 })));
        assert!(actions.iter().any(|a| matches!(a, Action::Emit(SessionEvent::Failed { code: "ble-protocol-error", .. }))));
        let actions = send(&mut h, Frame::SessionComplete);
        assert!(actions.iter().any(|a| matches!(a, Action::Emit(SessionEvent::Done { ok_count: 0, fail_count: 1 }))));
        assert!(h.session.take_files().is_empty(), "the half-received file must never be released");
    }

    #[test]
    fn conflicting_file_begin_while_pending_abandons_request_and_completes() {
        let mut h = harness();
        confirm(&mut h);
        offer(&mut h, 0, "a.traj", b"abc");
        let actions = send(&mut h, Frame::FileBegin(FileBegin {
            file_index: 7,
            name: "z.traj".into(),
            size: 1,
            sha256: [0; 32],
        }));
        assert!(actions.iter().any(|a| matches!(a, Action::Emit(SessionEvent::Failed { code: "ble-protocol-error", .. }))));
        assert!(h.session.on_user_file(0, true).is_empty(), "the abandoned request must no longer be decidable");
        let actions = send(&mut h, Frame::SessionComplete);
        assert!(actions.iter().any(|a| matches!(a, Action::Emit(SessionEvent::Done { ok_count: 0, fail_count: 1 }))));
    }
}
