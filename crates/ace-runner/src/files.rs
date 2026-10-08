//! Bounded reads of regular files. Untrusted relative paths are resolved from
//! held directory handles, never by checking a pathname and reopening it.
use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt, OpenOptionsSyncExt};
use cap_std::{
    ambient_authority,
    fs::{Dir, File, OpenOptions},
};
use std::{
    io::{self, Read},
    path::{Component, Path},
};

/// The caller authorizes this root. Every child component must be a real
/// directory/file; links, absolute paths and parent traversal are rejected.
pub struct ReadDirectory(Dir);

/// Validate manifest paths before any filesystem access. Opening still uses
/// directory capabilities; lexical validation alone is not a symlink defense.
pub fn validate_relative(relative: &Path) -> io::Result<()> {
    if relative.as_os_str().is_empty()
        || relative
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "file path must contain only relative normal components",
        ));
    }
    Ok(())
}

impl ReadDirectory {
    pub fn open(root: &Path) -> io::Result<Self> {
        Ok(Self(Dir::open_ambient_dir(root, ambient_authority())?))
    }

    pub fn read(&self, relative: &Path, limit: u64) -> io::Result<Vec<u8>> {
        validate_relative(relative)?;
        let components = relative
            .components()
            .map(|component| match component {
                Component::Normal(name) => Ok(name),
                _ => Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "file path must contain only relative normal components",
                )),
            })
            .collect::<io::Result<Vec<_>>>()?;
        let (name, parents) = components
            .split_last()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "empty file path"))?;
        let mut directory = self.0.try_clone()?;
        for parent in parents {
            directory = directory.open_dir_nofollow(parent)?;
        }
        let mut options = OpenOptions::new();
        options.read(true).follow(FollowSymlinks::No).nonblock(true);
        let file = directory.open_with(name, &options)?;
        read_opened(file, limit)
    }
}

fn read_opened(file: File, limit: u64) -> io::Result<Vec<u8>> {
    let metadata = file.metadata()?;
    if !metadata.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "input must be a regular file",
        ));
    }
    let budget = limit
        .checked_add(1)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "invalid byte budget"))?;
    if metadata.len() > limit {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "file exceeds byte budget",
        ));
    }
    let mut bytes = Vec::new();
    file.take(budget).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "file exceeds byte budget",
        ));
    }
    Ok(bytes)
}

/// Read an explicitly selected CLI file. Its parent is authorized by the
/// caller; the final component still cannot be a symlink or special file.
pub fn read_regular(path: &Path, limit: u64) -> io::Result<Vec<u8>> {
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let name = path
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "expected a file path"))?;
    ReadDirectory::open(parent)?.read(Path::new(name), limit)
}

pub fn read_beneath(root: &Path, relative: &Path, limit: u64) -> io::Result<Vec<u8>> {
    ReadDirectory::open(root)?.read(relative, limit)
}
