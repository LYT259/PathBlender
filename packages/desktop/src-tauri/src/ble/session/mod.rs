pub mod receiver;
pub mod sender;

#[cfg(test)]
mod loopback_tests;

use crate::ble::proto::Frame;

pub trait Clock: Send + Sync {
    fn now_ms(&self) -> u64;
}

#[derive(Debug, Clone, Copy)]
pub struct ShareLimits {
    pub max_file_bytes: u64,
    pub max_files: usize,
}

#[derive(Debug, Clone)]
pub enum Action {
    Send(Frame),
    Teardown,
    Emit(SessionEvent),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionEvent {
    PoweredOn,
    PoweredOff,
    SasCode(String),
    ConfirmPending { peer_label: String, peer_version: String },
    Confirmed,
    FileRequest { file_index: u16, name: String, size: u64 },
    FileResult { file_index: u16, accepted: bool },
    Progress { file_index: u16, received: u64, total: u64 },
    FileVerified { file_index: u16, ok: bool },
    Done { ok_count: usize, fail_count: usize },
    Failed { code: &'static str, detail: String },
    Cancelled,
    Disconnected,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttResult {
    Success,
    RequestNotSupported,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReceivedFile {
    pub index: u16,
    pub name: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShareFile {
    pub name: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UserCommand {
    Confirm(bool),
    File { file_index: u16, accepted: bool },
    Cancel,
}
