use ace_runner::files::{ReadDirectory, read_beneath, read_regular};
use std::{fs, path::Path};

#[test]
fn bounded_reads_accept_regular_files_and_reject_oversized_or_invalid_paths() {
    let root = tempfile::tempdir().unwrap();
    fs::write(root.path().join("input"), b"1234").unwrap();
    let reader = ReadDirectory::open(root.path()).unwrap();
    assert_eq!(reader.read(Path::new("input"), 4).unwrap(), b"1234");
    assert!(reader.read(Path::new("input"), 3).is_err());
    assert!(reader.read(Path::new("input"), u64::MAX).is_err());
    assert!(reader.read(Path::new("."), 4).is_err());
    assert!(reader.read(Path::new("../input"), 4).is_err());
    assert!(reader.read(&root.path().join("input"), 4).is_err());
    fs::create_dir(root.path().join("directory")).unwrap();
    assert!(reader.read(Path::new("directory"), 4).is_err());
    assert_eq!(
        read_regular(&root.path().join("input"), 4).unwrap(),
        b"1234"
    );
}

#[test]
fn directory_handle_survives_root_replacement() {
    let root = tempfile::tempdir().unwrap();
    let selected = root.path().join("selected");
    fs::create_dir(&selected).unwrap();
    fs::write(selected.join("input"), b"authorized").unwrap();
    let reader = ReadDirectory::open(&selected).unwrap();
    fs::rename(&selected, root.path().join("original")).unwrap();
    fs::create_dir(&selected).unwrap();
    fs::write(selected.join("input"), b"replacement").unwrap();
    assert_eq!(reader.read(Path::new("input"), 32).unwrap(), b"authorized");
}

#[cfg(unix)]
#[test]
fn final_and_ancestor_symlinks_cannot_expose_even_valid_external_bytes() {
    use std::os::unix::fs::symlink;
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("input"), b"external").unwrap();
    symlink(outside.path().join("input"), root.path().join("input")).unwrap();
    symlink(outside.path(), root.path().join("linked")).unwrap();
    assert!(read_regular(&root.path().join("input"), 32).is_err());
    assert!(read_beneath(root.path(), Path::new("input"), 32).is_err());
    assert!(read_beneath(root.path(), Path::new("linked/input"), 32).is_err());
    fs::create_dir(root.path().join("real")).unwrap();
    fs::write(root.path().join("real/input"), b"internal").unwrap();
    symlink("real", root.path().join("internal-link")).unwrap();
    assert!(read_beneath(root.path(), Path::new("internal-link/input"), 32).is_err());
}

#[cfg(unix)]
#[test]
fn fifo_without_writer_and_devices_are_rejected_without_reading() {
    let root = tempfile::tempdir().unwrap();
    let fifo = root.path().join("fifo");
    assert!(
        std::process::Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .unwrap()
            .success()
    );
    // A deadline prevents a regression in open flags from hanging the suite.
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || sender.send(read_regular(&fifo, 32).is_err()).unwrap());
    assert!(
        receiver
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap()
    );
    assert!(read_regular(Path::new("/dev/zero"), 32).is_err());
    assert!(read_regular(Path::new("/dev/null"), 32).is_err());
}

#[test]
fn experiment_config_cannot_allocate_from_an_unbounded_document() {
    let root = tempfile::tempdir().unwrap();
    let file = fs::File::create(root.path().join("experiment.json")).unwrap();
    file.set_len(1_048_577).unwrap();
    let error = ace_runner::load_config(root.path())
        .unwrap_err()
        .to_string();
    assert!(error.contains("byte budget"), "{error}");
}
