import * as anchor from "@coral-xyz/anchor";
import { getAccount, getOrCreateAssociatedTokenAccount, getMint } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { readFileSync } from "node:fs";

function toBaseUnits(value: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new Error("Amount must be a positive decimal number, for example 1.25");
  }
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) {
    throw new Error(`Amount has more than ${decimals} decimal places`);
  }
  return BigInt(whole) * 10n ** BigInt(decimals)
    + BigInt(fraction.padEnd(decimals, "0") || "0");
}

async function main() {
  const [mintArgument, sharesArgument] = process.argv.slice(2);
  if (!mintArgument || !sharesArgument) {
    throw new Error("Usage: yarn withdraw:devnet <TOKEN_MINT_ADDRESS> <SHARES_TO_BURN>");
  }

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const payer = (provider.wallet as anchor.Wallet).payer;
  const user = provider.wallet.publicKey;
  const tokenMint = new PublicKey(mintArgument);
  const idl = JSON.parse(readFileSync("target/idl/liquidity_vault.json", "utf8"));
  const program = new anchor.Program(idl, provider);
  const [vaultState] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), tokenMint.toBuffer()], program.programId,
  );
  const vault = await (program.account as any).vaultState.fetch(vaultState);
  const shareMint = vault.shareMint as PublicKey;
  const [tokenInfo, shareInfo] = await Promise.all([
    getMint(provider.connection, tokenMint),
    getMint(provider.connection, shareMint),
  ]);
  if (tokenInfo.decimals !== shareInfo.decimals) {
    throw new Error("The vault share mint has different decimals from its accepted token mint");
  }
  const shares = toBaseUnits(sharesArgument, shareInfo.decimals);
  if (shares <= 0n) throw new Error("Shares to burn must be greater than zero");

  const userTokenAccount = await getOrCreateAssociatedTokenAccount(
    provider.connection, payer, tokenMint, user,
  );
  const userShareAccount = await getOrCreateAssociatedTokenAccount(
    provider.connection, payer, shareMint, user,
  );
  const shareBalance = await getAccount(provider.connection, userShareAccount.address);
  if (shareBalance.amount < shares) {
    throw new Error(`Not enough shares: wallet has ${shareBalance.amount} base units`);
  }
  const [userCard] = PublicKey.findProgramAddressSync(
    [Buffer.from("user_card"), vaultState.toBuffer(), user.toBuffer()],
    program.programId,
  );
  if (!(await provider.connection.getAccountInfo(userCard))) {
    throw new Error("No user card found. Run the Week 10 setup and deposit first.");
  }

  const signature = await (program.methods as any)
    .withdraw(new anchor.BN(shares.toString()))
    .accounts({
      vaultState,
      tokenMint,
      userCard,
      tokenVault: vault.tokenVault,
      shareMint,
      userTokenAccount: userTokenAccount.address,
      userShareAccount: userShareAccount.address,
      user,
    })
    .rpc();

  const [tokensAfter, sharesAfter] = await Promise.all([
    getAccount(provider.connection, userTokenAccount.address),
    getAccount(provider.connection, userShareAccount.address),
  ]);
  console.log(`Withdrawal transaction: https://explorer.solana.com/tx/${signature}?cluster=devnet`);
  console.log(`User token account: ${userTokenAccount.address} (${tokensAfter.amount} base units)`);
  console.log(`User share account: ${userShareAccount.address} (${sharesAfter.amount} base units)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
