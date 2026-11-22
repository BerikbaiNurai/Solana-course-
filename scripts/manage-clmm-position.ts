import * as anchor from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { PublicKey, SYSVAR_RENT_PUBKEY, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";
import Decimal from "decimal.js";
import {
  DEVNET_PROGRAM_ID,
  METADATA_PROGRAM_ID,
  TickUtil,
  getPdaMetadataKey,
  getPdaPersonalPositionAddress,
  getPdaProtocolPositionAddress,
  getPdaTickArrayAddress,
} from "@raydium-io/raydium-sdk-v2";
import { readFileSync } from "node:fs";

const RPC_URL = "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("7deCasDiUCe9D4T4QD8RYMzxMameRDpeE1yZAv4J3o4S");
const SEEDS = {
  vault: Buffer.from("vault"),
  tokenVault: Buffer.from("token_vault"),
  shareMint: Buffer.from("share_mint"),
  position: Buffer.from("clmm_position"),
  positionNft: Buffer.from("position_nft"),
};

function pda(seeds: Buffer[]) {
  return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
}

function vaultAccounts(mint: PublicKey) {
  const state = pda([SEEDS.vault, mint.toBuffer()]);
  return {
    state,
    tokenVault: pda([SEEDS.tokenVault, mint.toBuffer()]),
    shareMint: pda([SEEDS.shareMint, mint.toBuffer()]),
  };
}

function positionState(vault0: PublicKey, vault1: PublicKey, pool: PublicKey) {
  return pda([SEEDS.position, vault0.toBuffer(), vault1.toBuffer(), pool.toBuffer()]);
}

function tickArrayStart(tick: number, spacing: number): number {
  const width = spacing * 60;
  return Math.floor(tick / width) * width;
}

async function main() {
  const [action, poolArgument, mint0Argument, mint1Argument, ...args] = process.argv.slice(2);
  if (!action || !poolArgument || !mint0Argument || !mint1Argument) {
    throw new Error(
      "Usage: yarn clmm:position <init|open|collect|close|rebalance> <POOL> <MINT_0> <MINT_1> [action arguments]",
    );
  }
  if (!["init", "open", "collect", "close", "rebalance"].includes(action)) {
    throw new Error("Action must be init, open, collect, close, or rebalance.");
  }

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const idl = JSON.parse(readFileSync("idl/liquidity_vault.json", "utf8"));
  const program = new anchor.Program(idl, provider);
  const owner = (provider.wallet as anchor.Wallet).payer;
  const poolId = new PublicKey(poolArgument);
  const mint0 = new PublicKey(mint0Argument);
  const mint1 = new PublicKey(mint1Argument);
  const vault0 = vaultAccounts(mint0);
  const vault1 = vaultAccounts(mint1);
  const state = positionState(vault0.state, vault1.state, poolId);
  const raydium = await import("@raydium-io/raydium-sdk-v2").then(({ Raydium }) =>
    Raydium.load({ connection: provider.connection, owner, cluster: "devnet", disableFeatureCheck: true, disableLoadToken: true }),
  );
  const { poolInfo, rpcData } = await raydium.clmm.getSimplePoolInfo(poolId);
  const clmmProgram = DEVNET_PROGRAM_ID.CLMM_PROGRAM_ID;
  if (!new PublicKey(poolInfo.programId).equals(clmmProgram)) throw new Error("Pool is not a Raydium devnet CLMM pool.");
  if (!new PublicKey(poolInfo.mintA.address).equals(mint0) || !new PublicKey(poolInfo.mintB.address).equals(mint1)) {
    throw new Error("Pass MINT_0 and MINT_1 in the same order as the pool's mint A and mint B.");
  }
  const stateBase = {
    vaultState0: vault0.state,
    vaultState1: vault1.state,
    positionState: state,
    poolState: poolId,
  };

  if (action === "init") {
    const signature = await program.methods.initializePositionController().accounts({
      ...stateBase,
      admin: owner.publicKey,
      systemProgram: SystemProgram.programId,
    }).rpc();
    console.log(`Position controller: ${state.toBase58()}`);
    console.log(`Transaction: https://explorer.solana.com/tx/${signature}?cluster=devnet`);
    return;
  }

  const positionStateAccount = (program.account as any).positionState;
  const saved = await positionStateAccount.fetch(state);
  const positionMint = saved.isOpen
    ? saved.positionNftMint
    : pda([SEEDS.positionNft, state.toBuffer(), new BN(saved.generation).toArrayLike(Buffer, "le", 8)]);
  const nftAccount = getAssociatedTokenAddressSync(positionMint, state, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const personalPosition = saved.isOpen
    ? saved.personalPosition
    : getPdaPersonalPositionAddress(clmmProgram, positionMint).publicKey;
  const openTickAccounts = (lowerTick: number, upperTick: number) => ({
    tickArrayLower: getPdaTickArrayAddress(clmmProgram, poolId, tickArrayStart(lowerTick, poolInfo.config.tickSpacing)).publicKey,
    tickArrayUpper: getPdaTickArrayAddress(clmmProgram, poolId, tickArrayStart(upperTick, poolInfo.config.tickSpacing)).publicKey,
    personalPosition,
  });
  const manageAccounts = {
    ...stateBase,
    tokenVault0: vault0.tokenVault,
    tokenVault1: vault1.tokenVault,
    positionNftMint: positionMint,
    positionNftAccount: nftAccount,
    personalPosition,
    protocolPosition: getPdaProtocolPositionAddress(clmmProgram, poolId, saved.tickLower, saved.tickUpper).publicKey,
    raydiumPoolVault0: new PublicKey(rpcData.vaultA.toBase58()),
    raydiumPoolVault1: new PublicKey(rpcData.vaultB.toBase58()),
    tickArrayLower: saved.isOpen
      ? getPdaTickArrayAddress(clmmProgram, poolId, tickArrayStart(saved.tickLower, poolInfo.config.tickSpacing)).publicKey
      : PublicKey.default,
    tickArrayUpper: saved.isOpen
      ? getPdaTickArrayAddress(clmmProgram, poolId, tickArrayStart(saved.tickUpper, poolInfo.config.tickSpacing)).publicKey
      : PublicKey.default,
    vaultMint0: mint0,
    vaultMint1: mint1,
    admin: owner.publicKey,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
    tokenProgram2022: TOKEN_2022_PROGRAM_ID,
    memoProgram: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
    clmmProgram,
  };

  const open = async (lowerTick: number, upperTick: number, max0: string, max1: string) => {
    const tickArrays = openTickAccounts(lowerTick, upperTick);
    const protocolPosition = getPdaProtocolPositionAddress(clmmProgram, poolId, lowerTick, upperTick).publicKey;
    const current = await positionStateAccount.fetch(state);
    const mint = pda([SEEDS.positionNft, state.toBuffer(), new BN(current.generation).toArrayLike(Buffer, "le", 8)]);
    const lowerStart = tickArrayStart(lowerTick, poolInfo.config.tickSpacing);
    const upperStart = tickArrayStart(upperTick, poolInfo.config.tickSpacing);
    const mintPda = PublicKey.findProgramAddressSync(
      [SEEDS.positionNft, state.toBuffer(), new BN(current.generation).toArrayLike(Buffer, "le", 8)], PROGRAM_ID,
    );
    const nftAta = getAssociatedTokenAddressSync(mint, state, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    const signature = await program.methods.openClmmPosition(
      lowerTick,
      upperTick,
      lowerStart,
      upperStart,
      new BN(max0),
      new BN(max1),
      true,
    ).accounts({
      ...stateBase,
      tokenVault0: vault0.tokenVault,
      tokenVault1: vault1.tokenVault,
      positionNftMint: mintPda[0],
      positionNftAccount: nftAta,
      metadataAccount: getPdaMetadataKey(mint).publicKey,
      protocolPosition,
      ...tickArrays,
      personalPosition: getPdaPersonalPositionAddress(clmmProgram, mint).publicKey,
      raydiumPoolVault0: new PublicKey(rpcData.vaultA.toBase58()),
      raydiumPoolVault1: new PublicKey(rpcData.vaultB.toBase58()),
      vaultMint0: mint0,
      vaultMint1: mint1,
      admin: owner.publicKey,
      rent: SYSVAR_RENT_PUBKEY,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      metadataProgram: METADATA_PROGRAM_ID,
      tokenProgram2022: TOKEN_2022_PROGRAM_ID,
      clmmProgram,
    }).rpc();
    console.log(`Opened ${lowerTick}..${upperTick}; transaction: https://explorer.solana.com/tx/${signature}?cluster=devnet`);
  };

  if (action === "open") {
    const [lowerPriceArg, upperPriceArg, max0 = "1000000", max1 = "1000000"] = args;
    if (!lowerPriceArg || !upperPriceArg) throw new Error("open requires <lower-price> <upper-price> [max0-base-units] [max1-base-units].");
    const decA = poolInfo.mintA.decimals;
    const decB = poolInfo.mintB.decimals;
    const lower = TickUtil.toTickIndex(TickUtil.priceToTick(new Decimal(lowerPriceArg), decA, decB), poolInfo.config.tickSpacing);
    const upper = TickUtil.toTickIndex(TickUtil.priceToTick(new Decimal(upperPriceArg), decA, decB), poolInfo.config.tickSpacing);
    await open(Math.min(lower, upper), Math.max(lower, upper), max0, max1);
    return;
  }

  if (!saved.isOpen) throw new Error("There is no open position in this controller.");
  if (action === "collect") {
    const signature = await program.methods.collectClmmFees().accounts(manageAccounts).rpc();
    console.log(`Fees collected to the vault token accounts; transaction: https://explorer.solana.com/tx/${signature}?cluster=devnet`);
    return;
  }
  if (action === "close") {
    const signature = await program.methods.closeClmmPosition().accounts(manageAccounts).rpc();
    console.log(`Position closed and liquidity/fees returned to the vault; transaction: https://explorer.solana.com/tx/${signature}?cluster=devnet`);
    return;
  }

  const widthPercent = Number(args[0] ?? "5");
  const max0 = args[1] ?? "1000000";
  const max1 = args[2] ?? "1000000";
  if (!(widthPercent > 0 && widthPercent <= 50)) throw new Error("Rebalance width must be between 0 and 50 percent.");
  const currentTick = Number(rpcData.tickCurrent);
  if (currentTick >= saved.tickLower && currentTick < saved.tickUpper) {
    console.log(`Position is still in range (${saved.tickLower}..${saved.tickUpper}); current tick is ${currentTick}. No transaction sent.`);
    return;
  }
  const closeSignature = await program.methods.closeClmmPosition().accounts(manageAccounts).rpc();
  console.log(`Closed out-of-range position: https://explorer.solana.com/tx/${closeSignature}?cluster=devnet`);
  const delta = Math.round(Math.log(1 + widthPercent / 100) / Math.log(1.0001));
  const spacing = poolInfo.config.tickSpacing;
  const lower = Math.floor((currentTick - delta) / spacing) * spacing;
  const upper = Math.ceil((currentTick + delta) / spacing) * spacing;
  await open(lower, upper, max0, max1);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
