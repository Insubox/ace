#![no_std]

#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! { core::arch::wasm32::unreachable() }

fn recur(a: u32, b: u32) -> u32 { if b == 0 { a } else { recur(b, a % b) } }

#[unsafe(no_mangle)]
pub extern "C" fn gcd(mut a: u32, mut b: u32) -> u32 {
    recur(a, b)
}
