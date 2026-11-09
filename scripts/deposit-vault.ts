import * as anchor from "@coral-xyz/anchor";
import {
  getAccount,
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { readFileSync } from "node:fs";

function toBaseUnits(value: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new Error("Amount must be a positive decimal number, for example 2.5");
  }
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) {
    throw new Error(`Amount has more than ${decimals} decimal places`);
  }
  return BigInt(whole) * 10n ** BigInt(decimals)
    + BigInt(fraction.padEnd(decimals, "0") || "0");
}

async function main() {
  const [mintArgument, amountArgument, ...flags] = process.argv.slice(2);
  if (!mintArgument || !amountArgument || flags.some((flag) => flag !== "--mint-demo")) {
    throw new Error(
      "Usage: yarn deposit:devnet <TOKEN_MINT_ADDRESS> <AMOUNT> [--mint-demo]",
    );
  }

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const payer = (provider.wallet as anchor.Wallet).payer;
  const user = provider.wallet.publicKey;
  const tokenMint = new PublicKey(mintArgument);
  const idl = JSON.parse(readFileSync("target/idl/liquidity_vault.json", "utf8"));
  const program = new anchor.Program(idl, provider);
  const [vaultState] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), tokenMint.toBuffer()],
    program.programId,
  );
  const vault = await (program.account as any).vaultState.fetch(vaultState);
  const shareMint = vault.shareMint as PublicKey;
  const tokenAmountInfo = await getMint(provider.connection, tokenMint);
  const shareMintInfo = await getMint(provider.connection, shareMint);
  if (tokenAmountInfo.decimals !== shareMintInfo.decimals) {
    throw new Error("The vault's share mint decimals do not match the accepted token mint");
  }
  const amount = toBaseUnits(amountArgument, tokenAmountInfo.decimals);
  if (amount <= 0n) throw new Error("Amount must be greater than zero");

  const userTokenAccount = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    tokenMint,
    user,
  );
  const userShareAccount = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    shareMint,
    user,
  );

  if (flags.includes("--mint-demo")) {
    if (!tokenAmountInfo.mintAuthority?.equals(user)) {
      throw new Error("--mint-demo requires this wallet to be the accepted token mint authority");
    }
    await mintTo(
      provider.connection,
      payer,
      tokenMint,
      userTokenAccount.address,
      user,
      amount,
    );
  }

  const [userCard] = PublicKey.findProgramAddressSync(
    [Buffer.from("user_card"), vaultState.toBuffer(), user.toBuffer()],
    program.programId,
  );
  if (!(await provider.connection.getAccountInfo(userCard))) {
    await program.methods.createUserCard().accounts({
      vaultState,
      userCard,
      user,
    }).rpc();
  }

  const signature = await program.methods.deposit(new anchor.BN(amount.toString())).accounts({
    vaultState,
    tokenMint,
    userCard,
    tokenVault: vault.tokenVault,
    shareMint,
    userTokenAccount: userTokenAccount.address,
    userShareAccount: userShareAccount.address,
    user,
  }).rpc();

  const [tokensAfter, sharesAfter] = await Promise.all([
    getAccount(provider.connection, userTokenAccount.address),
    getAccount(provider.connection, userShareAccount.address),
  ]);
  console.log(`Deposit transaction: https://explorer.solana.com/tx/${signature}?cluster=devnet`);
  console.log(`User token account: ${userTokenAccount.address} (${tokensAfter.amount} base units remain)`);
  console.log(`User share account: ${userShareAccount.address} (${sharesAfter.amount} base units)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
