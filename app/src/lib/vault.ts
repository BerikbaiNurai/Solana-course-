import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey(
  "7deCasDiUCe9D4T4QD8RYMzxMameRDpeE1yZAv4J3o4S",
);
export const POOL_ID = new PublicKey(
  "3R29TR1M6hmJAPF3QfiKkErMowhEHHpvprRdKecLBSmt",
);

export const VAULT_TOKENS = [
  {
    symbol: "W11A",
    name: "Token A",
    mint: new PublicKey("7S6KLpGa4HjC4BtuQKsrmufKcUtky7WTn7jwDM1Pnj2E"),
    decimals: 6,
  },
  {
    symbol: "W11B",
    name: "Token B",
    mint: new PublicKey("HxxdDXKJN3n3kWfutQ1PjTkHXFHtvHqNz9atwLEu3Kvh"),
    decimals: 6,
  },
] as const;

export function deriveVaultAddresses(mint: PublicKey, owner: PublicKey) {
  const [vaultState] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), mint.toBuffer()],
    PROGRAM_ID,
  );
  const [tokenVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_vault"), mint.toBuffer()],
    PROGRAM_ID,
  );
  const [shareMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("share_mint"), mint.toBuffer()],
    PROGRAM_ID,
  );
  const [userCard] = PublicKey.findProgramAddressSync(
    [Buffer.from("user_card"), vaultState.toBuffer(), owner.toBuffer()],
    PROGRAM_ID,
  );
  return { vaultState, tokenVault, shareMint, userCard };
}

export function derivePositionController(
  vault0: PublicKey,
  vault1: PublicKey,
  pool: PublicKey,
) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("clmm_position"),
      vault0.toBuffer(),
      vault1.toBuffer(),
      pool.toBuffer(),
    ],
    PROGRAM_ID,
  )[0];
}

export function parseTokenAmount(value: string, decimals: number): bigint {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d*)?$/.test(trimmed))
    throw new Error("Enter a positive decimal amount.");
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals)
    throw new Error(`Use no more than ${decimals} decimal places.`);
  return (
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt((fraction || "").padEnd(decimals, "0") || "0")
  );
}

export function formatTokenAmount(
  amount: bigint,
  decimals: number,
  fractionDigits = 6,
): string {
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = (amount % scale).toString().padStart(decimals, "0");
  const visible = fraction
    .slice(0, Math.min(decimals, fractionDigits))
    .replace(/0+$/, "");
  return visible
    ? `${whole.toLocaleString("en-US")}.${visible}`
    : whole.toLocaleString("en-US");
}

export function readU64(data: Buffer, offset: number): bigint {
  if (offset < 0 || offset + 8 > data.length)
    throw new Error("Account data is shorter than expected.");
  return data.readBigUInt64LE(offset);
}

export function readPositionState(data: Buffer) {
  if (data.length < 186)
    throw new Error("Position account data is shorter than expected.");
  return {
    tickLower: data.readInt32LE(168),
    tickUpper: data.readInt32LE(172),
    isOpen: data.readUInt8(184) === 1,
  };
}
