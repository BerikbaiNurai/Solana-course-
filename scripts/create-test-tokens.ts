import { createMint, getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const RPC_URL = "https://api.devnet.solana.com";
const KEYPAIR_PATH = process.env.KEYPAIR ?? join(homedir(), ".config/solana/id.json");
const OUTPUT_PATH = resolve(".week11-mints.json");
const DECIMALS = 6;
const SUPPLY = 1_000_000n * 10n ** BigInt(DECIMALS);

async function confirm(question: string): Promise<boolean> {
  const terminal = createInterface({ input, output });
  try {
    return (await terminal.question(`${question} Type yes to continue: `)).trim().toLowerCase() === "yes";
  } finally {
    terminal.close();
  }
}

async function main() {
  const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(KEYPAIR_PATH, "utf8"))));
  const connection = new Connection(RPC_URL, "confirmed");
  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`Cluster: devnet (${RPC_URL})`);
  console.log(`Wallet: ${wallet.publicKey.toBase58()}`);
  console.log(`Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log("This script creates two 6-decimal SPL mints and mints 1,000,000 test tokens of each to your wallet.");
  if (balance < 0.05 * LAMPORTS_PER_SOL) throw new Error("The wallet needs more devnet SOL for token accounts and transaction fees. Request an airdrop first.");
  if (existsSync(OUTPUT_PATH)) throw new Error(`${OUTPUT_PATH} already exists. Keep it to resume pool creation; remove it only if you intentionally want new test mints.`);
  if (!(await confirm("Create the two test tokens and mint their supplies on devnet?"))) {
    console.log("Cancelled. No transaction was sent.");
    return;
  }

  const tokens = [];
  for (const [symbol, name] of [["W11A", "Week 11 Test Token A"], ["W11B", "Week 11 Test Token B"]] as const) {
    const mint = await createMint(connection, wallet, wallet.publicKey, null, DECIMALS, undefined, undefined, TOKEN_PROGRAM_ID);
    const ownerAccount = await getOrCreateAssociatedTokenAccount(connection, wallet, mint, wallet.publicKey, false, "confirmed", undefined, TOKEN_PROGRAM_ID);
    const mintSignature = await mintTo(connection, wallet, mint, ownerAccount.address, wallet, SUPPLY, [], { commitment: "confirmed" }, TOKEN_PROGRAM_ID);
    tokens.push({ symbol, name, address: mint.toBase58(), decimals: DECIMALS, tokenAccount: ownerAccount.address.toBase58(), mintSignature });
    console.log(`${symbol} mint: ${mint.toBase58()}`);
    console.log(`${symbol} mint transaction: https://explorer.solana.com/tx/${mintSignature}?cluster=devnet`);
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify({ cluster: "devnet", owner: wallet.publicKey.toBase58(), tokens }, null, 2) + "\n", { mode: 0o600 });
  console.log(`Saved mint addresses to ${OUTPUT_PATH} (local only; this file is gitignored).`);
  console.log("Next: yarn create:clmm-pool:devnet");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
