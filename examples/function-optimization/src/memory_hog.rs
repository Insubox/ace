#![no_std]

#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! { core::arch::wasm32::unreachable() }

#[unsafe(no_mangle)]
pub extern "C" fn gcd(mut a: u32, mut b: u32) -> u32 {
    let _ = core::arch::wasm32::memory_grow::<0>(100);
    while b != 0 { let remainder = a % b; a = b; b = remainder; }
    a
}
