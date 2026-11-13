use super::peripheral::BleRadioError;
use super::proto;
use async_trait::async_trait;
use btleplug::api::{
    Central, CentralEvent, CentralState, Characteristic, Manager as _, Peripheral as _,
    PeripheralProperties, ScanFilter, WriteType,
};
use btleplug::platform::{Adapter, Manager, Peripheral};
use futures::{Stream, StreamExt};
use std::collections::HashMap;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use tokio::task::JoinHandle;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoveredPeer {
    pub id: String,
    pub label: String,
    pub rssi: Option<i16>,
}

#[async_trait]
pub trait CentralRadio: Send {
    async fn adapter_powered(&self) -> Result<Option<bool>, BleRadioError>;
    async fn scan(&mut self, on_discovered: Box<dyn Fn(DiscoveredPeer) + Send>) -> Result<(), BleRadioError>;
    async fn stop_scan(&mut self) -> Result<(), BleRadioError>;
    async fn connect(&mut self, id: &str) -> Result<Box<dyn GattLink>, BleRadioError>;
    async fn disconnect_all(&mut self) -> Result<(), BleRadioError>;
}

#[async_trait]
pub trait GattLink: Send {
    async fn write(&mut self, bytes: &[u8]) -> Result<(), BleRadioError>;
    async fn next_notification(&mut self) -> Result<Option<Vec<u8>>, BleRadioError>;
    async fn close(&mut self) -> Result<(), BleRadioError>;
}

pub fn scan_filter() -> ScanFilter {
    ScanFilter { services: vec![uuid::Uuid::from_bytes(proto::PB_SVC_UUID)] }
}

/// ATT-level write rejections (our own receiver NACKs bad frames with
/// RequestNotSupported; WinRT reports `GattCommunicationStatus` failures,
/// macOS wraps CoreBluetooth errors in `RuntimeError`) are lost frames, not
/// dead links. Only `NotConnected` is treated as a real disconnect.
pub(crate) const WRITE_REJECTED_CODE: &str = "ble-write-rejected";

fn write_error(error: btleplug::Error) -> BleRadioError {
    let code = if matches!(error, btleplug::Error::NotConnected) { "ble-disconnected" } else { WRITE_REJECTED_CODE };
    BleRadioError { code, detail: error.to_string() }
}

pub fn peer_label_from(props: &PeripheralProperties) -> String {
    props.local_name.clone()
        .or_else(|| props.advertisement_name.clone())
        .unwrap_or_else(|| "PathBlender".into())
}

pub struct BtleplugRadio {
    adapter: Adapter,
    known: HashMap<String, Peripheral>,
    scan_task: Option<JoinHandle<()>>,
    powered: Arc<Mutex<Option<bool>>>,
}

impl BtleplugRadio {
    pub async fn new() -> Result<Self, BleRadioError> {
        let manager = Manager::new().await.map_err(|error| radio_error("ble-scan-failed", error))?;
        let adapter = manager.adapters().await.map_err(|error| radio_error("ble-scan-failed", error))?
            .into_iter().next()
            .ok_or_else(|| BleRadioError { code: "ble-bluetooth-off", detail: "no BLE adapter".into() })?;
        Ok(Self {
            adapter,
            known: HashMap::new(),
            scan_task: None,
            powered: Arc::new(Mutex::new(None)),
        })
    }
}

#[async_trait]
impl CentralRadio for BtleplugRadio {
    async fn adapter_powered(&self) -> Result<Option<bool>, BleRadioError> {
        Ok(*self.powered.lock().unwrap())
    }

    async fn scan(&mut self, on_discovered: Box<dyn Fn(DiscoveredPeer) + Send>) -> Result<(), BleRadioError> {
        if self.powered() == Some(false) {
            return Err(BleRadioError { code: "ble-bluetooth-off", detail: "Bluetooth is off".into() });
        }
        if self.scan_task.as_ref().is_some_and(|task| !task.is_finished()) {
            return Err(BleRadioError { code: "ble-busy", detail: "scan already active".into() });
        }
        self.adapter.start_scan(scan_filter()).await.map_err(|error| radio_error("ble-scan-failed", error))?;
        let mut events = self.adapter.events().await.map_err(|error| radio_error("ble-scan-failed", error))?;
        let adapter = self.adapter.clone();
        let powered = self.powered.clone();
        self.scan_task = Some(tokio::spawn(async move {
            while let Some(event) = events.next().await {
                match event {
                    CentralEvent::StateUpdate(state) => {
                        *powered.lock().unwrap() = match state {
                            CentralState::PoweredOn => Some(true),
                            CentralState::PoweredOff => Some(false),
                            CentralState::Unknown => None,
                        };
                    }
                    CentralEvent::DeviceDiscovered(id) | CentralEvent::DeviceUpdated(id) => {
                        let Ok(peripheral) = adapter.peripheral(&id).await else { continue };
                        let id_string = id.to_string();
                        let properties = peripheral.properties().await.ok().flatten();
                        let label = properties.as_ref().map(peer_label_from).unwrap_or_else(|| "PathBlender".into());
                        let rssi = properties.and_then(|props| props.rssi);
                        on_discovered(DiscoveredPeer { id: id_string, label, rssi });
                    }
                    _ => {}
                }
            }
        }));
        Ok(())
    }

    async fn stop_scan(&mut self) -> Result<(), BleRadioError> {
        if let Some(task) = self.scan_task.take() {
            task.abort();
        }
        self.adapter.stop_scan().await.map_err(|error| radio_error("ble-scan-failed", error))
    }

    async fn connect(&mut self, id: &str) -> Result<Box<dyn GattLink>, BleRadioError> {
        let peripheral = match self.known.get(id) {
            Some(peripheral) => peripheral.clone(),
            None => {
                let peripherals = self.adapter.peripherals().await.map_err(|error| radio_error("ble-connect-failed", error))?;
                let found = peripherals.into_iter().find(|peripheral| peripheral.id().to_string() == id)
                    .ok_or_else(|| BleRadioError { code: "ble-not-found", detail: id.into() })?;
                self.known.insert(id.into(), found.clone());
                found
            }
        };
        peripheral.connect().await.map_err(|error| radio_error("ble-connect-failed", error))?;
        peripheral.discover_services().await.map_err(|error| radio_error("ble-connect-failed", error))?;
        let characteristic = peripheral.characteristics().into_iter()
            .find(|characteristic| characteristic.uuid == uuid::Uuid::from_bytes(proto::PB_CH_UUID))
            .ok_or_else(|| BleRadioError { code: "ble-not-found", detail: "PathBlender characteristic not found".into() })?;
        peripheral.subscribe(&characteristic).await.map_err(|error| radio_error("ble-connect-failed", error))?;
        let notifications = peripheral.notifications().await.map_err(|error| radio_error("ble-connect-failed", error))?
            .map(|notification| notification.value);
        Ok(Box::new(BtleplugLink { peripheral, characteristic, notifications: Box::pin(notifications) }))
    }

    async fn disconnect_all(&mut self) -> Result<(), BleRadioError> {
        self.stop_scan().await?;
        for (_, peripheral) in self.known.drain() {
            peripheral.disconnect().await.map_err(|error| radio_error("ble-disconnected", error))?;
        }
        Ok(())
    }
}

impl BtleplugRadio {
    fn powered(&self) -> Option<bool> {
        *self.powered.lock().unwrap()
    }
}

struct BtleplugLink {
    peripheral: Peripheral,
    characteristic: Characteristic,
    notifications: Pin<Box<dyn Stream<Item = Vec<u8>> + Send>>,
}

#[async_trait]
impl GattLink for BtleplugLink {
    async fn write(&mut self, bytes: &[u8]) -> Result<(), BleRadioError> {
        self.peripheral.write(&self.characteristic, bytes, WriteType::WithResponse)
            .await.map_err(write_error)
    }

    async fn next_notification(&mut self) -> Result<Option<Vec<u8>>, BleRadioError> {
        Ok(self.notifications.next().await)
    }

    async fn close(&mut self) -> Result<(), BleRadioError> {
        self.peripheral.disconnect().await.map_err(|error| radio_error("ble-disconnected", error))
    }
}

fn radio_error(code: &'static str, error: impl std::fmt::Display) -> BleRadioError {
    BleRadioError { code, detail: error.to_string() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use btleplug::api::PeripheralProperties;
    use std::collections::VecDeque;
    use std::sync::{Arc, Mutex};

    #[test]
    fn write_errors_split_fatal_disconnects_from_att_rejections() {
        assert_eq!(write_error(btleplug::Error::NotConnected).code, "ble-disconnected");
        assert_eq!(
            write_error(btleplug::Error::RuntimeError("ATT error in response".into())).code,
            WRITE_REJECTED_CODE,
        );
        assert_eq!(
            write_error(btleplug::Error::Other(
                "Windows UWP threw error on write: ProtocolError".into()
            )).code,
            WRITE_REJECTED_CODE,
        );
        assert_eq!(
            write_error(btleplug::Error::TimedOut(std::time::Duration::from_secs(10))).code,
            WRITE_REJECTED_CODE,
        );
    }

    #[test]
    fn local_name_is_used_when_available() {
        let props = PeripheralProperties {
            local_name: Some("Mac".into()),
            ..Default::default()
        };
        assert_eq!(peer_label_from(&props), "Mac");
        assert_eq!(peer_label_from(&PeripheralProperties::default()), "PathBlender");
    }

    #[test]
    fn scan_filter_contains_only_the_pathblender_service() {
        assert_eq!(scan_filter().services, vec![uuid::Uuid::from_bytes(proto::PB_SVC_UUID)]);
    }

    struct FakeLink {
        writes: Arc<Mutex<Vec<Vec<u8>>>>,
        notifications: VecDeque<Vec<u8>>,
    }

    #[async_trait]
    impl GattLink for FakeLink {
        async fn write(&mut self, bytes: &[u8]) -> Result<(), BleRadioError> {
            self.writes.lock().unwrap().push(bytes.to_vec());
            Ok(())
        }
        async fn next_notification(&mut self) -> Result<Option<Vec<u8>>, BleRadioError> {
            Ok(self.notifications.pop_front())
        }
        async fn close(&mut self) -> Result<(), BleRadioError> { Ok(()) }
    }

    struct FakeRadio {
        peer: DiscoveredPeer,
        writes: Arc<Mutex<Vec<Vec<u8>>>>,
    }

    #[async_trait]
    impl CentralRadio for FakeRadio {
        async fn adapter_powered(&self) -> Result<Option<bool>, BleRadioError> { Ok(Some(true)) }
        async fn scan(&mut self, on_discovered: Box<dyn Fn(DiscoveredPeer) + Send>) -> Result<(), BleRadioError> {
            on_discovered(self.peer.clone());
            Ok(())
        }
        async fn stop_scan(&mut self) -> Result<(), BleRadioError> { Ok(()) }
        async fn connect(&mut self, id: &str) -> Result<Box<dyn GattLink>, BleRadioError> {
            assert_eq!(id, self.peer.id);
            Ok(Box::new(FakeLink {
                writes: self.writes.clone(),
                notifications: VecDeque::from([vec![1, 2, 3]]),
            }))
        }
        async fn disconnect_all(&mut self) -> Result<(), BleRadioError> { Ok(()) }
    }

    #[tokio::test]
    async fn fake_radio_discovers_and_link_transports_bytes() {
        let writes = Arc::new(Mutex::new(Vec::new()));
        let mut radio = FakeRadio {
            peer: DiscoveredPeer { id: "one".into(), label: "Mac".into(), rssi: Some(-40) },
            writes: writes.clone(),
        };
        let seen = Arc::new(Mutex::new(Vec::new()));
        let callback_seen = seen.clone();
        radio.scan(Box::new(move |peer| callback_seen.lock().unwrap().push(peer))).await.unwrap();
        assert_eq!(seen.lock().unwrap()[0].label, "Mac");
        let mut link = radio.connect("one").await.unwrap();
        link.write(&[4, 5]).await.unwrap();
        assert_eq!(link.next_notification().await.unwrap(), Some(vec![1, 2, 3]));
        assert_eq!(writes.lock().unwrap().as_slice(), &[vec![4, 5]]);
    }
}
