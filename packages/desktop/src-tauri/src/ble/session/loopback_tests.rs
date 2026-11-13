// Loopback = two pure state machines wired in memory. No radio, no OS Bluetooth.
// These tests are not real-device results.
use super::receiver::ReceiverSession;
use super::sender::SenderSession;
use super::{Action, SessionEvent, ShareFile, ShareLimits};
use crate::ble::proto::{self, Frame};
use rand_core::OsRng;
use std::collections::VecDeque;
use std::sync::Arc;
use x25519_dalek::StaticSecret;

struct FakeClock(SharedTime);
struct SharedTime(std::sync::Mutex<u64>);
impl SharedTime {
    fn get(&self) -> u64 { *self.0.lock().unwrap() }
    fn set(&self, value: u64) { *self.0.lock().unwrap() = value; }
}
impl super::Clock for FakeClock { fn now_ms(&self) -> u64 { self.0.get() } }

#[derive(Clone, Copy)]
enum Direction { Send, Receive }

struct Pair {
    sender: SenderSession,
    receiver: ReceiverSession,
    queue: VecDeque<(Direction, Vec<u8>)>,
    clock: Arc<FakeClock>,
    sender_events: Vec<SessionEvent>,
    receiver_events: Vec<SessionEvent>,
    chunk_count: usize,
    drop_chunk: Option<usize>,
    dropped_counter: Option<u64>,
    replay_once: bool,
}

impl Pair {
    fn new(files: Vec<ShareFile>) -> Self {
        let clock = Arc::new(FakeClock(SharedTime(std::sync::Mutex::new(0))));
        let limits = ShareLimits { max_file_bytes: 2 * 1024 * 1024, max_files: 16 };
        let sender = SenderSession::new(&mut OsRng, clock.clone(), "1", "sender", limits, files).unwrap();
        let receiver = ReceiverSession::new(&mut OsRng, clock.clone(), "1", "receiver", limits);
        Self {
            sender,
            receiver,
            queue: VecDeque::new(),
            clock,
            sender_events: Vec::new(),
            receiver_events: Vec::new(),
            chunk_count: 0,
            drop_chunk: None,
            dropped_counter: None,
            replay_once: false,
        }
    }

    fn collect(&mut self, direction: Direction, actions: Vec<Action>) {
        for action in actions {
            match action {
                Action::Emit(event) => match direction {
                    Direction::Send => self.sender_events.push(event),
                    Direction::Receive => self.receiver_events.push(event),
                },
                Action::Teardown => {}
                Action::Send(frame) => {
                    if let Frame::Sealed(sealed) = &frame {
                        if sealed.frame_type == 0x12 {
                            self.chunk_count += 1;
                            if self.drop_chunk == Some(self.chunk_count) {
                                self.dropped_counter = Some(sealed.counter);
                                self.drop_chunk = None;
                                continue;
                            }
                        }
                    }
                    let bytes = proto::encode(&frame).unwrap();
                    self.queue.push_back((direction, bytes.clone()));
                    if self.replay_once && matches!(frame, Frame::Sealed(ref s) if s.frame_type == 0x12) {
                        self.queue.push_back((direction, bytes));
                        self.replay_once = false;
                    }
                }
            }
        }
    }

    fn pump_one(&mut self) {
        let Some((direction, bytes)) = self.queue.pop_front() else { return };
        let actions = match direction {
            Direction::Send => self.receiver.on_write(&bytes).0,
            Direction::Receive => self.sender.on_notify(&bytes),
        };
        let source = match direction {
            Direction::Send => Direction::Receive,
            Direction::Receive => Direction::Send,
        };
        self.collect(source, actions);
    }

    fn pump(&mut self) {
        for _ in 0..100_000 {
            if self.queue.is_empty() { return; }
            self.pump_one();
        }
        panic!("loopback transport did not settle");
    }

    fn connect_and_confirm(&mut self) {
        let hello = self.sender.on_connected();
        self.collect(Direction::Send, hello);
        self.pump();
        let sender_actions = self.sender.on_user_confirm(true);
        self.collect(Direction::Send, sender_actions);
        let receiver_actions = self.receiver.on_user_confirm(true);
        self.collect(Direction::Receive, receiver_actions);
        self.pump();
    }

    fn run_files(&mut self, reject: &[u16]) {
        for index in 0..3 {
            let decision = self.receiver.on_user_file(index, !reject.contains(&index));
            self.collect(Direction::Receive, decision);
            self.pump();
        }
    }
}

#[test]
fn multi_file_loopback_preserves_bytes_names_and_reject_counts() {
    let original = vec![vec![1; proto::MAX_CHUNK_DATA * 4], vec![2; 800], vec![3; 100]];
    let mut pair = Pair::new(original.iter().enumerate().map(|(i, bytes)| ShareFile {
        name: if i == 1 { "../route.traj".into() } else { format!("{i}.traj") },
        bytes: bytes.clone(),
    }).collect());
    pair.connect_and_confirm();
    pair.run_files(&[1]);
    assert!(pair.receiver_events.iter().any(|e| matches!(e, SessionEvent::Done { ok_count: 2, fail_count: 1 })), "sender={:?}\nreceiver={:?}\nqueue={}", pair.sender_events, pair.receiver_events, pair.queue.len());
    let files = pair.receiver.take_files();
    assert_eq!(files.len(), 2);
    assert_eq!(files[0].bytes, original[0]);
    assert_eq!(files[0].name, "0.traj");
    assert_eq!(files[1].bytes, original[2]);
    assert_eq!(files[1].name, "2.traj");
}

#[test]
fn dropped_chunk_is_retransmitted_with_a_fresh_counter() {
    let mut pair = Pair::new((0..3).map(|i| ShareFile { name: format!("{i}.traj"), bytes: vec![i as u8; 800] }).collect());
    pair.drop_chunk = Some(5);
    pair.connect_and_confirm();
    pair.run_files(&[]);
    let files = pair.receiver.take_files();
    assert_eq!(files.len(), 3);
    assert!(files.iter().all(|f| f.bytes.len() == 800));
    assert!(pair.dropped_counter.is_some());
}

#[test]
fn exact_replay_does_not_duplicate_progress_or_file_results() {
    let mut pair = Pair::new((0..3).map(|i| ShareFile { name: format!("{i}.traj"), bytes: vec![i as u8; 800] }).collect());
    pair.replay_once = true;
    pair.connect_and_confirm();
    pair.run_files(&[]);
    assert_eq!(pair.receiver.take_files().len(), 3);
    assert_eq!(pair.receiver_events.iter().filter(|e| matches!(e, SessionEvent::Progress { received: 145, .. })).count(), 3);
    assert_eq!(pair.receiver_events.iter().filter(|e| matches!(e, SessionEvent::FileVerified { ok: true, .. })).count(), 3);
}

#[test]
fn mitm_changes_the_code_seen_by_the_two_users() {
    let limits = ShareLimits { max_file_bytes: 100, max_files: 1 };
    let clock = Arc::new(FakeClock(SharedTime(std::sync::Mutex::new(0))));
    let mut sender = SenderSession::new(&mut OsRng, clock.clone(), "1", "sender", limits, vec![]).unwrap();
    let mut receiver = ReceiverSession::new(&mut OsRng, clock, "1", "receiver", limits);
    let hello = sender.on_connected().into_iter().find_map(|a| match a {
        Action::Send(Frame::Hello(body)) => Some(body),
        _ => None,
    }).unwrap();
    let attacker = StaticSecret::from([99; 32]);
    let mut intercepted = hello.clone();
    intercepted.ecdh_pub = x25519_dalek::PublicKey::from(&attacker).to_bytes();
    intercepted.instance_id = [77; 8];
    let receiver_actions = receiver.on_write(&proto::encode(&Frame::Hello(intercepted)).unwrap()).0;
    let mut ack = receiver_actions.iter().find_map(|a| match a {
        Action::Send(Frame::HelloAck(body)) => Some(body.clone()),
        _ => None,
    }).unwrap();
    let receiver_code = receiver_actions.iter().find_map(|a| match a {
        Action::Emit(SessionEvent::SasCode(code)) => Some(code.clone()),
        _ => None,
    }).unwrap();
    ack.ecdh_pub = x25519_dalek::PublicKey::from(&attacker).to_bytes();
    ack.instance_id = [77; 8];
    let sender_code = sender.on_hello_ack(ack).into_iter().find_map(|a| match a {
        Action::Emit(SessionEvent::SasCode(code)) => Some(code),
        _ => None,
    }).unwrap();
    assert_ne!(sender_code, receiver_code);
}

#[test]
fn disconnect_clears_pending_actions() {
    let mut pair = Pair::new(vec![ShareFile { name: "a.traj".into(), bytes: vec![1] }]);
    pair.connect_and_confirm();
    pair.queue.clear();
    let sender = pair.sender.on_disconnect();
    let receiver = pair.receiver.on_disconnect();
    assert!(sender.iter().any(|a| matches!(a, Action::Teardown)));
    assert!(receiver.iter().any(|a| matches!(a, Action::Teardown)));
    assert!(!sender.iter().any(|a| matches!(a, Action::Send(_))));
    assert!(!receiver.iter().any(|a| matches!(a, Action::Send(_))));
    assert!(pair.queue.is_empty());
}

#[test]
fn slow_active_loopback_has_no_global_session_cap() {
    let bytes = vec![9; proto::MAX_CHUNK_DATA * 1_000];
    let mut pair = Pair::new(vec![ShareFile { name: "slow.traj".into(), bytes: bytes.clone() }]);
    pair.connect_and_confirm();
    let accepted = pair.receiver.on_user_file(0, true);
    pair.collect(Direction::Receive, accepted);
    for _ in 0..2_700 {
        pair.clock.0.set(pair.clock.0.get() + 1_000);
        let sender_ticks = pair.sender.tick();
        pair.collect(Direction::Send, sender_ticks);
        let receiver_ticks = pair.receiver.tick();
        pair.collect(Direction::Receive, receiver_ticks);
        pair.pump_one();
    }
    let files = pair.receiver.take_files();
    assert_eq!(files.len(), 1, "queue={} sender={:?} receiver={:?}", pair.queue.len(), pair.sender_events, pair.receiver_events);
    assert_eq!(files[0].bytes, bytes);
}
