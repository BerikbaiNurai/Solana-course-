import { DEVNET_PROGRAM_ID, Raydium, TxVersion } from "@raydium-io/raydium-sdk-v2";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import Decimal from "decimal.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

type SavedMints = { cluster: string; owner: string; tokens: { symbol: string; name: string; address: string; decimals: number }[] };
const RPC_URL = "https://api.devnet.solana.com";
const KEYPAIR_PATH = process.env.KEYPAIR ?? join(homedir(), ".config/solana/id.json");
const MINTS_PATH = resolve(".week11-mints.json");

async function confirm(question: string): Promise<boolean> {
  const terminal = createInterface({ input, output });
  try {
    return (await terminal.question(`${question} Type yes to continue: `)).trim().toLowerCase() === "yes";
  } finally {
    terminal.close();
  }
}

async function main() {
  const saved = JSON.parse(readFileSync(MINTS_PATH, "utf8")) as SavedMints;
  if (saved.cluster !== "devnet" || saved.tokens.length !== 2) throw new Error("Expected two devnet mints in .week11-mints.json.");
  const owner = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(KEYPAIR_PATH, "utf8"))));
  if (owner.publicKey.toBase58() !== saved.owner) throw new Error("The configured wallet differs from the mint-creation wallet. Set KEYPAIR to the same wallet.");
  const connection = new Connection(RPC_URL, "confirmed");
  const balance = await connection.getBalance(owner.publicKey);
  console.log(`Cluster: devnet (${RPC_URL})`);
  console.log(`Wallet: ${owner.publicKey.toBase58()} (${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL)`);
  console.log(`Raydium CLMM program: ${DEVNET_PROGRAM_ID.CLMM_PROGRAM_ID.toBase58()}`);
  for (const token of saved.tokens) console.log(`${token.symbol} mint: ${token.address}`);
  if (balance < 0.05 * LAMPORTS_PER_SOL) throw new Error("The wallet needs more devnet SOL for pool account rent and transaction fees.");
  if (!(await confirm("Initialize the Raydium CLMM pool at an initial price of 1 W11A = 1 W11B?"))) {
    console.log("Cancelled. No pool transaction was sent.");
    return;
  }

  const raydium = await Raydium.load({ connection, owner, cluster: "devnet", disableFeatureCheck: true, disableLoadToken: true, blockhashCommitment: "confirmed" });
  const configs = await raydium.api.getClmmConfigs();
  if (!configs.length) throw new Error("Raydium returned no devnet CLMM fee configurations.");
  const feeConfig = configs[0];
  const indexBytes = Buffer.alloc(2);
  indexBytes.writeUInt16BE(feeConfig.index);
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("amm_config"), indexBytes], DEVNET_PROGRAM_ID.CLMM_PROGRAM_ID);
  const configAccount = await connection.getAccountInfo(configPda, "confirmed");
  if (!configAccount) throw new Error(`Fee config PDA ${configPda.toBase58()} (index ${feeConfig.index}) was not found on devnet.`);
  const apiToken = (token: SavedMints["tokens"][number]) => ({
    chainId: 101,
    address: token.address,
    programId: TOKEN_PROGRAM_ID.toBase58(),
    logoURI: "",
    symbol: token.symbol,
    name: token.name,
    decimals: token.decimals,
    tags: [],
    extensions: {},
  });

  const { execute, extInfo } = await raydium.clmm.createPool({
    programId: DEVNET_PROGRAM_ID.CLMM_PROGRAM_ID,
    mint1: apiToken(saved.tokens[0]),
    mint2: apiToken(saved.tokens[1]),
    ammConfig: { ...feeConfig, id: configPda, fundOwner: "", description: `Raydium devnet fee tier ${feeConfig.index}` },
    initialPrice: new Decimal(1),
    txVersion: TxVersion.V0,
  });
  const poolId = extInfo.address.id;
  console.log(`Fee tier: ${feeConfig.index}; trade fee rate: ${feeConfig.tradeFeeRate}; tick spacing: ${feeConfig.tickSpacing}`);
  console.log(`CLMM config PDA: ${configPda.toBase58()}`);
  console.log(`Pool address: ${poolId}`);
  if (!(await confirm("Send the pool-initialization transaction to devnet?"))) {
    console.log("Cancelled. The pool transaction was not sent.");
    return;
  }
  const { txId } = await execute({ sendAndConfirm: true });
  console.log(`Pool transaction: https://explorer.solana.com/tx/${txId}?cluster=devnet`);
  console.log(`Pool Explorer: https://explorer.solana.com/address/${poolId}?cluster=devnet`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
