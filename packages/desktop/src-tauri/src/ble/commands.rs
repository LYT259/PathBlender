use super::central::{BtleplugRadio, CentralRadio, GattLink};
use super::peripheral::{BleRadioError, PeripheralRadio};
use super::session::receiver::ReceiverSession;
use super::session::sender::SenderSession;
use super::session::{Action, Clock, SessionEvent, ShareFile, ShareLimits, UserCommand};
use rand_core::OsRng;
use std::collections::BTreeMap;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;
use tauri::ipc::Channel;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BleCapabilities {
    pub platform_supported: bool,
    pub central_powered: Option<bool>,
    pub peripheral_powered: Option<bool>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlePeer {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum BleEvent {
    Discovered { devices: Vec<BlePeer> },
    Hello { peer_label: String, peer_version: String },
    SasCode { code: String },
    ConfirmPending,
    Confirmed,
    FileRequest { file_index: u16, name: String, size: u64 },
    FileResult { file_index: u16, accepted: bool },
    Progress { file_index: u16, sent: u64, total: u64 },
    FileVerified { file_index: u16, ok: bool },
    Done { ok_count: usize, fail_count: usize },
    Failed { code: String, detail: String },
    Cancelled,
    Disconnected,
    Capabilities { caps: BleCapabilities },
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareFileArg {
    pub name: String,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceivedFile {
    pub name: String,
    pub data: Vec<u8>,
}

struct ActiveSession {
    id: u64,
    controls: tokio::sync::mpsc::Sender<UserCommand>,
}

#[derive(Debug)]
pub(crate) struct StartedSession {
    id: u64,
    controls: tokio::sync::mpsc::Receiver<UserCommand>,
}

#[derive(Default)]
pub struct SessionManager {
    active: Option<ActiveSession>,
    received: Vec<ReceivedFile>,
    next_id: u64,
}

impl SessionManager {
    pub fn begin(&mut self) -> Result<StartedSession, &'static str> {
        if self.active.is_some() {
            return Err("ble-busy");
        }
        self.next_id += 1;
        let (sender, controls) = tokio::sync::mpsc::channel(32);
        let id = self.next_id;
        self.active = Some(ActiveSession { id, controls: sender });
        self.received.clear();
        Ok(StartedSession { id, controls })
    }

    fn finish(&mut self, id: u64, files: Vec<ReceivedFile>) {
        if self.active.as_ref().is_some_and(|active| active.id == id) {
            self.active = None;
            self.received = files;
        }
    }

    fn send(&self, command: UserCommand) -> Result<(), String> {
        let active = self.active.as_ref().ok_or("ble-cancelled")?;
        active.controls.try_send(command).map_err(|_| "ble-busy".to_string())
    }

    fn cancel(&mut self) {
        if let Some(active) = self.active.take() {
            let _ = active.controls.try_send(UserCommand::Cancel);
        }
        self.received.clear();
    }

    fn take_received(&mut self) -> Vec<ReceivedFile> {
        std::mem::take(&mut self.received)
    }
}

fn manager() -> &'static Mutex<SessionManager> {
    static MANAGER: OnceLock<Mutex<SessionManager>> = OnceLock::new();
    MANAGER.get_or_init(|| Mutex::new(SessionManager::default()))
}

/// Holds the terminal Done event back until received files are stored in the
/// SessionManager, so `ble_take_received_files` can never race the web's
/// Done handler and return an empty list.
#[derive(Default)]
struct DoneGate {
    pending: Option<BleEvent>,
}

impl DoneGate {
    fn capture(&mut self, event: SessionEvent) -> Option<BleEvent> {
        if matches!(event, SessionEvent::Done { .. }) {
            self.pending = Some(map_event(event));
            return None;
        }
        Some(map_event(event))
    }

    fn flush(&mut self, manager: &mut SessionManager, id: u64, files: Vec<ReceivedFile>) -> Option<BleEvent> {
        manager.finish(id, files);
        self.pending.take()
    }
}

struct SystemClock(Instant);
impl Default for SystemClock {
    fn default() -> Self {
        Self(Instant::now())
    }
}
impl Clock for SystemClock {
    fn now_ms(&self) -> u64 {
        self.0.elapsed().as_millis() as u64
    }
}

pub const PLATFORM_SUPPORTED: bool = cfg!(any(target_os = "macos", target_os = "windows"));

fn capabilities_on_unsupported() -> BleCapabilities {
    BleCapabilities {
        platform_supported: false,
        central_powered: None,
        peripheral_powered: None,
    }
}

fn unsupported<T>() -> Result<T, String> {
    Err("ble-unsupported-platform".into())
}

#[tauri::command]
pub async fn ble_capabilities() -> Result<BleCapabilities, String> {
    if !PLATFORM_SUPPORTED {
        return Ok(capabilities_on_unsupported());
    }
    let central_powered = match BtleplugRadio::new().await {
        Ok(radio) => radio.adapter_powered().await.ok().flatten(),
        Err(_) => None,
    };
    let peripheral_powered = match PeripheralRadio::new().await {
        Ok(mut radio) => radio.power_state().await.ok(),
        Err(_) => None,
    };
    Ok(BleCapabilities { platform_supported: true, central_powered, peripheral_powered })
}

#[tauri::command]
pub async fn ble_start_scan(on_event: Channel<BleEvent>) -> Result<(), String> {
    if !PLATFORM_SUPPORTED {
        return unsupported();
    }
    let started = manager().lock().unwrap().begin().map_err(str::to_string)?;
    let id = started.id;
    let mut controls = started.controls;
    let mut radio = match BtleplugRadio::new().await {
        Ok(radio) => radio,
        Err(error) => {
            manager().lock().unwrap().finish(id, Vec::new());
            return Err(error.to_string());
        }
    };
    tauri::async_runtime::spawn(async move {
        let peers = std::sync::Arc::new(Mutex::new(BTreeMap::<String, BlePeer>::new()));
        let callback_peers = peers.clone();
        let callback_channel = on_event.clone();
        if let Err(error) = radio.scan(Box::new(move |peer| {
            let mut peers = callback_peers.lock().unwrap();
            peers.insert(peer.id.clone(), BlePeer { id: peer.id, label: peer.label });
            let _ = callback_channel.send(BleEvent::Discovered {
                devices: peers.values().cloned().collect(),
            });
        })).await {
            emit_radio_error(&on_event, &error);
        } else {
            while let Some(command) = controls.recv().await {
                if matches!(command, UserCommand::Cancel) {
                    break;
                }
            }
        }
        let _ = radio.stop_scan().await;
        manager().lock().unwrap().finish(id, Vec::new());
    });
    Ok(())
}

#[tauri::command]
pub async fn ble_stop_scan() -> Result<(), String> {
    manager().lock().unwrap().cancel();
    Ok(())
}

#[tauri::command]
pub async fn ble_send_files(
    device_id: String,
    files: Vec<ShareFileArg>,
    on_event: Channel<BleEvent>,
) -> Result<(), String> {
    if !PLATFORM_SUPPORTED {
        return unsupported();
    }
    let started = manager().lock().unwrap().begin().map_err(str::to_string)?;
    let id = started.id;
    let mut controls = started.controls;
    let mut radio = match BtleplugRadio::new().await {
        Ok(radio) => radio,
        Err(error) => {
            manager().lock().unwrap().finish(id, Vec::new());
            return Err(error.to_string());
        }
    };
    let files = files.into_iter().map(|file| ShareFile { name: file.name, bytes: file.data }).collect();
    let mut session = match SenderSession::new(
        &mut OsRng,
        std::sync::Arc::new(SystemClock::default()),
        env!("CARGO_PKG_VERSION"),
        "PathBlender",
        ShareLimits { max_file_bytes: 2 * 1024 * 1024, max_files: 16 },
        files,
    ) {
        Ok(session) => session,
        Err(error) => {
            manager().lock().unwrap().finish(id, Vec::new());
            return Err(error);
        }
    };
    tauri::async_runtime::spawn(async move {
        let result = async {
            let mut link = radio.connect(&device_id).await?;
            let actions = session.on_connected();
            if execute_sender_actions(&mut session, actions, &mut link, &on_event).await? {
                return Ok(());
            }
            loop {
                let actions = tokio::select! {
                    command = controls.recv() => match command {
                        Some(UserCommand::Confirm(accepted)) => session.on_user_confirm(accepted),
                        Some(UserCommand::Cancel) | None => session.on_user_cancel(),
                        Some(UserCommand::File { .. }) => Vec::new(),
                    },
                    notification = link.next_notification() => match notification {
                        Ok(Some(bytes)) => session.on_notify(&bytes),
                        Ok(None) => session.on_disconnect(),
                        Err(error) => return Err(error),
                    },
                    _ = tokio::time::sleep(std::time::Duration::from_millis(100)) => session.tick(),
                };
                if execute_sender_actions(&mut session, actions, &mut link, &on_event).await? {
                    break;
                }
            }
            link.close().await
        }.await;
        if let Err(error) = result {
            emit_radio_error(&on_event, &error);
        }
        let _ = radio.disconnect_all().await;
        manager().lock().unwrap().finish(id, Vec::new());
    });
    Ok(())
}

/// Retires a finished receiver session. Advertising must stop while the
/// session still owns the manager slot: `finish` releases the slot, and once
/// a new session has begun, this task's late `stop_advertising` on the shared
/// backend would silently kill the new session's advertising. `Done` is only
/// emitted after the received files are persisted.
async fn retire_receiver_session(
    stop_advertising: impl std::future::Future<Output = ()>,
    manager: &Mutex<SessionManager>,
    gate: &Mutex<DoneGate>,
    on_event: &Channel<BleEvent>,
    id: u64,
    files: Vec<ReceivedFile>,
    result: Result<(), BleRadioError>,
) {
    let _ = stop_advertising.await;
    {
        let mut manager = manager.lock().unwrap();
        if let Some(done) = gate.lock().unwrap().flush(&mut manager, id, files) {
            let _ = on_event.send(done);
        }
    }
    if let Err(error) = result {
        emit_radio_error(on_event, &error);
    }
}

#[tauri::command]
pub async fn ble_start_receiver(on_event: Channel<BleEvent>) -> Result<(), String> {
    if !PLATFORM_SUPPORTED {
        return unsupported();
    }
    let started = manager().lock().unwrap().begin().map_err(str::to_string)?;
    let id = started.id;
    let mut controls = started.controls;
    let mut radio = match PeripheralRadio::new().await {
        Ok(radio) => radio,
        Err(error) => {
            manager().lock().unwrap().finish(id, Vec::new());
            return Err(error.to_string());
        }
    };
    if let Err(error) = radio.start().await {
        manager().lock().unwrap().finish(id, Vec::new());
        return Err(error.to_string());
    }
    tauri::async_runtime::spawn(async move {
        let mut session = ReceiverSession::new(
            &mut OsRng,
            std::sync::Arc::new(SystemClock::default()),
            env!("CARGO_PKG_VERSION"),
            "PathBlender",
            ShareLimits { max_file_bytes: 2 * 1024 * 1024, max_files: 16 },
        );
        let done_gate = std::sync::Arc::new(Mutex::new(DoneGate::default()));
        let gate_for_events = done_gate.clone();
        let channel_for_run = on_event.clone();
        let result = radio.run(&mut session, &mut controls, move |event| {
            if let Some(event) = gate_for_events.lock().unwrap().capture(event) {
                let _ = channel_for_run.send(event);
            }
        }).await;
        let files = session.take_files().into_iter().map(|file| ReceivedFile {
            name: file.name,
            data: file.bytes,
        }).collect();
        retire_receiver_session(
            async {
                let _ = radio.stop().await;
            },
            manager(),
            &done_gate,
            &on_event,
            id,
            files,
            result,
        )
        .await;
    });
    Ok(())
}

#[tauri::command]
pub async fn ble_confirm_session(accepted: bool) -> Result<(), String> {
    manager().lock().unwrap().send(UserCommand::Confirm(accepted))
}

#[tauri::command]
pub async fn ble_respond_file(file_index: u16, accepted: bool) -> Result<(), String> {
    manager().lock().unwrap().send(UserCommand::File { file_index, accepted })
}

#[tauri::command]
pub async fn ble_take_received_files() -> Result<Vec<ReceivedFile>, String> {
    Ok(manager().lock().unwrap().take_received())
}

#[tauri::command]
pub async fn ble_cancel() -> Result<(), String> {
    manager().lock().unwrap().cancel();
    Ok(())
}

fn map_event(event: SessionEvent) -> BleEvent {
    match event {
        SessionEvent::PoweredOn | SessionEvent::PoweredOff => BleEvent::Capabilities {
            caps: BleCapabilities {
                platform_supported: true,
                central_powered: None,
                peripheral_powered: Some(matches!(event, SessionEvent::PoweredOn)),
            },
        },
        SessionEvent::SasCode(code) => BleEvent::SasCode { code },
        SessionEvent::ConfirmPending { peer_label, peer_version } => BleEvent::Hello {
            peer_label,
            peer_version,
        },
        SessionEvent::Confirmed => BleEvent::Confirmed,
        SessionEvent::FileRequest { file_index, name, size } => BleEvent::FileRequest { file_index, name, size },
        SessionEvent::FileResult { file_index, accepted } => BleEvent::FileResult { file_index, accepted },
        SessionEvent::Progress { file_index, received, total } => BleEvent::Progress {
            file_index,
            sent: received,
            total,
        },
        SessionEvent::FileVerified { file_index, ok } => BleEvent::FileVerified { file_index, ok },
        SessionEvent::Done { ok_count, fail_count } => BleEvent::Done { ok_count, fail_count },
        SessionEvent::Failed { code, detail } => BleEvent::Failed { code: code.into(), detail },
        SessionEvent::Cancelled => BleEvent::Cancelled,
        SessionEvent::Disconnected => BleEvent::Disconnected,
    }
}

async fn execute_sender_actions(
    session: &mut SenderSession,
    actions: Vec<Action>,
    link: &mut Box<dyn GattLink>,
    on_event: &Channel<BleEvent>,
) -> Result<bool, BleRadioError> {
    let mut actions = actions;
    loop {
        let mut teardown = false;
        let mut rejected: Option<u8> = None;
        for action in std::mem::take(&mut actions) {
            match action {
                Action::Send(frame) => {
                    if rejected.is_some() {
                        // The frame was lost; later sends in this list must not
                        // reach the peer ahead of the lost frame's retry.
                        continue;
                    }
                    let bytes = super::proto::encode(&frame)
                        .map_err(|error| BleRadioError { code: "ble-protocol-error", detail: format!("{error:?}") })?;
                    match link.write(&bytes).await {
                        Ok(()) => {
                            if let Some(event) = session.on_write_delivered(bytes[0]) {
                                let _ = on_event.send(map_event(event));
                            }
                        }
                        Err(error) if error.code == super::central::WRITE_REJECTED_CODE => {
                            rejected = Some(bytes[0]);
                        }
                        Err(error) => return Err(error),
                    }
                }
                Action::Emit(event) => {
                    let _ = on_event.send(map_event(event));
                }
                Action::Teardown => teardown = true,
            }
        }
        if let Some(frame_type) = rejected {
            let retry = session.on_write_rejected(frame_type);
            if !retry.is_empty() {
                // Recovery outranks the rejected list's own Teardown flag; the
                // retry list carries its own terminal actions.
                actions = retry;
                continue;
            }
        }
        return Ok(teardown);
    }
}

fn emit_radio_error(on_event: &Channel<BleEvent>, error: &BleRadioError) {
    let _ = on_event.send(BleEvent::Failed {
        code: error.code.into(),
        detail: error.detail.clone(),
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ble::crypto::{derive_session_keys, DirCrypto};
    use crate::ble::proto::{self, Frame, HelloBody, SealedBody};
    use crate::ble::session::{Action, SessionEvent, ShareFile};
    use async_trait::async_trait;
    use std::sync::Arc;

    struct ScriptedLink {
        error_code: &'static str,
        error_detail: &'static str,
        rejections_remaining: usize,
        attempts: Arc<Mutex<usize>>,
        delivered: Arc<Mutex<Vec<Vec<u8>>>>,
    }

    impl ScriptedLink {
        fn rejecting(
            rejections: usize,
        ) -> (Box<dyn GattLink>, Arc<Mutex<usize>>, Arc<Mutex<Vec<Vec<u8>>>>) {
            let attempts = Arc::new(Mutex::new(0));
            let delivered = Arc::new(Mutex::new(Vec::new()));
            let link = ScriptedLink {
                error_code: "ble-write-rejected",
                error_detail: "att request not supported",
                rejections_remaining: rejections,
                attempts: attempts.clone(),
                delivered: delivered.clone(),
            };
            (Box::new(link), attempts, delivered)
        }
    }

    #[async_trait]
    impl GattLink for ScriptedLink {
        async fn write(&mut self, bytes: &[u8]) -> Result<(), BleRadioError> {
            *self.attempts.lock().unwrap() += 1;
            if self.rejections_remaining > 0 {
                self.rejections_remaining -= 1;
                return Err(BleRadioError { code: self.error_code, detail: self.error_detail.into() });
            }
            self.delivered.lock().unwrap().push(bytes.to_vec());
            Ok(())
        }
        async fn next_notification(&mut self) -> Result<Option<Vec<u8>>, BleRadioError> {
            Ok(None)
        }
        async fn close(&mut self) -> Result<(), BleRadioError> {
            Ok(())
        }
    }

    fn event_channel() -> (Channel<BleEvent>, Arc<Mutex<Vec<serde_json::Value>>>) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let sink = seen.clone();
        let channel = Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(json) = body {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&json) {
                    sink.lock().unwrap().push(value);
                }
            }
            Ok(())
        });
        (channel, seen)
    }

    fn test_sender() -> SenderSession {
        SenderSession::new(
            &mut OsRng,
            Arc::new(SystemClock::default()),
            "0.1.10",
            "sender",
            ShareLimits { max_file_bytes: 2 * 1024 * 1024, max_files: 16 },
            vec![],
        ).unwrap()
    }

    /// A real sender session against a synthetic peer: hands the session a
    /// HelloAck plus sealed receiver-side frames, and can unseal what the
    /// session wrote so tests can assert on delivered payloads.
    struct SenderHarness {
        session: SenderSession,
        receiver_to_sender: DirCrypto,
        sender_to_receiver: DirCrypto,
    }

    impl SenderHarness {
        fn new(files: Vec<ShareFile>) -> Self {
            let mut session = SenderSession::new(
                &mut OsRng,
                Arc::new(SystemClock::default()),
                "0.1.10",
                "sender",
                ShareLimits { max_file_bytes: 2 * 1024 * 1024, max_files: 16 },
                files,
            ).unwrap();
            let hello = session.on_connected().into_iter().find_map(|action| match action {
                Action::Send(Frame::Hello(body)) => Some(body),
                _ => None,
            }).unwrap();
            let secret = x25519_dalek::StaticSecret::from([31; 32]);
            let instance = [41; 8];
            let keys = derive_session_keys(
                &secret,
                &instance,
                &x25519_dalek::PublicKey::from(hello.ecdh_pub),
                &hello.instance_id,
            ).unwrap();
            let acknowledgement = Frame::HelloAck(HelloBody {
                proto_ver: 1,
                max_frame: 180,
                instance_id: instance,
                ecdh_pub: x25519_dalek::PublicKey::from(&secret).to_bytes(),
                app_ver: "0.1.10".into(),
                label: "receiver".into(),
            });
            session.on_notify(&proto::encode(&acknowledgement).unwrap());
            Self {
                session,
                receiver_to_sender: DirCrypto::new(keys.key_r2s, 2, keys.session_id),
                sender_to_receiver: DirCrypto::new(keys.key_s2r, 1, keys.session_id),
            }
        }

        fn receive(&mut self, frame: Frame) -> Vec<Action> {
            let frame_type = proto::encode_encrypted_body(&frame)[0];
            let sealed = self.receiver_to_sender.seal(&proto::encode_payload(&frame));
            let bytes = proto::encode(&Frame::Sealed(SealedBody {
                frame_type,
                counter: sealed.counter,
                ct: sealed.ct,
            })).unwrap();
            self.session.on_notify(&bytes)
        }

        fn open_delivered(&mut self, bytes: &[u8]) -> Frame {
            let sealed = match proto::decode(bytes).unwrap() {
                Frame::Sealed(sealed) => sealed,
                _ => panic!("expected a sealed frame"),
            };
            let body = self.sender_to_receiver.open(&crate::ble::crypto::SealedFrame {
                counter: sealed.counter,
                ct: sealed.ct,
            }).unwrap();
            proto::decode_encrypted_body(sealed.frame_type, &body).unwrap()
        }

        /// The peer confirmed first, so our user confirm shares one action
        /// list with the first FILE_BEGIN.
        fn raced_confirm(&mut self) -> Vec<Action> {
            self.receive(Frame::Confirm { accepted: true });
            self.session.on_user_confirm(true)
        }

        /// Drives a single empty file through accept and verification to the
        /// session-complete action list.
        fn run_to_complete(&mut self) -> Vec<Action> {
            self.receive(Frame::Confirm { accepted: true });
            self.session.on_user_confirm(true);
            self.receive(Frame::FileAccept { file_index: 0, accepted: true });
            self.receive(Frame::FileDone { file_index: 0, ok: true })
        }
    }

    fn counter_at(bytes: &[u8]) -> u64 {
        u64::from_le_bytes(bytes[3..11].try_into().unwrap())
    }

    #[tokio::test]
    async fn rejected_confirm_does_not_let_file_begin_leapfrog() {
        let (channel, _seen) = event_channel();
        let (mut link, _attempts, delivered) = ScriptedLink::rejecting(1);
        let mut harness = SenderHarness::new(vec![ShareFile { name: "a.traj".into(), bytes: vec![7; 300] }]);
        let actions = harness.raced_confirm();
        let teardown = execute_sender_actions(&mut harness.session, actions, &mut link, &channel)
            .await
            .expect("a recoverable ATT rejection must not kill the session");
        assert!(!teardown);
        let delivered = delivered.lock().unwrap();
        // confirm = 0x04, file begin = 0x10 per the protocol frame table
        let types: Vec<u8> = delivered.iter().map(|bytes| bytes[0]).collect();
        assert_eq!(types, vec![0x04, 0x10], "no file begin may reach the peer ahead of the retried confirm: {delivered:?}");
        assert!(counter_at(&delivered[1]) > counter_at(&delivered[0]), "the retry must be re-sealed with a fresh counter");
        assert!(matches!(harness.open_delivered(&delivered[0]), Frame::Confirm { accepted: true }));
        assert!(matches!(harness.open_delivered(&delivered[1]), Frame::FileBegin(file) if file.file_index == 0));
    }

    #[tokio::test]
    async fn session_complete_write_is_retried_before_done_is_emitted() {
        let (channel, seen) = event_channel();
        let (mut link, attempts, delivered) = ScriptedLink::rejecting(1);
        let mut harness = SenderHarness::new(vec![ShareFile { name: "a.traj".into(), bytes: vec![] }]);
        let actions = harness.run_to_complete();
        let teardown = execute_sender_actions(&mut harness.session, actions, &mut link, &channel)
            .await
            .expect("a recoverable ATT rejection must not kill the session");
        assert!(teardown);
        let delivered = delivered.lock().unwrap();
        // session complete = 0x1a per the protocol frame table
        assert_eq!(
            delivered.iter().map(|bytes| bytes[0]).collect::<Vec<_>>(),
            vec![0x1a],
            "the completion frame must land via its bounded retry: {delivered:?}"
        );
        drop(delivered);
        assert_eq!(*attempts.lock().unwrap(), 2);
        assert_eq!(seen.lock().unwrap().iter().filter(|value| value["kind"] == "done").count(), 1);
    }

    #[tokio::test]
    async fn session_complete_exhaustion_fails_without_emitting_done() {
        let (channel, seen) = event_channel();
        let (mut link, attempts, delivered) = ScriptedLink::rejecting(32);
        let mut harness = SenderHarness::new(vec![ShareFile { name: "a.traj".into(), bytes: vec![] }]);
        let actions = harness.run_to_complete();
        let teardown = execute_sender_actions(&mut harness.session, actions, &mut link, &channel)
            .await
            .expect("exhausted retries fail the session, not the radio loop");
        assert!(teardown);
        assert!(
            seen.lock().unwrap().iter().all(|value| value["kind"] != "done"),
            "a completion that never lands must not report success: {:?}",
            seen.lock().unwrap()
        );
        assert!(seen.lock().unwrap().iter().any(|value| value["kind"] == "failed"));
        assert!(delivered.lock().unwrap().is_empty());
        // 1 initial write + 5 bounded retries + 1 best-effort session cancel
        assert_eq!(*attempts.lock().unwrap(), 7);
    }

    #[tokio::test]
    async fn transient_write_rejection_is_retried_instead_of_tearing_down() {
        let (channel, _seen) = event_channel();
        let (mut link, _attempts, delivered) = ScriptedLink::rejecting(1);
        let mut session = test_sender();
        let actions = session.on_connected();
        let teardown = execute_sender_actions(&mut session, actions, &mut link, &channel)
            .await
            .expect("a recoverable ATT rejection must not kill the session");
        assert!(!teardown);
        let delivered = delivered.lock().unwrap();
        assert_eq!(delivered.len(), 1, "hello must still be delivered after the retry");
        assert_eq!(delivered[0][0], 0x01);
    }

    #[tokio::test]
    async fn fatal_write_failure_still_fails_the_session() {
        let (channel, _seen) = event_channel();
        let (mut link, _attempts, _delivered) = fatal_link();
        let mut session = test_sender();
        let actions = session.on_connected();
        let result = execute_sender_actions(&mut session, actions, &mut link, &channel).await;
        assert_eq!(result.unwrap_err().code, "ble-disconnected");
    }

    fn fatal_link() -> (Box<dyn GattLink>, Arc<Mutex<usize>>, Arc<Mutex<Vec<Vec<u8>>>>) {
        let attempts = Arc::new(Mutex::new(0));
        let delivered = Arc::new(Mutex::new(Vec::new()));
        let link = ScriptedLink {
            error_code: "ble-disconnected",
            error_detail: "peer went away",
            rejections_remaining: 9,
            attempts: attempts.clone(),
            delivered: delivered.clone(),
        };
        (Box::new(link), attempts, delivered)
    }

    #[tokio::test]
    async fn rejected_send_keeps_followup_events_and_teardown() {
        let (channel, seen) = event_channel();
        let (mut link, _attempts, _delivered) = ScriptedLink::rejecting(5);
        let mut session = test_sender();
        let teardown = execute_sender_actions(
            &mut session,
            vec![
                Action::Send(Frame::Keepalive),
                Action::Emit(SessionEvent::Done { ok_count: 1, fail_count: 0 }),
                Action::Teardown,
            ],
            &mut link,
            &channel,
        )
        .await
        .expect("a rejected frame is a lost frame, not a dead session");
        assert!(teardown);
        assert!(seen.lock().unwrap().iter().any(|value| value["kind"] == "done"));
    }

    #[tokio::test]
    async fn receiver_tail_stops_advertising_before_releasing_the_session_slot() {
        let manager_cell = Mutex::new(SessionManager::default());
        let started = manager_cell.lock().unwrap().begin().unwrap();
        let mut gate = DoneGate::default();
        assert!(
            gate.capture(SessionEvent::Done { ok_count: 1, fail_count: 0 }).is_none(),
            "Done must stay captured while the session is being retired"
        );
        let gate = Mutex::new(gate);

        let order = Arc::new(Mutex::new(Vec::<&'static str>::new()));
        let stop_order = order.clone();
        let seen = Arc::new(Mutex::new(Vec::<serde_json::Value>::new()));
        let order_for_events = order.clone();
        let seen_for_events = seen.clone();
        let channel = Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(json) = body {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&json) {
                    if value["kind"] == "done" {
                        order_for_events.lock().unwrap().push("done_event");
                    }
                    if value["kind"] == "failed" {
                        order_for_events.lock().unwrap().push("failed_event");
                    }
                    seen_for_events.lock().unwrap().push(value);
                }
            }
            Ok(())
        });

        let manager_for_stop = &manager_cell;
        let stop = async move {
            stop_order.lock().unwrap().push("stop_advertising");
            match manager_for_stop.lock().unwrap().begin() {
                Ok(_) => panic!(
                    "a new receiver session must not be able to begin while the old session's stop_advertising is still in flight"
                ),
                Err(code) => assert_eq!(code, "ble-busy"),
            }
        };

        retire_receiver_session(
            stop,
            &manager_cell,
            &gate,
            &channel,
            started.id,
            vec![ReceivedFile { name: "a.traj".into(), data: vec![1, 2, 3] }],
            Err(BleRadioError {
                code: "ble-peripheral-unavailable",
                detail: "hub failed after Done".into(),
            }),
        )
        .await;

        assert_eq!(
            *order.lock().unwrap(),
            vec!["stop_advertising", "done_event", "failed_event"],
            "advertising must stop while the slot is held; Done must still precede the failure event",
        );
        assert_eq!(
            manager_cell.lock().unwrap().take_received().len(),
            1,
            "Done is only emitted after the files are persisted"
        );
        assert!(
            manager_cell.lock().unwrap().begin().is_ok(),
            "the tail must end with the session slot released"
        );
    }

    #[test]
    fn receiver_done_event_is_gated_until_files_are_persisted() {
        let mut manager = SessionManager::default();
        let started = manager.begin().unwrap();
        let mut gate = DoneGate::default();
        assert!(
            gate.capture(SessionEvent::Done { ok_count: 1, fail_count: 0 }).is_none(),
            "Done must not reach the web while radio.run still owns the session"
        );
        assert!(gate.capture(SessionEvent::FileVerified { file_index: 0, ok: true }).is_some());
        assert!(manager.take_received().is_empty());

        let done = gate.flush(
            &mut manager,
            started.id,
            vec![ReceivedFile { name: "a.traj".into(), data: vec![1, 2, 3] }],
        );
        assert!(matches!(done, Some(BleEvent::Done { .. })));
        assert!(
            !manager.take_received().is_empty(),
            "Done is only handed out after the files are stored"
        );

        let next = manager.begin().unwrap();
        manager.finish(started.id, vec![ReceivedFile { name: "stale.traj".into(), data: vec![9] }]);
        assert!(manager.take_received().is_empty(), "a stale session id must not touch the active slot");
        manager.finish(next.id, vec![ReceivedFile { name: "b.traj".into(), data: vec![4] }]);
        assert_eq!(manager.take_received().len(), 1);
    }

    #[test]
    fn info_plist_declares_bluetooth_usage() {
        assert!(include_str!("../../Info.plist").contains("NSBluetoothAlwaysUsageDescription"));
    }

    #[test]
    fn event_mapping_uses_internally_tagged_camel_case_json() {
        let event = map_event(SessionEvent::FileRequest {
            file_index: 3,
            name: "a.traj".into(),
            size: 42,
        });
        assert_eq!(serde_json::to_value(event).unwrap(), serde_json::json!({
            "kind": "fileRequest",
            "fileIndex": 3,
            "name": "a.traj",
            "size": 42,
        }));
        let event = map_event(SessionEvent::Done { ok_count: 2, fail_count: 1 });
        assert_eq!(serde_json::to_value(event).unwrap(), serde_json::json!({
            "kind": "done",
            "okCount": 2,
            "failCount": 1,
        }));
    }

    #[test]
    fn manager_enforces_one_session_and_takes_received_files_once() {
        let mut manager = SessionManager::default();
        let _first = manager.begin().unwrap();
        assert_eq!(manager.begin().unwrap_err(), "ble-busy");
        manager.cancel();
        let second = manager.begin().unwrap();
        manager.finish(second.id, vec![ReceivedFile { name: "a.traj".into(), data: vec![1, 2] }]);
        assert_eq!(manager.take_received().len(), 1);
        assert!(manager.take_received().is_empty());
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    #[tokio::test]
    async fn unsupported_platform_capabilities_are_explicit() {
        let capabilities = ble_capabilities().await.unwrap();
        assert!(!capabilities.platform_supported);
        assert!(capabilities.central_powered.is_none());
        assert!(capabilities.peripheral_powered.is_none());
    }
}
