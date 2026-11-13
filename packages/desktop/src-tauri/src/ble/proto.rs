pub const PB_SVC_UUID: [u8; 16] = [
    0xa6, 0xaf, 0xd4, 0xb9, 0x19, 0x89, 0x4c, 0xcc,
    0x9f, 0x3d, 0x63, 0x89, 0x3d, 0x4d, 0xc8, 0x02,
];
pub const PB_CH_UUID: [u8; 16] = [
    0x23, 0xf8, 0x60, 0xe0, 0x5e, 0xc2, 0x46, 0xd5,
    0x9e, 0x4c, 0x3a, 0x3c, 0x4f, 0xb4, 0x2c, 0x93,
];
pub const PROTO_VER: u8 = 1;
pub const MAX_FRAME: usize = 180;
pub const ENVELOPE_OVERHEAD: usize = 27;
pub const MAX_ENCRYPTED_BODY: usize = MAX_FRAME - ENVELOPE_OVERHEAD;
pub const MAX_CHUNK_DATA: usize = 145;
pub const MAX_NAME_BYTES: usize = 110;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Frame {
    Hello(HelloBody),
    HelloAck(HelloBody),
    ProtoError { code: u8 },
    Sealed(SealedBody),
    Confirm { accepted: bool },
    FileBegin(FileBegin),
    FileAccept { file_index: u16, accepted: bool },
    Chunk { file_index: u16, seq: u32, data: Vec<u8> },
    ChunkAck { file_index: u16, cum_seq: u32 },
    Resync { file_index: u16, expected_seq: u32 },
    FileEnd { file_index: u16 },
    FileDone { file_index: u16, ok: bool },
    FileCancel { file_index: u16, reason: u8 },
    SessionCancel { reason: u8 },
    Keepalive,
    SessionComplete,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SealedBody {
    pub frame_type: u8,
    pub counter: u64,
    pub ct: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HelloBody {
    pub proto_ver: u8,
    pub max_frame: u16,
    pub instance_id: [u8; 8],
    pub ecdh_pub: [u8; 32],
    pub app_ver: String,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileBegin {
    pub file_index: u16,
    pub name: String,
    pub size: u64,
    pub sha256: [u8; 32],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WireError {
    Truncated,
    UnknownType(u8),
    TooLong(usize),
    BadUtf8,
    Malformed,
}

pub fn is_cleartext_type(t: u8) -> bool {
    matches!(t, 0x01 | 0x02 | 0x1f)
}

pub fn frame_type_of(bytes: &[u8]) -> Option<u8> {
    (bytes.len() >= 3).then(|| bytes[0])
}

pub fn encode(frame: &Frame) -> Result<Vec<u8>, WireError> {
    validate(frame)?;
    if let Frame::Sealed(sealed) = frame {
        let mut out = Vec::with_capacity(11 + sealed.ct.len());
        out.push(sealed.frame_type);
        put_u16(&mut out, sealed.ct.len() as u16);
        out.extend_from_slice(&sealed.counter.to_le_bytes());
        out.extend_from_slice(&sealed.ct);
        return Ok(out);
    }
    Ok(encode_encrypted_body(frame))
}

pub fn encode_encrypted_body(frame: &Frame) -> Vec<u8> {
    let mut out = Vec::new();
    out.push(frame_type(frame));
    match frame {
        Frame::Hello(body) | Frame::HelloAck(body) => {
            put_u16(&mut out, (1 + 2 + 8 + 32 + 1 + body.app_ver.len() + 1 + body.label.len()) as u16);
            out.push(body.proto_ver);
            put_u16(&mut out, body.max_frame);
            out.extend_from_slice(&body.instance_id);
            out.extend_from_slice(&body.ecdh_pub);
            put_string(&mut out, &body.app_ver);
            put_string(&mut out, &body.label);
        }
        Frame::ProtoError { code } => {
            put_u16(&mut out, 1);
            out.push(*code);
        }
        Frame::Confirm { accepted } => encode_bool(&mut out, *accepted),
        Frame::FileBegin(file) => {
            put_u16(&mut out, 2 + 1 + file.name.len() as u16 + 8 + 32);
            put_u16(&mut out, file.file_index);
            out.push(file.name.len() as u8);
            out.extend_from_slice(file.name.as_bytes());
            out.extend_from_slice(&file.size.to_le_bytes());
            out.extend_from_slice(&file.sha256);
        }
        Frame::FileAccept { file_index, accepted } => {
            put_u16(&mut out, 3);
            put_u16(&mut out, *file_index);
            out.push(u8::from(*accepted));
        }
        Frame::Chunk { file_index, seq, data } => {
            put_u16(&mut out, 2 + 4 + 2 + data.len() as u16);
            put_u16(&mut out, *file_index);
            out.extend_from_slice(&seq.to_le_bytes());
            put_u16(&mut out, data.len() as u16);
            out.extend_from_slice(data);
        }
        Frame::ChunkAck { file_index, cum_seq } => {
            put_u16(&mut out, 6);
            put_u16(&mut out, *file_index);
            out.extend_from_slice(&cum_seq.to_le_bytes());
        }
        Frame::Resync { file_index, expected_seq } => {
            put_u16(&mut out, 6);
            put_u16(&mut out, *file_index);
            out.extend_from_slice(&expected_seq.to_le_bytes());
        }
        Frame::FileEnd { file_index } => {
            put_u16(&mut out, 2);
            put_u16(&mut out, *file_index);
        }
        Frame::FileDone { file_index, ok } => {
            put_u16(&mut out, 3);
            put_u16(&mut out, *file_index);
            out.push(u8::from(*ok));
        }
        Frame::FileCancel { file_index, reason } => {
            put_u16(&mut out, 3);
            put_u16(&mut out, *file_index);
            out.push(*reason);
        }
        Frame::SessionCancel { reason } => {
            put_u16(&mut out, 1);
            out.push(*reason);
        }
        Frame::Keepalive | Frame::SessionComplete => put_u16(&mut out, 0),
        Frame::Sealed(_) => unreachable!("an envelope does not have a plaintext body"),
    }
    out
}

pub fn decode(bytes: &[u8]) -> Result<Frame, WireError> {
    let t = frame_type_of(bytes).ok_or(WireError::Truncated)?;
    ensure_known_type(t)?;
    if is_cleartext_type(t) {
        let (declared, payload) = plain_parts(bytes)?;
        return decode_payload(t, payload, declared);
    }
    if t == 0x18 && bytes.len() == 4 && read_u16(&bytes[1..3]) == 1 {
        return Ok(Frame::SessionCancel { reason: bytes[3] });
    }
    if bytes.len() < 11 {
        return Err(WireError::Truncated);
    }
    let ct_len = read_u16(&bytes[1..3]) as usize;
    if ct_len != bytes.len() - 11 || ct_len < 16 {
        return Err(WireError::Malformed);
    }
    let counter = u64::from_le_bytes(bytes[3..11].try_into().map_err(|_| WireError::Truncated)?);
    Ok(Frame::Sealed(SealedBody { frame_type: t, counter, ct: bytes[11..].to_vec() }))
}

pub fn encode_payload(frame: &Frame) -> Vec<u8> {
    encode_encrypted_body(frame)[3..].to_vec()
}

pub fn decode_encrypted_body(frame_type: u8, payload: &[u8]) -> Result<Frame, WireError> {
    if is_cleartext_type(frame_type) || payload.len() > MAX_ENCRYPTED_BODY {
        return Err(WireError::Malformed);
    }
    ensure_known_type(frame_type)?;
    decode_payload(frame_type, payload, payload.len())
}

fn frame_type(frame: &Frame) -> u8 {
    match frame {
        Frame::Hello(_) => 0x01,
        Frame::HelloAck(_) => 0x02,
        Frame::ProtoError { .. } => 0x1f,
        Frame::Confirm { .. } => 0x04,
        Frame::FileBegin(_) => 0x10,
        Frame::FileAccept { .. } => 0x11,
        Frame::Chunk { .. } => 0x12,
        Frame::ChunkAck { .. } => 0x13,
        Frame::Resync { .. } => 0x14,
        Frame::FileEnd { .. } => 0x15,
        Frame::FileDone { .. } => 0x16,
        Frame::FileCancel { .. } => 0x17,
        Frame::SessionCancel { .. } => 0x18,
        Frame::Keepalive => 0x19,
        Frame::SessionComplete => 0x1a,
        Frame::Sealed(sealed) => sealed.frame_type,
    }
}

fn ensure_known_type(t: u8) -> Result<(), WireError> {
    if matches!(t, 0x01 | 0x02 | 0x1f | 0x04 | 0x10..=0x1a) {
        Ok(())
    } else {
        Err(WireError::UnknownType(t))
    }
}

fn validate(frame: &Frame) -> Result<(), WireError> {
    let size = match frame {
        Frame::Hello(body) | Frame::HelloAck(body) => {
            if body.app_ver.len() > 32 || body.label.len() > 32 {
                return Err(WireError::Malformed);
            }
            encode_encrypted_body(frame).len()
        }
        Frame::FileBegin(file) if file.name.len() > MAX_NAME_BYTES => {
            return Err(WireError::TooLong(file.name.len()));
        }
        Frame::Chunk { data, .. } if data.len() > MAX_CHUNK_DATA => {
            return Err(WireError::TooLong(data.len()));
        }
        Frame::Sealed(sealed) => 11 + sealed.ct.len(),
        _ => encode_encrypted_body(frame).len(),
    };
    if size > MAX_FRAME {
        Err(WireError::TooLong(size))
    } else {
        Ok(())
    }
}

fn encode_bool(out: &mut Vec<u8>, value: bool) {
    put_u16(out, 1);
    out.push(u8::from(value));
}

fn put_u16(out: &mut Vec<u8>, value: u16) {
    out.extend_from_slice(&value.to_le_bytes());
}

fn put_string(out: &mut Vec<u8>, value: &str) {
    out.push(value.len() as u8);
    out.extend_from_slice(value.as_bytes());
}

fn read_u16(bytes: &[u8]) -> u16 {
    u16::from_le_bytes([bytes[0], bytes[1]])
}

fn plain_parts(bytes: &[u8]) -> Result<(usize, &[u8]), WireError> {
    if bytes.len() < 3 {
        return Err(WireError::Truncated);
    }
    let declared = read_u16(&bytes[1..3]) as usize;
    if declared > MAX_ENCRYPTED_BODY || bytes.len() < 3 + declared {
        return Err(WireError::Truncated);
    }
    if declared != bytes.len() - 3 {
        return Err(WireError::Malformed);
    }
    Ok((declared, &bytes[3..]))
}

fn decode_payload(t: u8, payload: &[u8], declared: usize) -> Result<Frame, WireError> {
    match t {
        0x01 | 0x02 => {
            let body = parse_hello(payload)?;
            Ok(if t == 0x01 { Frame::Hello(body) } else { Frame::HelloAck(body) })
        }
        0x1f => Ok(Frame::ProtoError { code: exactly::<1>(payload)?[0] }),
        0x04 => Ok(Frame::Confirm { accepted: parse_bool(payload)? }),
        0x10 => parse_file_begin(payload),
        0x11 => Ok(Frame::FileAccept {
            file_index: read_u16(&exactly::<3>(payload)?[..2]),
            accepted: payload[2] != 0,
        }),
        0x12 => {
            if payload.len() < 8 {
                return Err(WireError::Truncated);
            }
            let data_len = read_u16(&payload[6..8]) as usize;
            if data_len > MAX_CHUNK_DATA || payload.len() != 8 + data_len {
                return Err(WireError::Malformed);
            }
            Ok(Frame::Chunk {
                file_index: read_u16(&payload[..2]),
                seq: u32::from_le_bytes(payload[2..6].try_into().map_err(|_| WireError::Truncated)?),
                data: payload[8..].to_vec(),
            })
        }
        0x13 | 0x14 => {
            let payload = exactly::<6>(payload)?;
            let file_index = read_u16(&payload[..2]);
            let seq = u32::from_le_bytes(payload[2..6].try_into().map_err(|_| WireError::Truncated)?);
            Ok(if t == 0x13 {
                Frame::ChunkAck { file_index, cum_seq: seq }
            } else {
                Frame::Resync { file_index, expected_seq: seq }
            })
        }
        0x15 => Ok(Frame::FileEnd { file_index: read_u16(&exactly::<2>(payload)?) }),
        0x16 => Ok(Frame::FileDone {
            file_index: read_u16(&exactly::<3>(payload)?[..2]),
            ok: payload[2] != 0,
        }),
        0x17 => Ok(Frame::FileCancel {
            file_index: read_u16(&exactly::<3>(payload)?[..2]),
            reason: payload[2],
        }),
        0x18 => Ok(Frame::SessionCancel { reason: exactly::<1>(payload)?[0] }),
        0x19 | 0x1a => {
            if declared != 0 {
                Err(WireError::Malformed)
            } else if t == 0x19 {
                Ok(Frame::Keepalive)
            } else {
                Ok(Frame::SessionComplete)
            }
        }
        _ => Err(WireError::UnknownType(t)),
    }
}

fn exactly<'a, const N: usize>(payload: &'a [u8]) -> Result<&'a [u8], WireError> {
    if payload.len() == N { Ok(payload) } else { Err(WireError::Malformed) }
}

fn parse_bool(payload: &[u8]) -> Result<bool, WireError> {
    match exactly::<1>(payload)?[0] {
        0 => Ok(false),
        1 => Ok(true),
        _ => Err(WireError::Malformed),
    }
}

fn parse_hello(payload: &[u8]) -> Result<HelloBody, WireError> {
    if payload.len() < 45 {
        return Err(WireError::Truncated);
    }
    let proto_ver = payload[0];
    let max_frame = read_u16(&payload[1..3]);
    let instance_id = payload[3..11].try_into().map_err(|_| WireError::Truncated)?;
    let ecdh_pub = payload[11..43].try_into().map_err(|_| WireError::Truncated)?;
    let (app_ver, used) = parse_string(&payload[43..], 32)?;
    let (label, used_label) = parse_string(&payload[43 + used..], 32)?;
    if 43 + used + used_label != payload.len() {
        return Err(WireError::Malformed);
    }
    Ok(HelloBody { proto_ver, max_frame, instance_id, ecdh_pub, app_ver, label })
}

fn parse_file_begin(payload: &[u8]) -> Result<Frame, WireError> {
    if payload.len() < 43 {
        return Err(WireError::Truncated);
    }
    let name_len = payload[2] as usize;
    if name_len > MAX_NAME_BYTES || payload.len() != 43 + name_len {
        return Err(WireError::Malformed);
    }
    let name = String::from_utf8(payload[3..3 + name_len].to_vec()).map_err(|_| WireError::BadUtf8)?;
    let size_at = 3 + name_len;
    let size = u64::from_le_bytes(payload[size_at..size_at + 8].try_into().map_err(|_| WireError::Truncated)?);
    let sha256 = payload[size_at + 8..size_at + 40].try_into().map_err(|_| WireError::Truncated)?;
    Ok(Frame::FileBegin(FileBegin {
        file_index: read_u16(&payload[..2]),
        name,
        size,
        sha256,
    }))
}

fn parse_string(bytes: &[u8], max: usize) -> Result<(String, usize), WireError> {
    let len = *bytes.first().ok_or(WireError::Truncated)? as usize;
    if len > max || bytes.len() < 1 + len {
        return Err(WireError::Malformed);
    }
    let value = String::from_utf8(bytes[1..1 + len].to_vec()).map_err(|_| WireError::BadUtf8)?;
    Ok((value, len + 1))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hello() -> HelloBody {
        HelloBody {
            proto_ver: PROTO_VER,
            max_frame: MAX_FRAME as u16,
            instance_id: [7; 8],
            ecdh_pub: [9; 32],
            app_ver: "0.1.10".into(),
            label: "Mac".into(),
        }
    }

    fn encrypted_frames() -> Vec<Frame> {
        vec![
            Frame::Confirm { accepted: true },
            Frame::FileBegin(FileBegin { file_index: 2, name: "x".repeat(MAX_NAME_BYTES), size: 900, sha256: [4; 32] }),
            Frame::FileAccept { file_index: 2, accepted: true },
            Frame::Chunk { file_index: 2, seq: 7, data: vec![5; MAX_CHUNK_DATA] },
            Frame::ChunkAck { file_index: 2, cum_seq: 7 },
            Frame::Resync { file_index: 2, expected_seq: 4 },
            Frame::FileEnd { file_index: 2 },
            Frame::FileDone { file_index: 2, ok: true },
            Frame::FileCancel { file_index: 2, reason: 3 },
            Frame::SessionCancel { reason: 1 },
            Frame::Keepalive,
            Frame::SessionComplete,
        ]
    }

    #[test]
    fn fixed_uuids_and_cleartext_types_are_contracts() {
        assert_eq!(PB_SVC_UUID, [0xa6,0xaf,0xd4,0xb9,0x19,0x89,0x4c,0xcc,0x9f,0x3d,0x63,0x89,0x3d,0x4d,0xc8,0x02]);
        assert_eq!(PB_CH_UUID, [0x23,0xf8,0x60,0xe0,0x5e,0xc2,0x46,0xd5,0x9e,0x4c,0x3a,0x3c,0x4f,0xb4,0x2c,0x93]);
        assert!(is_cleartext_type(0x01));
        assert!(is_cleartext_type(0x02));
        assert!(is_cleartext_type(0x1f));
        for t in [0x04, 0x10, 0x12, 0x18] { assert!(!is_cleartext_type(t)); }
    }

    #[test]
    fn clear_frames_round_trip() {
        for frame in [Frame::Hello(hello()), Frame::HelloAck(hello()), Frame::ProtoError { code: 2 }] {
            let bytes = encode(&frame).unwrap();
            assert_eq!(decode(&bytes).unwrap(), frame);
        }
    }

    #[test]
    fn encrypted_bodies_and_envelopes_round_trip() {
        for frame in encrypted_frames() {
            let payload = encode_payload(&frame);
            let t = encode_encrypted_body(&frame)[0];
            assert_eq!(decode_encrypted_body(t, &payload).unwrap(), frame);
            let sealed = Frame::Sealed(SealedBody { frame_type: t, counter: 42, ct: vec![0xde; 16] });
            assert_eq!(decode(&encode(&sealed).unwrap()).unwrap(), sealed);
        }
    }

    #[test]
    fn largest_encrypted_frames_fit_the_wire_budget() {
        for frame in encrypted_frames() {
            let sealed_size = encode_payload(&frame).len() + ENVELOPE_OVERHEAD;
            assert!(sealed_size <= MAX_FRAME, "{frame:?} has {sealed_size} bytes");
            if matches!(frame, Frame::Chunk { .. } | Frame::FileBegin(_)) {
                assert_eq!(sealed_size, MAX_FRAME);
            }
        }
        assert_eq!(encode(&Frame::Hello(HelloBody { label: "x".repeat(32), app_ver: "x".repeat(32), ..hello() })).unwrap().len(), 112);
    }

    #[test]
    fn rejects_truncation_and_unknown_types() {
        for bytes in [vec![], vec![1], vec![1, 0]] {
            assert!(matches!(decode(&bytes), Err(WireError::Truncated)));
        }
        assert_eq!(decode(&[0xff, 0, 0]), Err(WireError::UnknownType(0xff)));
        assert_eq!(frame_type_of(&[]), None);
        assert_eq!(frame_type_of(&[1, 0]), None);
        assert_eq!(frame_type_of(&[0x12, 0, 0]), Some(0x12));
    }

    #[test]
    fn rejects_oversized_chunk_and_file_name() {
        let chunk = Frame::Chunk { file_index: 0, seq: 0, data: vec![0; MAX_CHUNK_DATA + 1] };
        assert!(encode(&chunk).is_err());
        let file = Frame::FileBegin(FileBegin {
            file_index: 0,
            name: "x".repeat(MAX_NAME_BYTES + 1),
            size: 0,
            sha256: [0; 32],
        });
        assert!(encode(&file).is_err());
    }

    #[test]
    fn rejects_long_hello_text_and_invalid_utf8() {
        let mut body = hello();
        body.label = "x".repeat(33);
        assert_eq!(encode(&Frame::Hello(body)), Err(WireError::Malformed));
        let mut raw = encode(&Frame::Hello(hello())).unwrap();
        raw[47] = 0xff;
        assert_eq!(decode(&raw), Err(WireError::BadUtf8));
    }
}
