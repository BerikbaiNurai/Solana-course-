import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";
import {
  PROGRAM_ID,
  VAULT_TOKENS,
  derivePositionController,
  deriveVaultAddresses,
  formatTokenAmount,
  parseTokenAmount,
  readPositionState,
  readU64,
} from "./vault";

test("parses whole and fractional token amounts without floating point", () => {
  assert.equal(parseTokenAmount("12.034005", 6), 12_034_005n);
  assert.equal(parseTokenAmount("0.5", 6), 500_000n);
});

test("rejects invalid amounts and precision beyond the mint decimals", () => {
  for (const value of ["", "-1", "1e3", "1.0000001", "NaN"]) {
    assert.throws(() => parseTokenAmount(value, 6));
  }
});

test("formats token values without losing base-unit precision", () => {
  assert.equal(formatTokenAmount(1_234_500n, 6), "1.2345");
  assert.equal(formatTokenAmount(2_000_000n, 6), "2");
  assert.equal(formatTokenAmount(87n, 6), "0.000087");
});

test("derives the same vault and user-card PDAs as the on-chain program", () => {
  const user = new PublicKey("DLgXdGoVya6j8iL4dnM75JxxbPA31XJLt28kJaUAMi4y");
  const first = deriveVaultAddresses(VAULT_TOKENS[0].mint, user);
  const again = deriveVaultAddresses(VAULT_TOKENS[0].mint, user);
  const second = deriveVaultAddresses(VAULT_TOKENS[1].mint, user);
  assert.equal(first.vaultState.toBase58(), again.vaultState.toBase58());
  assert.notEqual(first.vaultState.toBase58(), second.vaultState.toBase58());
  assert.notEqual(
    first.userCard.toBase58(),
    deriveVaultAddresses(
      VAULT_TOKENS[0].mint,
      PublicKey.default,
    ).userCard.toBase58(),
  );
  assert.equal(
    first.vaultState.toBase58(),
    PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), VAULT_TOKENS[0].mint.toBuffer()],
      PROGRAM_ID,
    )[0].toBase58(),
  );
});

test("derives the deployed CLMM controller PDA for the two course vaults", () => {
  const user = new PublicKey("DLgXdGoVya6j8iL4dnM75JxxbPA31XJLt28kJaUAMi4y");
  const vault0 = deriveVaultAddresses(VAULT_TOKENS[0].mint, user).vaultState;
  const vault1 = deriveVaultAddresses(VAULT_TOKENS[1].mint, user).vaultState;
  assert.equal(
    derivePositionController(
      vault0,
      vault1,
      new PublicKey("3R29TR1M6hmJAPF3QfiKkErMowhEHHpvprRdKecLBSmt"),
    ).toBase58(),
    "Hqyd7ufiFVjUUUQBR1vSdAwvVV7KuDZwVqapzcxpe8rP",
  );
});

test("decodes the documented vault account offsets", () => {
  const data = Buffer.alloc(145);
  data.writeBigUInt64LE(987_654n, 136);
  assert.equal(readU64(data, 136), 987_654n);
  assert.throws(() => readU64(data, 140));
});

test("reads the position ticks and open flag from the Anchor account layout", () => {
  const data = Buffer.alloc(186);
  data.writeInt32LE(-720, 168);
  data.writeInt32LE(300, 172);
  data.writeUInt8(1, 184);
  assert.deepEqual(readPositionState(data), {
    tickLower: -720,
    tickUpper: 300,
    isOpen: true,
  });
});
