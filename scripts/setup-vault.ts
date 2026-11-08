import * as anchor from "@coral-xyz/anchor";
import { createMint } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { readFileSync } from "node:fs";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const idl = JSON.parse(readFileSync("target/idl/liquidity_vault.json", "utf8"));
  const program = new anchor.Program(idl, provider);
  const admin = provider.wallet.publicKey;
  const tokenMint = process.argv[2]
    ? new PublicKey(process.argv[2])
    : await createMint(provider.connection, (provider.wallet as anchor.Wallet).payer, admin, null, 6);

  const [vaultState] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), tokenMint.toBuffer()], program.programId
  );
  const [tokenVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_vault"), tokenMint.toBuffer()], program.programId
  );
  const [shareMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("share_mint"), tokenMint.toBuffer()], program.programId
  );
  const [userCard] = PublicKey.findProgramAddressSync(
    [Buffer.from("user_card"), vaultState.toBuffer(), admin.toBuffer()], program.programId
  );

  await program.methods.initializeVault().accounts({
    vaultState, tokenVault, shareMint, tokenMint, admin,
  }).rpc();
  const vaultSignature = await program.methods.createUserCard().accounts({
    vaultState, userCard, user: admin,
  }).rpc();

  console.log(`Program: ${program.programId}`);
  console.log(`Token mint: ${tokenMint}`);
  console.log(`Vault state: ${vaultState}`);
  console.log(`Token vault: ${tokenVault}`);
  console.log(`Share mint: ${shareMint}`);
  console.log(`User card: ${userCard}`);
  console.log(`Explorer: https://explorer.solana.com/address/${vaultState}?cluster=devnet`);
  console.log(`Card transaction: https://explorer.solana.com/tx/${vaultSignature}?cluster=devnet`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
