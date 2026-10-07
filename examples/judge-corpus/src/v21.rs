#![no_std]

#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! { core::arch::wasm32::unreachable() }

#[unsafe(no_mangle)]
pub extern "C" fn gcd(mut a: u32, mut b: u32) -> u32 {
    if a == 0 { return b; } if b == 0 { return a; } if a == b { return a; } if a % 3 == 0 && b % 3 == 0 { return 3; } while b != 0 { let r = a % b; a = b; b = r; } a
}
