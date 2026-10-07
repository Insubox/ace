#![no_std]

#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! { core::arch::wasm32::unreachable() }

#[unsafe(no_mangle)]
pub extern "C" fn gcd(mut a: u32, mut b: u32) -> u32 {
    while b > 16 { let r = a % b; a = b; b = r; } if b == 0 { return a; } a %= b; if a == 0 { return b; } while a != b { if a > b { a -= b; } else { b -= a; } } a
}
