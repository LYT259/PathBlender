use super::proto::MAX_NAME_BYTES;

pub fn sanitize_file_name(raw: &str) -> String {
    let without_controls: String = raw
        .chars()
        .filter(|c| *c != '\u{feff}' && !c.is_control())
        .map(|c| if c == '/' || c == '\\' { '_' } else { c })
        .collect();
    let without_parent_segments = without_controls
        .split('_')
        .filter(|segment| *segment != "..")
        .collect::<Vec<_>>()
        .join("_");
    let trimmed = without_parent_segments.trim();
    if trimmed.is_empty() {
        return "file".into();
    }
    let mut end = 0;
    for (index, ch) in trimmed.char_indices() {
        let next = index + ch.len_utf8();
        if next > MAX_NAME_BYTES {
            break;
        }
        end = next;
    }
    trimmed[..end].to_string()
}

pub fn is_plausible_share_name(s: &str) -> bool {
    !s.trim().is_empty()
        && s.len() <= MAX_NAME_BYTES
        && !s.contains(['/', '\\'])
        && !s.chars().any(|c| c.is_control() || c == '\u{feff}')
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ble::proto::{self, FileBegin, Frame};

    #[test]
    fn keeps_plain_names_and_removes_path_semantics() {
        assert_eq!(sanitize_file_name("a.traj"), "a.traj");
        assert_eq!(sanitize_file_name("../../evil.traj"), "evil.traj");
        assert_eq!(sanitize_file_name("a/b\\c.traj"), "a_b_c.traj");
        assert_eq!(sanitize_file_name("NUL\0.traj"), "NUL.traj");
        assert_eq!(sanitize_file_name("\u{feff}  demo.traj  "), "demo.traj");
    }

    #[test]
    fn empty_names_get_a_safe_label() {
        assert_eq!(sanitize_file_name(""), "file");
        assert_eq!(sanitize_file_name("   "), "file");
        assert_eq!(sanitize_file_name("\0\u{1f}\u{7f}"), "file");
    }

    #[test]
    fn unicode_stays_intact_and_long_names_cut_at_char_boundaries() {
        let unicode = "路径🤖.traj";
        assert_eq!(sanitize_file_name(unicode), unicode);
        let long = "路径🤖".repeat(40);
        let short = sanitize_file_name(&long);
        assert!(short.len() <= 110);
        assert!(long.starts_with(&short));
    }

    #[test]
    fn sanitized_names_are_plausible_and_fit_file_begin() {
        for raw in ["a.traj", "../../evil.traj", "a/b\\c.traj", "", "路径🤖.traj"] {
            let name = sanitize_file_name(raw);
            assert!(is_plausible_share_name(&name));
            let frame = Frame::FileBegin(FileBegin {
                file_index: 0,
                name,
                size: 1,
                sha256: [0; 32],
            });
            assert!(proto::encode(&frame).is_ok());
        }
        assert!(!is_plausible_share_name("a/b\\c.traj"));
        assert!(!is_plausible_share_name("  "));
    }
}
