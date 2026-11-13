use super::proto::{self, Frame};
use super::session::receiver::ReceiverSession;
use super::session::{Action, AttResult, SessionEvent};
use async_trait::async_trait;
use ble_peripheral_rust::gatt::characteristic::Characteristic;
use ble_peripheral_rust::gatt::peripheral_event::{
    PeripheralEvent, ReadRequestResponse, RequestResponse, WriteRequestResponse,
};
use ble_peripheral_rust::gatt::properties::{AttributePermission, CharacteristicProperty};
use ble_peripheral_rust::gatt::service::Service;
use ble_peripheral_rust::{Peripheral, PeripheralImpl};
use std::fmt;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::{mpsc, watch, Mutex as AsyncMutex, OnceCell};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PeripheralInput {
    Write { value: Vec<u8>, offset: u64 },
    Subscription { subscribed: bool },
    Power { is_powered: bool },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RadioAction {
    WriteResponse { success: bool },
    Send(Vec<u8>),
    Event(SessionEvent),
    Teardown,
}

pub fn map_peripheral_input(
    input: PeripheralInput,
    session: &mut ReceiverSession,
) -> Vec<RadioAction> {
    match input {
        PeripheralInput::Write { value, offset } => {
            if offset != 0 {
                return vec![RadioAction::WriteResponse { success: false }];
            }
            let (actions, att) = session.on_write(&value);
            let mut mapped = map_actions(actions);
            mapped.push(RadioAction::WriteResponse { success: att == AttResult::Success });
            mapped
        }
        PeripheralInput::Subscription { subscribed: false } => {
            map_actions(session.on_disconnect())
        }
        PeripheralInput::Subscription { subscribed: true } => Vec::new(),
        PeripheralInput::Power { is_powered } => vec![RadioAction::Event(if is_powered {
            SessionEvent::PoweredOn
        } else {
            SessionEvent::PoweredOff
        })],
    }
}

fn map_actions(actions: Vec<Action>) -> Vec<RadioAction> {
    actions.into_iter().filter_map(|action| match action {
        Action::Send(frame) => proto::encode(&frame).ok().map(RadioAction::Send),
        Action::Teardown => Some(RadioAction::Teardown),
        Action::Emit(event) => Some(RadioAction::Event(event)),
    }).collect()
}

#[derive(Debug, Clone)]
pub struct BleRadioError {
    pub code: &'static str,
    pub detail: String,
}

impl BleRadioError {
    fn new(code: &'static str, detail: impl Into<String>) -> Self {
        Self { code, detail: detail.into() }
    }
}

impl fmt::Display for BleRadioError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}:{}", self.code, self.detail)
    }
}

/// Upper bound for CoreBluetooth's first state report. Until the delegate
/// fires, `is_powered` reports the Unknown state as `false`, which must not
/// be mistaken for "Bluetooth off".
const POWER_STATE_TIMEOUT: Duration = Duration::from_millis(2000);
const SESSION_EVENT_CAPACITY: usize = 64;

/// CoreBluetooth (macOS) is the only backend whose `is_powered` can report
/// the pre-authorization Unknown state as `false`; the WinRT backend
/// queries the real radio, where a raw `false` is a definitive off.
fn raw_false_is_ambiguous() -> bool {
    cfg!(target_os = "macos")
}

#[async_trait]
pub trait PeripheralBackend: Send + Sync + 'static {
    async fn is_powered(&self) -> Result<bool, BleRadioError>;
    async fn add_service(&self, service: &Service) -> Result<(), BleRadioError>;
    async fn start_advertising(&self, name: &str, uuids: &[uuid::Uuid]) -> Result<(), BleRadioError>;
    async fn stop_advertising(&self) -> Result<(), BleRadioError>;
    async fn update_characteristic(&self, characteristic: uuid::Uuid, value: Vec<u8>) -> Result<(), BleRadioError>;
}

pub struct NativePeripheralBackend {
    peripheral: AsyncMutex<Peripheral>,
}

#[async_trait]
impl PeripheralBackend for NativePeripheralBackend {
    async fn is_powered(&self) -> Result<bool, BleRadioError> {
        self.peripheral.lock().await.is_powered().await.map_err(radio_error)
    }
    async fn add_service(&self, service: &Service) -> Result<(), BleRadioError> {
        self.peripheral.lock().await.add_service(service).await.map_err(radio_error)
    }
    async fn start_advertising(&self, name: &str, uuids: &[uuid::Uuid]) -> Result<(), BleRadioError> {
        self.peripheral.lock().await.start_advertising(name, uuids).await.map_err(radio_error)
    }
    async fn stop_advertising(&self) -> Result<(), BleRadioError> {
        self.peripheral.lock().await.stop_advertising().await.map_err(radio_error)
    }
    async fn update_characteristic(&self, characteristic: uuid::Uuid, value: Vec<u8>) -> Result<(), BleRadioError> {
        self.peripheral.lock().await.update_characteristic(characteristic, value).await.map_err(radio_error)
    }
}

/// Identifies the session that currently owns event forwarding. The
/// subscription slot is the event sender's only owner, so clearing the slot
/// (detach or stream failure) closes the session's channel and its `run`
/// loop observes the end of the stream.
struct Subscription {
    id: u64,
}

/// The process-wide native peripheral manager.
///
/// ble-peripheral-rust 0.2.0 only honors the event sender and manager channel
/// of the first `Peripheral::new` call per process (`PERIPHERAL_THREAD:
/// OnceCell<()>` silently drops the arguments of every later call), so each
/// additional `Peripheral` is unusable. The native manager is therefore
/// created once and shared: a single pump task owns the upstream event
/// receiver, caches the latest power state, and forwards events to the
/// current session's subscription.
struct PeripheralHub<B: PeripheralBackend> {
    backend: B,
    power: watch::Sender<Option<bool>>,
    /// Keeps the power watch channel open with no active waiters, so pump
    /// state updates are never dropped between sessions.
    #[allow(dead_code)]
    power_hold: watch::Receiver<Option<bool>>,
    power_wait: Duration,
    /// Whether a raw `is_powered() == false` still needs the bounded
    /// delegate wait (CoreBluetooth's pre-authorization Unknown state).
    raw_false_ambiguous: bool,
    subscriber: Mutex<Option<(u64, mpsc::Sender<PeripheralEvent>)>>,
    next_subscription_id: AtomicU64,
    failure: Mutex<Option<String>>,
    service_registered: AtomicBool,
}

impl<B: PeripheralBackend> PeripheralHub<B> {
    fn new(
        backend: B,
        events: mpsc::Receiver<PeripheralEvent>,
        power_wait: Duration,
        raw_false_ambiguous: bool,
    ) -> Arc<Self> {
        let (power, power_hold) = watch::channel(None);
        let hub = Arc::new(Self {
            backend,
            power,
            power_hold,
            power_wait,
            raw_false_ambiguous,
            subscriber: Mutex::new(None),
            next_subscription_id: AtomicU64::new(0),
            failure: Mutex::new(None),
            service_registered: AtomicBool::new(false),
        });
        let pump = Arc::clone(&hub);
        tokio::spawn(async move {
            pump_events(pump, events).await;
        });
        hub
    }

    fn radio(self: &Arc<Self>) -> PeripheralRadio<B> {
        PeripheralRadio { hub: Arc::clone(self), subscription: None, events: None }
    }

    fn subscribe(&self) -> Result<(Subscription, mpsc::Receiver<PeripheralEvent>), BleRadioError> {
        self.ensure_alive()?;
        let (sender, events) = mpsc::channel(SESSION_EVENT_CAPACITY);
        let id = self.next_subscription_id.fetch_add(1, Ordering::Relaxed);
        *self.subscriber.lock().unwrap() = Some((id, sender));
        Ok((Subscription { id }, events))
    }

    fn detach(&self, subscription: &Subscription) {
        let mut slot = self.subscriber.lock().unwrap();
        if slot.as_ref().is_some_and(|(current, _)| *current == subscription.id) {
            *slot = None;
        }
    }

    fn ensure_alive(&self) -> Result<(), BleRadioError> {
        match &*self.failure.lock().unwrap() {
            Some(reason) => Err(BleRadioError::new("ble-peripheral-unavailable", reason.clone())),
            None => Ok(()),
        }
    }

    fn fail(&self, reason: String) {
        let mut failure = self.failure.lock().unwrap();
        if failure.is_none() {
            *failure = Some(reason);
        }
        drop(failure);
        *self.subscriber.lock().unwrap() = None;
    }

    async fn power_state(&self) -> Result<bool, BleRadioError> {
        self.ensure_alive()?;
        if let Some(powered) = *self.power.borrow() {
            return Ok(powered);
        }
        if !self.raw_false_ambiguous {
            // WinRT and BlueZ query the real radio, and WinRT emits no
            // initial StateUpdate, so a steady `false` is definitive off.
            return self.backend.is_powered().await;
        }
        // CoreBluetooth reports the pre-authorization Unknown state as
        // `false`, so a raw `false` carries no verdict; only the delegate's
        // StateUpdate or a raw `true` does.
        if self.backend.is_powered().await? {
            return Ok(true);
        }
        let mut updates = self.power.subscribe();
        let deadline = tokio::time::Instant::now() + self.power_wait;
        loop {
            if let Some(powered) = *updates.borrow_and_update() {
                return Ok(powered);
            }
            match tokio::time::timeout_at(deadline, updates.changed()).await {
                Err(_elapsed) => {
                    return Err(BleRadioError::new(
                        "ble-peripheral-unavailable",
                        format!(
                            "peripheral power state unknown after {}ms; Bluetooth permission may be pending or the adapter never reported its state",
                            self.power_wait.as_millis()
                        ),
                    ));
                }
                Ok(Err(_closed)) => {
                    return Err(BleRadioError::new(
                        "ble-peripheral-unavailable",
                        "power state watch channel closed",
                    ));
                }
                Ok(Ok(())) => {}
            }
        }
    }

    async fn ensure_service(&self, service: &Service) -> Result<(), BleRadioError> {
        if self.service_registered.load(Ordering::Acquire) {
            return Ok(());
        }
        self.backend.add_service(service).await?;
        self.service_registered.store(true, Ordering::Release);
        Ok(())
    }
}

async fn pump_events<B: PeripheralBackend>(
    hub: Arc<PeripheralHub<B>>,
    mut events: mpsc::Receiver<PeripheralEvent>,
) {
    while let Some(event) = events.recv().await {
        if let PeripheralEvent::StateUpdate { is_powered } = event {
            let _ = hub.power.send(Some(is_powered));
            if !is_powered {
                // CoreBluetooth drops GATT registrations when the radio turns
                // off; the next session must re-register them.
                hub.service_registered.store(false, Ordering::Release);
            }
        }
        let mut slot = hub.subscriber.lock().unwrap();
        match slot.as_mut() {
            // A dead or stalled session must never block the shared pump:
            // dropping the event also drops any ATT responder, which answers
            // the central with an error instead of silently succeeding.
            Some((_, sender)) => {
                if sender.try_send(event).is_err() {
                    slot.take();
                }
            }
            None => {}
        }
    }
    hub.fail("native peripheral event stream ended".into());
}

fn gatt_service() -> Service {
    Service {
        uuid: uuid::Uuid::from_bytes(proto::PB_SVC_UUID),
        primary: true,
        characteristics: vec![Characteristic {
            uuid: uuid::Uuid::from_bytes(proto::PB_CH_UUID),
            properties: vec![
                CharacteristicProperty::Read,
                CharacteristicProperty::Write,
                CharacteristicProperty::WriteWithoutResponse,
                CharacteristicProperty::Notify,
                CharacteristicProperty::Indicate,
            ],
            permissions: vec![AttributePermission::Readable, AttributePermission::Writeable],
            value: None,
            descriptors: Vec::new(),
        }],
    }
}

async fn shared_hub() -> Result<Arc<PeripheralHub<NativePeripheralBackend>>, BleRadioError> {
    static HUB: OnceCell<Arc<PeripheralHub<NativePeripheralBackend>>> = OnceCell::const_new();
    HUB.get_or_try_init(|| async {
        let (sender, events) = mpsc::channel::<PeripheralEvent>(SESSION_EVENT_CAPACITY);
        let peripheral = Peripheral::new(sender).await.map_err(radio_error)?;
        let backend = NativePeripheralBackend { peripheral: AsyncMutex::new(peripheral) };
        Ok(PeripheralHub::new(backend, events, POWER_STATE_TIMEOUT, raw_false_is_ambiguous()))
    })
    .await
    .cloned()
}

pub struct PeripheralRadio<B: PeripheralBackend = NativePeripheralBackend> {
    hub: Arc<PeripheralHub<B>>,
    subscription: Option<Subscription>,
    events: Option<mpsc::Receiver<PeripheralEvent>>,
}

impl PeripheralRadio {
    pub async fn new() -> Result<Self, BleRadioError> {
        Ok(shared_hub().await?.radio())
    }
}

impl<B: PeripheralBackend> PeripheralRadio<B> {
    pub async fn start(&mut self) -> Result<(), BleRadioError> {
        let (subscription, events) = self.hub.subscribe()?;
        self.subscription = Some(subscription);
        self.events = Some(events);
        let result = async {
            let powered = self.hub.power_state().await?;
            if !powered {
                return Err(BleRadioError::new("ble-bluetooth-off", "Bluetooth is off"));
            }
            self.hub.ensure_service(&gatt_service()).await?;
            self.hub
                .backend
                .start_advertising("PathBlender", &[uuid::Uuid::from_bytes(proto::PB_SVC_UUID)])
                .await
        }
        .await;
        if result.is_err() {
            self.detach_subscription();
        }
        result
    }

    pub async fn stop(&mut self) -> Result<(), BleRadioError> {
        self.hub.backend.stop_advertising().await
    }

    pub async fn send_frame(&mut self, frame: &Frame) -> Result<(), BleRadioError> {
        let bytes = proto::encode(frame)
            .map_err(|error| BleRadioError::new("ble-protocol-error", format!("{error:?}")))?;
        self.hub
            .backend
            .update_characteristic(uuid::Uuid::from_bytes(proto::PB_CH_UUID), bytes)
            .await
    }

    pub async fn power_state(&mut self) -> Result<bool, BleRadioError> {
        self.hub.power_state().await
    }

    fn detach_subscription(&mut self) {
        if let Some(subscription) = self.subscription.take() {
            self.hub.detach(&subscription);
        }
        self.events = None;
    }

    pub async fn run(
        &mut self,
        session: &mut ReceiverSession,
        controls: &mut tokio::sync::mpsc::Receiver<super::session::UserCommand>,
        mut on_event: impl FnMut(SessionEvent),
    ) -> Result<(), BleRadioError> {
        let mut events = self.events.take().ok_or_else(|| {
            BleRadioError::new("ble-peripheral-unavailable", "peripheral session was never started")
        })?;
        loop {
            let actions = tokio::select! {
                event = events.recv() => {
                    let Some(event) = event else {
                        return Err(BleRadioError::new(
                            "ble-peripheral-unavailable",
                            "shared peripheral event stream ended",
                        ));
                    };
                    match event {
                        PeripheralEvent::WriteRequest { value, offset, responder, .. } => {
                            let actions = map_peripheral_input(PeripheralInput::Write { value, offset }, session);
                            let success = actions.iter().any(|action| matches!(action, RadioAction::WriteResponse { success: true }));
                            let _ = responder.send(WriteRequestResponse {
                                response: if success { RequestResponse::Success } else { RequestResponse::RequestNotSupported },
                            });
                            actions
                        }
                        PeripheralEvent::CharacteristicSubscriptionUpdate { subscribed, .. } => {
                            map_peripheral_input(PeripheralInput::Subscription { subscribed }, session)
                        }
                        PeripheralEvent::StateUpdate { is_powered } => {
                            let mut actions = map_peripheral_input(PeripheralInput::Power { is_powered }, session);
                            if !is_powered {
                                actions.extend(map_actions(session.on_disconnect()));
                            }
                            actions
                        }
                        PeripheralEvent::ReadRequest { responder, .. } => {
                            let _ = responder.send(ReadRequestResponse {
                                value: Vec::new(),
                                response: RequestResponse::RequestNotSupported,
                            });
                            Vec::new()
                        }
                    }
                }
                control = controls.recv() => {
                    match control {
                        Some(super::session::UserCommand::Confirm(accepted)) => map_actions(session.on_user_confirm(accepted)),
                        Some(super::session::UserCommand::File { file_index, accepted }) => map_actions(session.on_user_file(file_index, accepted)),
                        Some(super::session::UserCommand::Cancel) | None => map_actions(session.on_user_cancel()),
                    }
                }
                _ = tokio::time::sleep(std::time::Duration::from_millis(100)) => {
                    map_actions(session.tick())
                }
            };
            if self.execute(actions, &mut on_event).await? {
                break;
            }
        }
        Ok(())
    }

    async fn execute(
        &mut self,
        actions: Vec<RadioAction>,
        on_event: &mut impl FnMut(SessionEvent),
    ) -> Result<bool, BleRadioError> {
        let mut teardown = false;
        for action in actions {
            match action {
                RadioAction::WriteResponse { .. } => {}
                RadioAction::Send(bytes) => {
                    self.hub
                        .backend
                        .update_characteristic(uuid::Uuid::from_bytes(proto::PB_CH_UUID), bytes)
                        .await?;
                }
                RadioAction::Event(event) => on_event(event),
                RadioAction::Teardown => teardown = true,
            }
        }
        if teardown {
            self.stop().await?;
        }
        Ok(teardown)
    }
}

impl<B: PeripheralBackend> Drop for PeripheralRadio<B> {
    fn drop(&mut self) {
        self.detach_subscription();
    }
}

fn radio_error(error: ble_peripheral_rust::error::Error) -> BleRadioError {
    BleRadioError::new("ble-peripheral-unavailable", error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ble::proto::{self, Frame, HelloBody};
    use crate::ble::session::{Clock, ShareLimits};
    use ble_peripheral_rust::gatt::peripheral_event::PeripheralRequest;
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

    fn session() -> ReceiverSession {
        ReceiverSession::new(
            &mut OsRng,
            Arc::new(FakeClock(SharedTime(std::sync::Mutex::new(0)))),
            "1",
            "receiver",
            ShareLimits { max_file_bytes: 100, max_files: 2 },
        )
    }

    #[derive(Clone, Default)]
    struct FakeBackend {
        raw_powered: bool,
        calls: Arc<Mutex<Vec<&'static str>>>,
    }

    impl FakeBackend {
        fn powered(raw_powered: bool) -> Self {
            Self { raw_powered, ..Default::default() }
        }
        fn record(&self, call: &'static str) {
            self.calls.lock().unwrap().push(call);
        }
        fn count(&self, call: &'static str) -> usize {
            self.calls.lock().unwrap().iter().filter(|c| **c == call).count()
        }
    }

    #[async_trait]
    impl PeripheralBackend for FakeBackend {
        async fn is_powered(&self) -> Result<bool, BleRadioError> {
            Ok(self.raw_powered)
        }
        async fn add_service(&self, _service: &Service) -> Result<(), BleRadioError> {
            self.record("add_service");
            Ok(())
        }
        async fn start_advertising(&self, _name: &str, _uuids: &[uuid::Uuid]) -> Result<(), BleRadioError> {
            self.record("start_advertising");
            Ok(())
        }
        async fn stop_advertising(&self) -> Result<(), BleRadioError> {
            self.record("stop_advertising");
            Ok(())
        }
        async fn update_characteristic(&self, _characteristic: uuid::Uuid, _value: Vec<u8>) -> Result<(), BleRadioError> {
            self.record("update_characteristic");
            Ok(())
        }
    }

    /// A hub wired to a scripted event source, with a short power-state bound
    /// so timeout paths stay fast in tests. Uses the macOS ambiguity policy.
    fn test_hub(backend: FakeBackend) -> (Arc<PeripheralHub<FakeBackend>>, mpsc::Sender<PeripheralEvent>) {
        let (source, events) = mpsc::channel(16);
        let hub = PeripheralHub::new(backend, events, Duration::from_millis(150), true);
        (hub, source)
    }

    /// A hub whose raw power query is definitive (WinRT/BlueZ semantics).
    /// The wait bound is long so any accidental delegate wait fails these
    /// tests by timing out instead of passing.
    fn definitive_hub(backend: FakeBackend) -> (Arc<PeripheralHub<FakeBackend>>, mpsc::Sender<PeripheralEvent>) {
        let (source, events) = mpsc::channel(16);
        let hub = PeripheralHub::new(backend, events, Duration::from_secs(30), false);
        (hub, source)
    }

    fn state_update(powered: bool) -> PeripheralEvent {
        PeripheralEvent::StateUpdate { is_powered: powered }
    }

    fn write_event() -> PeripheralEvent {
        let (responder, _) = tokio::sync::oneshot::channel();
        PeripheralEvent::WriteRequest {
            request: PeripheralRequest {
                client: "central".into(),
                service: uuid::Uuid::from_bytes(proto::PB_SVC_UUID),
                characteristic: uuid::Uuid::from_bytes(proto::PB_CH_UUID),
            },
            value: Vec::new(),
            offset: 0,
            responder,
        }
    }

    async fn settle() {
        tokio::time::sleep(Duration::from_millis(20)).await;
    }

    #[test]
    fn write_maps_session_actions_and_success_response() {
        let secret = StaticSecret::from([1; 32]);
        let hello = Frame::Hello(HelloBody {
            proto_ver: 1,
            max_frame: 180,
            instance_id: [2; 8],
            ecdh_pub: PublicKey::from(&secret).to_bytes(),
            app_ver: "1".into(),
            label: "sender".into(),
        });
        let actions = map_peripheral_input(
            PeripheralInput::Write { value: proto::encode(&hello).unwrap(), offset: 0 },
            &mut session(),
        );
        assert!(actions.contains(&RadioAction::WriteResponse { success: true }));
        assert!(actions.iter().any(|a| matches!(a, RadioAction::Send(bytes) if !bytes.is_empty())));
    }

    #[test]
    fn invalid_frame_gets_nack() {
        let actions = map_peripheral_input(
            PeripheralInput::Write { value: vec![0; proto::MAX_FRAME + 1], offset: 0 },
            &mut session(),
        );
        assert!(actions.contains(&RadioAction::WriteResponse { success: false }));
    }

    #[test]
    fn offset_writes_do_not_reach_the_session() {
        let actions = map_peripheral_input(
            PeripheralInput::Write { value: vec![], offset: 1 },
            &mut session(),
        );
        assert_eq!(actions, vec![RadioAction::WriteResponse { success: false }]);
    }

    #[test]
    fn unsubscribe_and_power_off_have_explicit_events() {
        let actions = map_peripheral_input(PeripheralInput::Subscription { subscribed: false }, &mut session());
        assert!(actions.contains(&RadioAction::Teardown));
        assert!(actions.contains(&RadioAction::Event(SessionEvent::Disconnected)));
        let actions = map_peripheral_input(PeripheralInput::Power { is_powered: false }, &mut session());
        assert_eq!(actions, vec![RadioAction::Event(SessionEvent::PoweredOff)]);
    }

    #[tokio::test]
    async fn queued_state_update_true_beats_raw_false() {
        let (hub, source) = test_hub(FakeBackend::powered(false));
        source.send(state_update(true)).await.unwrap();
        settle().await;
        assert_eq!(
            hub.power_state().await.unwrap(),
            true,
            "a delegate StateUpdate(true) must outrank the raw Unknown-as-false query"
        );
    }

    #[tokio::test]
    async fn in_flight_state_update_true_beats_raw_false() {
        let (hub, source) = test_hub(FakeBackend::powered(false));
        source.send(state_update(true)).await.unwrap();
        assert_eq!(
            hub.power_state().await.unwrap(),
            true,
            "a StateUpdate queued behind the query must still be consumed, not lost"
        );
    }

    #[tokio::test]
    async fn late_state_update_true_beats_raw_false() {
        let (hub, source) = test_hub(FakeBackend::powered(false));
        let delayed = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(30)).await;
            source.send(state_update(true)).await.unwrap();
        });
        assert_eq!(hub.power_state().await.unwrap(), true);
        delayed.await.unwrap();
    }

    #[tokio::test]
    async fn missing_state_update_is_an_error_not_a_definitive_off() {
        let (hub, _source) = test_hub(FakeBackend::powered(false));
        let error = hub.power_state().await.unwrap_err();
        assert_eq!(error.code, "ble-peripheral-unavailable", "Unknown must not surface as off: {error}");
        assert!(error.detail.contains("unknown"), "the timeout must be diagnosable: {error}");
    }

    #[tokio::test]
    async fn state_update_false_is_a_definitive_off() {
        let (hub, source) = test_hub(FakeBackend::powered(false));
        source.send(state_update(false)).await.unwrap();
        settle().await;
        assert_eq!(hub.power_state().await.unwrap(), false);
    }

    #[tokio::test]
    async fn radio_start_reports_bluetooth_off_only_after_a_definitive_state() {
        let (hub, source) = test_hub(FakeBackend::powered(false));
        source.send(state_update(false)).await.unwrap();
        settle().await;
        let mut radio = hub.radio();
        let error = radio.start().await.unwrap_err();
        assert_eq!(error.code, "ble-bluetooth-off");
    }

    #[tokio::test]
    async fn radio_start_treats_unknown_as_diagnosable_unavailable() {
        let (hub, _source) = test_hub(FakeBackend::powered(false));
        let mut radio = hub.radio();
        let error = radio.start().await.unwrap_err();
        assert_ne!(error.code, "ble-bluetooth-off", "Unknown must not be reported as off: {error}");
        assert_eq!(error.code, "ble-peripheral-unavailable");
    }

    #[tokio::test]
    async fn definitive_backend_false_is_off_without_delegate_wait() {
        let (hub, _source) = definitive_hub(FakeBackend::powered(false));
        let powered = tokio::time::timeout(Duration::from_millis(750), hub.power_state())
            .await
            .expect("a definitive radio query must not wait for a delegate StateUpdate")
            .unwrap();
        assert_eq!(powered, false, "a steady radio Off must surface as off, not unknown");
    }

    #[tokio::test]
    async fn definitive_backend_start_reports_bluetooth_off() {
        let (hub, _source) = definitive_hub(FakeBackend::powered(false));
        let mut radio = hub.radio();
        let error = tokio::time::timeout(Duration::from_millis(750), radio.start())
            .await
            .expect("start must fail fast when the radio query is definitive")
            .unwrap_err();
        assert_eq!(error.code, "ble-bluetooth-off", "Windows BT-off must keep its platform error code: {error}");
    }

    #[tokio::test]
    async fn second_session_reuses_cached_state_and_service_registration() {
        let backend = FakeBackend::powered(true);
        let (hub, source) = test_hub(backend.clone());
        source.send(state_update(true)).await.unwrap();
        settle().await;

        let mut first = hub.radio();
        first.start().await.expect("first session starts");
        drop(first);

        let mut second = hub.radio();
        second.start().await.expect("second session reuses the shared manager");
        assert_eq!(backend.count("add_service"), 1, "the GATT service stays registered across sessions");
        assert_eq!(backend.count("start_advertising"), 2, "advertising is still per session");
    }

    #[tokio::test]
    async fn service_registration_resets_after_a_power_cycle() {
        let backend = FakeBackend::powered(true);
        let (hub, source) = test_hub(backend.clone());
        source.send(state_update(true)).await.unwrap();
        settle().await;

        let mut first = hub.radio();
        first.start().await.expect("first session starts");
        drop(first);

        source.send(state_update(false)).await.unwrap();
        source.send(state_update(true)).await.unwrap();
        settle().await;

        let mut second = hub.radio();
        second.start().await.expect("session starts after the power cycle");
        assert_eq!(backend.count("add_service"), 2, "CoreBluetooth drops registrations on power-off");
    }

    #[tokio::test]
    async fn events_flow_only_to_the_current_session() {
        let (hub, source) = test_hub(FakeBackend::powered(true));
        let (first, mut first_events) = hub.subscribe().unwrap();
        source.send(write_event()).await.unwrap();
        let forwarded = tokio::time::timeout(Duration::from_secs(2), first_events.recv())
            .await
            .expect("event must reach the current session");
        assert!(matches!(forwarded, Some(PeripheralEvent::WriteRequest { .. })));

        hub.detach(&first);
        let ended = tokio::time::timeout(Duration::from_secs(2), first_events.recv())
            .await
            .expect("a detached session must see the stream end");
        assert!(ended.is_none());

        let (_second, mut second_events) = hub.subscribe().unwrap();
        source.send(write_event()).await.unwrap();
        let forwarded = tokio::time::timeout(Duration::from_secs(2), second_events.recv())
            .await
            .expect("event must reach the new current session");
        assert!(matches!(forwarded, Some(PeripheralEvent::WriteRequest { .. })));
    }

    #[tokio::test]
    async fn dead_session_never_stalls_the_shared_pump() {
        let (hub, source) = test_hub(FakeBackend::powered(true));
        let (_first, first_events) = hub.subscribe().unwrap();
        drop(first_events);

        source.send(state_update(false)).await.unwrap();
        settle().await;
        assert_eq!(
            hub.power_state().await.unwrap(),
            false,
            "the pump must cache state updates even when the session receiver is gone"
        );

        source.send(write_event()).await.unwrap();
        let (_second, mut second_events) = hub.subscribe().unwrap();
        source.send(write_event()).await.unwrap();
        let forwarded = tokio::time::timeout(Duration::from_secs(2), second_events.recv())
            .await
            .expect("event must reach the new current session");
        assert!(matches!(forwarded, Some(PeripheralEvent::WriteRequest { .. })));
    }

    #[tokio::test]
    async fn ended_native_stream_fails_diagnosably() {
        let (hub, source) = test_hub(FakeBackend::powered(true));
        drop(source);
        settle().await;
        let error = hub.power_state().await.unwrap_err();
        assert_eq!(error.code, "ble-peripheral-unavailable", "a lost native stream must not look like off: {error}");
        assert!(hub.subscribe().is_err(), "new sessions must be refused after the stream ends");
    }

    #[tokio::test]
    async fn run_reports_an_ended_shared_stream_as_failure() {
        let backend = FakeBackend::powered(true);
        let (hub, source) = test_hub(backend.clone());
        let mut radio = hub.radio();
        radio.start().await.expect("raw powered=true must pass the power gate");
        drop(source);
        settle().await;

        let (_controls_tx, mut controls) = tokio::sync::mpsc::channel(1);
        let result = radio.run(&mut session(), &mut controls, |_| {}).await;
        let error = result.unwrap_err();
        assert_eq!(error.code, "ble-peripheral-unavailable", "a silent stream end must not count as success: {error}");
    }

    #[tokio::test]
    async fn run_without_start_is_refused() {
        let (hub, _source) = test_hub(FakeBackend::powered(true));
        let mut radio = hub.radio();
        let (_controls_tx, mut controls) = tokio::sync::mpsc::channel(1);
        assert_eq!(radio.run(&mut session(), &mut controls, |_| {}).await.unwrap_err().code, "ble-peripheral-unavailable");
    }
}
