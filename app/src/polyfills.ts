import { Buffer } from "buffer";

// Solana's browser dependencies expect Buffer to be available globally.
Object.assign(globalThis, { Buffer });
