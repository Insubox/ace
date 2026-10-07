#![no_std]

#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! { core::arch::wasm32::unreachable() }

#[unsafe(no_mangle)]
pub extern "C" fn gcd(mut a: u32, mut b: u32) -> u32 {
    if a != 0 && b != 0 && a & 1 == 0 && b & 1 == 0 { a /= 2; b /= 2; while b != 0 { let r = a % b; a = b; b = r; } return a; } while b != 0 { let r = a % b; a = b; b = r; } a
}
