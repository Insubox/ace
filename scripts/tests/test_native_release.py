"""Negative delivery checks: refuse other hosts and mislabeled executables."""
import importlib.util
from pathlib import Path
import struct
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


package = load("package-release")
release = load("native-release")


class NativeDelivery(unittest.TestCase):
    def test_host_selection_does_not_turn_linux_into_macos(self):
        self.assertEqual(release.native_target("Linux", "x86_64"), "x86_64-unknown-linux-musl")
        with self.assertRaises(ValueError):
            release.native_target("Linux", "arm64")

    def test_elf_cannot_be_published_as_macos_or_windows(self):
        elf = bytearray(64)
        elf[:6] = b"\x7fELF\x02\x01"
        struct.pack_into("<H", elf, 18, 62)
        with tempfile.TemporaryDirectory() as folder:
            binary = Path(folder) / "binary"
            binary.write_bytes(elf)
            package.validate_executable(binary, "x86_64-unknown-linux-musl")
            for target in ["x86_64-apple-darwin", "aarch64-apple-darwin", "x86_64-pc-windows-msvc"]:
                with self.subTest(target=target), self.assertRaises(ValueError):
                    package.validate_executable(binary, target)

    def test_macos_arm_binary_cannot_be_labeled_intel_or_library(self):
        header = bytearray(32)
        header[:4] = b"\xcf\xfa\xed\xfe"
        struct.pack_into("<I", header, 4, 0x0100000C)
        struct.pack_into("<I", header, 12, 2)
        with tempfile.TemporaryDirectory() as folder:
            binary = Path(folder) / "ace"
            binary.write_bytes(header)
            package.validate_executable(binary, "aarch64-apple-darwin")
            with self.assertRaises(ValueError):
                package.validate_executable(binary, "x86_64-apple-darwin")
            struct.pack_into("<I", header, 12, 6)
            binary.write_bytes(header)
            with self.assertRaises(ValueError):
                package.validate_executable(binary, "aarch64-apple-darwin")

    def test_pe_rejects_32bit_and_unbounded_header_offset(self):
        header = bytearray(90)
        header[:2] = b"MZ"
        struct.pack_into("<I", header, 60, 64)
        header[64:68] = b"PE\0\0"
        struct.pack_into("<H", header, 68, 0x8664)
        struct.pack_into("<H", header, 88, 0x20B)
        with tempfile.TemporaryDirectory() as folder:
            binary = Path(folder) / "ace.exe"
            binary.write_bytes(header)
            package.validate_executable(binary, "x86_64-pc-windows-msvc")
            for offset, machine, magic in [(64, 0x14C, 0x10B), (10000000, 0x8664, 0x20B)]:
                struct.pack_into("<I", header, 60, offset)
                struct.pack_into("<H", header, 68, machine)
                struct.pack_into("<H", header, 88, magic)
                binary.write_bytes(header)
                with self.assertRaises(ValueError):
                    package.validate_executable(binary, "x86_64-pc-windows-msvc")


if __name__ == "__main__":
    unittest.main()
