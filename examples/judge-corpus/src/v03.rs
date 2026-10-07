#![no_std]

#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! { core::arch::wasm32::unreachable() }

#[unsafe(no_mangle)]
pub extern "C" fn gcd(mut a: u32, mut b: u32) -> u32 {
    if a == 0 { return b; } if b == 0 { return a; } let mut s = 0; while (a | b) & 1 == 0 { a >>= 1; b >>= 1; s += 1; } while a & 1 == 0 { a >>= 1; } loop { while b & 1 == 0 { b >>= 1; } if a > b { core::mem::swap(&mut a, &mut b); } b -= a; if b == 0 { return a << s; } }
}
