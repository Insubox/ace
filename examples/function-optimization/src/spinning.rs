#![no_std]

#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! { core::arch::wasm32::unreachable() }

#[unsafe(no_mangle)]
pub extern "C" fn gcd(mut a: u32, _: u32) -> u32 {
    loop { a = a.wrapping_add(1); core::hint::black_box(a); }
}
