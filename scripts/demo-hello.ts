// Stage 00 demo: proves tsx can run TypeScript directly under Node.
// Run with: npm run demo:hello

const RAM_SIZE = 0x8000; // Model B: 32K of RAM, &0000-&7FFF
const ram = new Uint8Array(RAM_SIZE);

// A Uint8Array stores bytes, so it wraps on write, just like the hardware...
ram[0] = 0xff + 1;

// ...but plain JS numbers don't. That's why we will mask everything (Stage 01).
const unmasked = 0xff + 1;
const masked = (0xff + 1) & 0xff;

console.log('Hello from the BBC Micro emulator toolchain!');
console.log(`Node ${process.version}, running TypeScript via tsx`);
console.log(`RAM: ${String(ram.length)} bytes (&0000-&${(ram.length - 1).toString(16).toUpperCase()})`);
console.log(`&FF + 1 as a plain number : ${String(unmasked)}`);
console.log(`&FF + 1 masked with & &FF : ${String(masked)}`);
console.log(`&FF + 1 stored in RAM[0]  : ${String(ram[0])}`);
