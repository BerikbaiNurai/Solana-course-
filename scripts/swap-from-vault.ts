import * as anchor from "@coral-xyz/anchor";
import { DEVNET_PROGRAM_ID, getPdaExBitmapAccount, getPdaObservationAccount, Raydium, swapInternal, TickArrayBitmapExtensionLayout } from "@raydium-io/raydium-sdk-v2";
import { getAccount, getOrCreateAssociatedTokenAccount, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const RPC_URL = "https://api.devnet.solana.com";
const KEYPAIR_PATH = process.env.KEYPAIR ?? join(homedir(), ".config/solana/id.json");

function toBaseUnits(value: string, decimals: number): BN {
  if (!/^\d+(\.\d+)?$/.test(value)) throw new Error("Amount must be a positive decimal number.");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) throw new Error(`Amount has more than ${decimals} decimal places.`);
  return new BN(whole).mul(new BN(10).pow(new BN(decimals))).add(new BN(fraction.padEnd(decimals, "0") || "0"));
}

async function confirm(message: string): Promise<boolean> {
  const terminal = createInterface({ input, output });
  try { return (await terminal.question(`${message} Type yes to continue: `)).trim().toLowerCase() === "yes"; }
  finally { terminal.close(); }
}

async function main() {
  const [poolIdArgument, inputMintArgument, outputMintArgument, amountArgument, slippageArgument = "100"] = process.argv.slice(2);
  if (!poolIdArgument || !inputMintArgument || !outputMintArgument || !amountArgument) {
    throw new Error("Usage: yarn swap:devnet <POOL_ID> <INPUT_MINT> <OUTPUT_MINT> <AMOUNT_IN> [SLIPPAGE_BPS]");
  }
  const slippageBps = Number(slippageArgument);
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps >= 10_000) throw new Error("SLIPPAGE_BPS must be an integer from 1 through 9999.");

  const owner = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(KEYPAIR_PATH, "utf8"))));
  const connection = new Connection(RPC_URL, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(owner), { commitment: "confirmed" });
  anchor.setProvider(provider);
  const idl = JSON.parse(readFileSync("idl/liquidity_vault.json", "utf8"));
  idl.address = "7deCasDiUCe9D4T4QD8RYMzxMameRDpeE1yZAv4J3o4S";
  const program = new anchor.Program(idl, provider);
  const inputMint = new PublicKey(inputMintArgument);
  const outputMint = new PublicKey(outputMintArgument);
  const poolId = new PublicKey(poolIdArgument);

  const raydium = await Raydium.load({ connection, owner, cluster: "devnet", disableFeatureCheck: true, disableLoadToken: true });
  // Use the simple RPC path: getPoolInfoFromRpc throws on a pool with no
  // initialized tick arrays, which is exactly the case before seeding liquidity.
  const { poolInfo, rpcData: poolRpcData } = await raydium.clmm.getSimplePoolInfo(poolId);
  if (!new PublicKey(poolInfo.programId).equals(DEVNET_PROGRAM_ID.CLMM_PROGRAM_ID)) throw new Error("The selected pool is not a devnet Raydium CLMM pool.");
  const mintA = new PublicKey(poolInfo.mintA.address);
  const mintB = new PublicKey(poolInfo.mintB.address);
  const zeroForOne = inputMint.equals(mintA);
  const isPair = (zeroForOne && outputMint.equals(mintB)) || (!zeroForOne && inputMint.equals(mintB) && outputMint.equals(mintA));
  if (!isPair) throw new Error("Input and output mints must be the two mints in the selected CLMM pool.");
  const inputDecimals = zeroForOne ? poolInfo.mintA.decimals : poolInfo.mintB.decimals;
  const amountIn = toBaseUnits(amountArgument, inputDecimals);
  if (amountIn.isZero()) throw new Error("Amount in must be greater than zero.");

  const { rpcData, configInfo, tickArrays } = await raydium.clmm.getSwapPoolInfo(poolId, zeroForOne);
  const programId = new PublicKey(poolInfo.programId);
  const bitmapAddress = getPdaExBitmapAccount(programId, poolId).publicKey;
  const bitmapAccount = await connection.getAccountInfo(bitmapAddress, "confirmed");
  if (!bitmapAccount) throw new Error("The pool tick-array bitmap extension was not found; check the pool and its devnet state.");
  const quote = swapInternal({
    programId,
    poolId,
    poolInfo: rpcData,
    tickArrays,
    configInfo,
    tickarrayBitmapExtension: TickArrayBitmapExtensionLayout.decode(bitmapAccount.data),
    amountSpecified: amountIn,
    sqrtPriceLimitX64: new BN(0),
    zeroForOne,
    isBaseInput: true,
    blockTimestamp: Math.floor(Date.now() / 1000),
    includeExtraTickArrays: true,
  });
  if (!quote.allTrade || !quote.amountSpecifiedRemaining.isZero() || quote.amountCalculated.isZero()) {
    throw new Error("The current pool liquidity cannot fill the requested exact-input swap.");
  }
  const minAmountOut = quote.amountCalculated.muln(10_000 - slippageBps).divn(10_000);
  if (minAmountOut.isZero()) throw new Error("The minimum output rounded down to zero.");

  const [vaultState] = PublicKey.findProgramAddressSync([Buffer.from("vault"), inputMint.toBuffer()], program.programId);
  const [tokenVault] = PublicKey.findProgramAddressSync([Buffer.from("token_vault"), inputMint.toBuffer()], program.programId);
  const [shareMint] = PublicKey.findProgramAddressSync([Buffer.from("share_mint"), inputMint.toBuffer()], program.programId);
  const user = owner.publicKey;
  const [userCard] = PublicKey.findProgramAddressSync([Buffer.from("user_card"), vaultState.toBuffer(), user.toBuffer()], program.programId);
  const userShareAccount = await getOrCreateAssociatedTokenAccount(connection, owner, shareMint, user);
  const userOutputTokenAccount = await getOrCreateAssociatedTokenAccount(connection, owner, outputMint, user);
  const outputBefore = (await getAccount(connection, userOutputTokenAccount.address)).amount;

  console.log(`Wallet: ${user.toBase58()}`);
  console.log(`Pool: ${poolId.toBase58()}`);
  console.log(`Swap: ${amountArgument} ${inputMint.toBase58()} exact input into ${outputMint.toBase58()}`);
  console.log(`Expected output: ${quote.amountCalculated.toString()} base units`);
  console.log(`Slippage limit: ${slippageBps} bps; minimum output: ${minAmountOut.toString()} base units`);
  console.log("The program burns the corresponding shares, swaps from the vault PDA, and sends output tokens to the signer. Raydium rejects output below the minimum.");
  if (!(await confirm("Submit the vault-to-CLMM swap on devnet?"))) { console.log("Cancelled. No swap transaction was sent."); return; }

  const accounts = quote.accounts.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true }));
  const signature = await program.methods.swapFromVault(amountIn, minAmountOut).accounts({
    vaultState,
    inputMint,
    tokenVault,
    shareMint,
    userShareAccount: userShareAccount.address,
    userOutputTokenAccount: userOutputTokenAccount.address,
    outputMint,
    userCard,
    user,
    ammConfig: new PublicKey(poolInfo.config.id),
    poolState: poolId,
    poolTokenVault0: poolRpcData.vaultA,
    poolTokenVault1: poolRpcData.vaultB,
    poolMint0: mintA,
    poolMint1: mintB,
    observationState: getPdaObservationAccount(programId, poolId).publicKey,
    clmmProgram: programId,
    tokenProgram: TOKEN_PROGRAM_ID,
    tokenProgram2022: TOKEN_2022_PROGRAM_ID,
    memoProgram: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
  }).remainingAccounts(accounts).rpc();
  const outputAfter = (await getAccount(connection, userOutputTokenAccount.address)).amount;
  console.log(`Swap transaction: https://explorer.solana.com/tx/${signature}?cluster=devnet`);
  console.log(`Output received: ${(outputAfter - outputBefore).toString()} base units`);
  console.log(`Minimum required: ${minAmountOut.toString()} base units`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
