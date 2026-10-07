#![no_std]

#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! { core::arch::wasm32::unreachable() }

#[unsafe(no_mangle)]
pub extern "C" fn gcd(mut a: u32, mut b: u32) -> u32 {
    if a == 0 { return b; } if b == 0 { return a; } let mut f = 1; for p in [2, 3, 5, 7, 11] { while a % p == 0 && b % p == 0 { a /= p; b /= p; f *= p; } } while b != 0 { let r = a % b; a = b; b = r; } a * f
}
