import { DEVNET_PROGRAM_ID, Raydium, TickUtil, TxVersion } from "@raydium-io/raydium-sdk-v2";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const POOL_ID = process.argv[2] ?? "HGuzZ8Ee9sCnHF7i5XUBRfT5yFNe37HavsACLGzAQdDA";
const KEYPAIR_PATH = process.env.KEYPAIR ?? join(homedir(), ".config/solana/id.json");
const RPC_URL = "https://api.devnet.solana.com";
const BASE_AMOUNT_TOKENS = 10_000;
const LOWER_PRICE = new Decimal("0.5");
const UPPER_PRICE = new Decimal("2");

async function confirm(message: string): Promise<boolean> {
  const terminal = createInterface({ input, output });
  try { return (await terminal.question(`${message} Type yes to continue: `)).trim().toLowerCase() === "yes"; }
  finally { terminal.close(); }
}

async function main() {
  const owner = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(KEYPAIR_PATH, "utf8"))));
  const connection = new Connection(RPC_URL, "confirmed");
  const balance = await connection.getBalance(owner.publicKey);
  if (balance < 0.5 * LAMPORTS_PER_SOL) throw new Error("The wallet needs devnet SOL for the CLMM position and rent.");
  const raydium = await Raydium.load({ connection, owner, cluster: "devnet", disableFeatureCheck: true, disableLoadToken: true });
  if (!DEVNET_PROGRAM_ID.CLMM_PROGRAM_ID.equals(new PublicKey("DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH"))) throw new Error("Unexpected Raydium devnet CLMM program ID.");
  const poolId = new PublicKey(POOL_ID);
  // getPoolInfoFromRpc calls Object.values() on the tick-array result and
  // throws when a newly initialized pool has no positions yet. Simple pool
  // info is enough to open the first position and works for an empty pool.
  const { poolInfo, rpcData } = await raydium.clmm.getSimplePoolInfo(poolId);
  const poolKeys = {
    vault: {
      A: rpcData.vaultA.toBase58(),
      B: rpcData.vaultB.toBase58(),
    },
  };
  if (!new PublicKey(poolInfo.programId).equals(DEVNET_PROGRAM_ID.CLMM_PROGRAM_ID)) throw new Error("The selected pool is not a devnet Raydium CLMM pool.");
  const decimals = poolInfo.mintA.decimals;
  const amount = new BN(BASE_AMOUNT_TOKENS).mul(new BN(10).pow(new BN(decimals)));
  const lowerTick = TickUtil.toTickIndex(TickUtil.priceToTick(LOWER_PRICE, decimals, poolInfo.mintB.decimals), poolInfo.config.tickSpacing);
  const upperTick = TickUtil.toTickIndex(TickUtil.priceToTick(UPPER_PRICE, decimals, poolInfo.mintB.decimals), poolInfo.config.tickSpacing);
  console.log(`Wallet: ${owner.publicKey.toBase58()}`);
  console.log(`Pool: ${poolId.toBase58()}`);
  console.log(`Pair: ${poolInfo.mintA.address}/${poolInfo.mintB.address}`);
  console.log(`Initial range: ${LOWER_PRICE.toString()} to ${UPPER_PRICE.toString()} B per A`);
  console.log(`Base deposit: ${BASE_AMOUNT_TOKENS} token A; maximum other side: ${BASE_AMOUNT_TOKENS * 2} token B`);
  console.log("This creates a small test liquidity position so the Week 12 vault swap has liquidity to trade against.");
  if (!(await confirm("Open this test position on devnet?"))) { console.log("Cancelled. No transaction was sent."); return; }

  const { execute, extInfo } = await raydium.clmm.openPositionFromBase({
    poolInfo,
    poolKeys,
    tickLower: Math.min(lowerTick, upperTick),
    tickUpper: Math.max(lowerTick, upperTick),
    base: "MintA",
    ownerInfo: { useSOLBalance: true },
    liquidity: new BN(0),
    baseAmount: amount,
    otherAmountMax: amount.muln(2),
    nft2022: true,
    txVersion: TxVersion.V0,
  });
  const { txId } = await execute({ sendAndConfirm: true });
  console.log(`Position transaction: https://explorer.solana.com/tx/${txId}?cluster=devnet`);
  console.log(`Position NFT: https://explorer.solana.com/address/${extInfo.nftMint.toBase58()}?cluster=devnet`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
