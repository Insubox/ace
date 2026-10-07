#![no_std]

#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! { core::arch::wasm32::unreachable() }

#[unsafe(no_mangle)]
pub extern "C" fn gcd(mut a: u32, mut b: u32) -> u32 {
    if a == 0 || b == 0 { return a | b; }
    let shift = (a | b).trailing_zeros();
    a >>= a.trailing_zeros();
    loop {
        b >>= b.trailing_zeros();
        if a > b { core::mem::swap(&mut a, &mut b); }
        b -= a;
        if b == 0 { return a << shift; }
    }
}
