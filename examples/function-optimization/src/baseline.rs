#![no_std]

#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! { core::arch::wasm32::unreachable() }

#[unsafe(no_mangle)]
pub extern "C" fn gcd(a: u32, b: u32) -> u32 {
    if a == 0 { return b; }
    if b == 0 || a == b { return a; }
    let mut answer = 1;
    let mut divisor = 1;
    while divisor <= a.min(b) {
        if a % divisor == 0 && b % divisor == 0 { answer = divisor; }
        divisor += 1;
    }
    answer
}
