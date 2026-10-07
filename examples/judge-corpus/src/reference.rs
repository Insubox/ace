#![no_std]

#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! { core::arch::wasm32::unreachable() }

#[unsafe(no_mangle)]
pub extern "C" fn gcd(mut a: u32, mut b: u32) -> u32 {
    if a == 0 { return b; } if b == 0 { return a; } if a.min(b) <= 4096 { let mut best = 1; for d in 1..=a.min(b) { if a % d == 0 && b % d == 0 { best = d; } } return best; } while b != 0 { let r = a % b; a = b; b = r; } a
}
