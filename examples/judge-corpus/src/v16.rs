#![no_std]

#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! { core::arch::wasm32::unreachable() }

#[unsafe(no_mangle)]
pub extern "C" fn gcd(mut a: u32, mut b: u32) -> u32 {
    a = (a as i32).unsigned_abs(); b = (b as i32).unsigned_abs(); while b != 0 { let r = a % b; a = b; b = r; } a
}
