#![no_std]

#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! { core::arch::wasm32::unreachable() }

#[unsafe(no_mangle)]
pub extern "C" fn gcd(mut a: u32, mut b: u32) -> u32 {
    if a == 0 { return b; } if b == 0 { return a; } let s = (a | b).trailing_zeros(); a >>= a.trailing_zeros(); loop { b >>= b.trailing_zeros(); let lo = a.min(b); let hi = a.max(b); a = lo; b = hi - lo; if b == 0 { return a << s; } }
}
