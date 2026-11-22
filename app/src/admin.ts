import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Connection,
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { Buffer } from "buffer";
import Decimal from "decimal.js";
import idl from "../../idl/liquidity_vault.json";
import {
  POOL_ID,
  PROGRAM_ID,
  VAULT_TOKENS,
  derivePositionController,
  deriveVaultAddresses,
  formatTokenAmount,
  parseTokenAmount,
} from "./lib/vault";

const POSITION_SEED = Buffer.from("position_nft");
const MEMO_PROGRAM = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
);

type AdminViewDeps = {
  connection: Connection;
  getProvider: () => AnchorProvider;
  getWallet: () => PublicKey | null;
  showTransaction: (message: string, signature: string) => void;
};

type RaydiumContext = {
  sdk: typeof import("@raydium-io/raydium-sdk-v2");
  raydium: Awaited<ReturnType<typeof import("@raydium-io/raydium-sdk-v2").Raydium.load>>;
  poolInfo: any;
  rpcData: any;
};

function pda(seeds: Buffer[]) {
  return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
}

function tickArrayStart(tick: number, spacing: number) {
  return Math.floor(tick / (spacing * 60)) * spacing * 60;
}

function setText(selector: string, value: string) {
  const element = document.querySelector<HTMLElement>(selector);
  if (element) element.textContent = value;
}

function currentStatus(message: string, kind: "info" | "error" = "info") {
  const element = document.querySelector<HTMLElement>("#admin-status");
  if (!element) return;
  element.textContent = message;
  element.className = `notice${kind === "error" ? " error" : ""}`;
}

async function loadRaydium(
  connection: Connection,
  wallet: PublicKey,
): Promise<RaydiumContext> {
  const sdk = await import("@raydium-io/raydium-sdk-v2");
  const raydium = await sdk.Raydium.load({
    connection,
    owner: wallet,
    cluster: "devnet",
    disableFeatureCheck: true,
    disableLoadToken: true,
  });
  const { poolInfo, rpcData } = await raydium.clmm.getSimplePoolInfo(POOL_ID);
  if (
    !new PublicKey(poolInfo.programId).equals(
      sdk.DEVNET_PROGRAM_ID.CLMM_PROGRAM_ID,
    )
  )
    throw new Error("The selected pool is not a Raydium Devnet CLMM pool.");
  if (
    !new PublicKey(poolInfo.mintA.address).equals(VAULT_TOKENS[0].mint) ||
    !new PublicKey(poolInfo.mintB.address).equals(VAULT_TOKENS[1].mint)
  )
    throw new Error("The pool token order does not match the vault settings.");
  return { sdk, raydium, poolInfo, rpcData };
}

async function assertVaultAdmin(
  connection: Connection,
  wallet: PublicKey,
  mint: PublicKey,
) {
  const addresses = deriveVaultAddresses(mint, wallet);
  const account = await connection.getAccountInfo(addresses.vaultState, "confirmed");
  if (!account || !account.owner.equals(PROGRAM_ID))
    throw new Error("The required vault has not been initialized on Devnet.");
  const admin = new PublicKey(account.data.subarray(8, 40));
  if (!admin.equals(wallet))
    throw new Error("This wallet is not the administrator of both vaults.");
  return addresses;
}

function readPositionAccount(data: Buffer) {
  if (data.length < 186) throw new Error("Position controller data is incomplete.");
  return {
    positionNftMint: new PublicKey(data.subarray(104, 136)),
    personalPosition: new PublicKey(data.subarray(136, 168)),
    tickLower: data.readInt32LE(168),
    tickUpper: data.readInt32LE(172),
    generation: data.readBigUInt64LE(176),
    isOpen: data.readUInt8(184) === 1,
  };
}

export function mountAdminView(deps: AdminViewDeps) {
  const getProgram = () => new Program(idl as never, deps.getProvider());
  let refreshSequence = 0;

  async function loadPositionContext(wallet: PublicKey) {
    const vault0 = await assertVaultAdmin(
      deps.connection,
      wallet,
      VAULT_TOKENS[0].mint,
    );
    const vault1 = await assertVaultAdmin(
      deps.connection,
      wallet,
      VAULT_TOKENS[1].mint,
    );
    const controller = derivePositionController(
      vault0.vaultState,
      vault1.vaultState,
      POOL_ID,
    );
    const account = await deps.connection.getAccountInfo(controller, "confirmed");
    const position = account
      ? readPositionAccount(account.data)
      : null;
    const raydiumContext = await loadRaydium(deps.connection, wallet);
    return { vault0, vault1, controller, account, position, ...raydiumContext };
  }

  async function refresh() {
    const request = ++refreshSequence;
    const wallet = deps.getWallet();
    const initButton = document.querySelector<HTMLButtonElement>("#position-init");
    const openButton = document.querySelector<HTMLButtonElement>("#position-open");
    const collectButton = document.querySelector<HTMLButtonElement>("#position-collect");
    const closeButton = document.querySelector<HTMLButtonElement>("#position-close");
    const swapButton = document.querySelector<HTMLButtonElement>("#swap-submit");
    if (!wallet) {
      setText("#admin-wallet", "Connect an admin wallet");
      setText("#admin-pool-tick", "—");
      setText("#admin-position-state", "Wallet required");
      for (const button of [initButton, openButton, collectButton, closeButton, swapButton])
        if (button) button.disabled = true;
      currentStatus("Connect the Devnet administrator wallet to use these actions.");
      return;
    }
    for (const button of [initButton, openButton, collectButton, closeButton, swapButton])
      if (button) button.disabled = true;
    currentStatus("Checking vault administrator and Raydium pool…");
    try {
      const context = await loadPositionContext(wallet);
      if (request !== refreshSequence) return;
      setText("#admin-wallet", wallet.toBase58());
      setText("#admin-pool-tick", `${context.rpcData.tickCurrent}`);
      setText(
        "#admin-position-state",
        context.position
          ? context.position.isOpen
            ? `Open · ticks ${context.position.tickLower} to ${context.position.tickUpper}`
            : "Controller ready · no open position"
          : "Controller not initialized",
      );
      if (initButton) initButton.disabled = Boolean(context.position);
      if (openButton) openButton.disabled = !context.position || context.position.isOpen;
      if (collectButton) collectButton.disabled = !context.position?.isOpen;
      if (closeButton) closeButton.disabled = !context.position?.isOpen;
      if (swapButton) swapButton.disabled = false;
      currentStatus("Admin access confirmed for both vaults. Actions run on Devnet.");
    } catch (error) {
      if (request !== refreshSequence) return;
      const message = error instanceof Error ? error.message : "Could not load admin data.";
      currentStatus(message, "error");
      setText("#admin-position-state", "Admin data unavailable");
    }
  }

  async function submitSwap(event: SubmitEvent) {
    event.preventDefault();
    const wallet = deps.getWallet();
    if (!wallet) return currentStatus("Connect the admin wallet first.", "error");
    const submit = document.querySelector<HTMLButtonElement>("#swap-submit")!;
    submit.disabled = true;
    try {
      const direction = document.querySelector<HTMLSelectElement>("#swap-direction")!.value;
      const tokenIn = direction === "a-to-b" ? VAULT_TOKENS[0] : VAULT_TOKENS[1];
      const tokenOut = direction === "a-to-b" ? VAULT_TOKENS[1] : VAULT_TOKENS[0];
      const amountIn = parseTokenAmount(
        document.querySelector<HTMLInputElement>("#swap-amount")!.value,
        tokenIn.decimals,
      );
      const slippageBps = Number(
        document.querySelector<HTMLInputElement>("#swap-slippage")!.value,
      );
      if (amountIn <= 0n) throw new Error("Enter an amount greater than zero.");
      if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps >= 10_000)
        throw new Error("Slippage must be between 1 and 9,999 basis points.");
      const vault = await assertVaultAdmin(deps.connection, wallet, tokenIn.mint);
      const { sdk, raydium, poolInfo, rpcData } = await loadRaydium(deps.connection, wallet);
      const zeroForOne = tokenIn.mint.equals(new PublicKey(poolInfo.mintA.address));
      const { rpcData: swapData, configInfo, tickArrays } =
        await raydium.clmm.getSwapPoolInfo(POOL_ID, zeroForOne);
      const bitmapAddress = sdk.getPdaExBitmapAccount(
        new PublicKey(poolInfo.programId),
        POOL_ID,
      ).publicKey;
      const bitmapAccount = await deps.connection.getAccountInfo(bitmapAddress, "confirmed");
      if (!bitmapAccount) throw new Error("Pool tick-array bitmap was not found.");
      const quote = sdk.swapInternal({
        programId: new PublicKey(poolInfo.programId),
        poolId: POOL_ID,
        poolInfo: swapData,
        tickArrays,
        configInfo,
        tickarrayBitmapExtension: sdk.TickArrayBitmapExtensionLayout.decode(bitmapAccount.data),
        amountSpecified: new BN(amountIn.toString()),
        sqrtPriceLimitX64: new BN(0),
        zeroForOne,
        isBaseInput: true,
        blockTimestamp: Math.floor(Date.now() / 1000),
        includeExtraTickArrays: true,
      });
      if (!quote.allTrade || !quote.amountSpecifiedRemaining.isZero() || quote.amountCalculated.isZero())
        throw new Error("The current pool liquidity cannot fill this exact-input swap.");
      const minAmountOut = quote.amountCalculated.muln(10_000 - slippageBps).divn(10_000);
      if (minAmountOut.isZero()) throw new Error("Minimum output rounded down to zero.");
      const shareAccount = getAssociatedTokenAddressSync(vault.shareMint, wallet);
      const outputAccount = getAssociatedTokenAddressSync(tokenOut.mint, wallet);
      if (!(await deps.connection.getAccountInfo(shareAccount, "confirmed")))
        throw new Error("The admin wallet has no share-token account for the input vault.");
      const transaction = new Transaction();
      if (!(await deps.connection.getAccountInfo(outputAccount, "confirmed")))
        transaction.add(createAssociatedTokenAccountInstruction(
          wallet, outputAccount, wallet, tokenOut.mint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
        ));
      const program = getProgram();
      const accounts = quote.accounts.map((pubkey: PublicKey) => ({
        pubkey,
        isSigner: false,
        isWritable: true,
      }));
      transaction.add(await (program.methods as any)
        .swapFromVault(new BN(amountIn.toString()), minAmountOut)
        .accounts({
          vaultState: vault.vaultState,
          inputMint: tokenIn.mint,
          tokenVault: vault.tokenVault,
          shareMint: vault.shareMint,
          userShareAccount: shareAccount,
          userOutputTokenAccount: outputAccount,
          outputMint: tokenOut.mint,
          userCard: vault.userCard,
          user: wallet,
          ammConfig: new PublicKey(poolInfo.config.id),
          poolState: POOL_ID,
          poolTokenVault0: rpcData.vaultA,
          poolTokenVault1: rpcData.vaultB,
          poolMint0: new PublicKey(poolInfo.mintA.address),
          poolMint1: new PublicKey(poolInfo.mintB.address),
          observationState: sdk.getPdaObservationAccount(new PublicKey(poolInfo.programId), POOL_ID).publicKey,
          clmmProgram: new PublicKey(poolInfo.programId),
          tokenProgram: TOKEN_PROGRAM_ID,
          tokenProgram2022: TOKEN_2022_PROGRAM_ID,
          memoProgram: MEMO_PROGRAM,
        })
        .remainingAccounts(accounts)
        .instruction());
      const quoteText = `${formatTokenAmount(BigInt(quote.amountCalculated.toString()), tokenOut.decimals)} ${tokenOut.symbol}; minimum ${formatTokenAmount(BigInt(minAmountOut.toString()), tokenOut.decimals)} ${tokenOut.symbol}`;
      currentStatus(`Quote: ${quoteText}. Approve the Devnet swap in your wallet.`);
      const signature = await deps.getProvider().sendAndConfirm(transaction, [], { commitment: "confirmed" });
      deps.showTransaction("Swap confirmed", signature);
      await refresh();
    } catch (error) {
      currentStatus(error instanceof Error ? error.message : "Swap failed.", "error");
    } finally {
      submit.disabled = false;
      await refresh();
    }
  }

  async function initializeController() {
    const wallet = deps.getWallet();
    if (!wallet) return currentStatus("Connect the admin wallet first.", "error");
    try {
      const context = await loadPositionContext(wallet);
      if (context.position) throw new Error("The position controller already exists.");
      const signature = await (getProgram().methods as any)
        .initializePositionController()
        .accounts({
          vaultState0: context.vault0.vaultState,
          vaultState1: context.vault1.vaultState,
          positionState: context.controller,
          poolState: POOL_ID,
          admin: wallet,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      deps.showTransaction("Position controller initialized", signature);
      await refresh();
    } catch (error) {
      currentStatus(error instanceof Error ? error.message : "Could not initialize the controller.", "error");
    }
  }

  async function openPosition() {
    const wallet = deps.getWallet();
    if (!wallet) return currentStatus("Connect the admin wallet first.", "error");
    try {
      const context = await loadPositionContext(wallet);
      if (!context.position) throw new Error("Initialize the position controller first.");
      if (context.position.isOpen) throw new Error("There is already an open position.");
      const lowerPrice = new Decimal(document.querySelector<HTMLInputElement>("#range-lower")!.value);
      const upperPrice = new Decimal(document.querySelector<HTMLInputElement>("#range-upper")!.value);
      if (!lowerPrice.isFinite() || !upperPrice.isFinite() || lowerPrice.lte(0) || lowerPrice.gte(upperPrice))
        throw new Error("Enter a valid lower and upper price range.");
      const max0 = parseTokenAmount(document.querySelector<HTMLInputElement>("#range-max-a")!.value, context.poolInfo.mintA.decimals);
      const max1 = parseTokenAmount(document.querySelector<HTMLInputElement>("#range-max-b")!.value, context.poolInfo.mintB.decimals);
      if (max0 <= 0n || max1 <= 0n) throw new Error("Maximum token amounts must be greater than zero.");
      const spacing = context.poolInfo.config.tickSpacing;
      const lowerTick = context.sdk.TickUtil.toTickIndex(
        context.sdk.TickUtil.priceToTick(lowerPrice, context.poolInfo.mintA.decimals, context.poolInfo.mintB.decimals),
        spacing,
      );
      const upperTick = context.sdk.TickUtil.toTickIndex(
        context.sdk.TickUtil.priceToTick(upperPrice, context.poolInfo.mintA.decimals, context.poolInfo.mintB.decimals),
        spacing,
      );
      if (lowerTick >= upperTick) throw new Error("The selected prices map to an invalid tick range.");
      const lowerStart = tickArrayStart(lowerTick, spacing);
      const upperStart = tickArrayStart(upperTick, spacing);
      const generation = Buffer.alloc(8);
      generation.writeBigUInt64LE(context.position.generation);
      const [positionMint] = PublicKey.findProgramAddressSync(
        [POSITION_SEED, context.controller.toBuffer(), generation],
        PROGRAM_ID,
      );
      const clmmProgram = context.sdk.DEVNET_PROGRAM_ID.CLMM_PROGRAM_ID;
      const nftAccount = getAssociatedTokenAddressSync(positionMint, context.controller, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
      const personalPosition = context.sdk.getPdaPersonalPositionAddress(clmmProgram, positionMint).publicKey;
      const signature = await (getProgram().methods as any)
        .openClmmPosition(
          lowerTick,
          upperTick,
          lowerStart,
          upperStart,
          new BN(max0.toString()),
          new BN(max1.toString()),
          true,
        )
        .accounts({
          vaultState0: context.vault0.vaultState,
          vaultState1: context.vault1.vaultState,
          tokenVault0: context.vault0.tokenVault,
          tokenVault1: context.vault1.tokenVault,
          positionState: context.controller,
          positionNftMint: positionMint,
          positionNftAccount: nftAccount,
          metadataAccount: context.sdk.getPdaMetadataKey(positionMint).publicKey,
          poolState: POOL_ID,
          protocolPosition: context.sdk.getPdaProtocolPositionAddress(clmmProgram, POOL_ID, lowerTick, upperTick).publicKey,
          tickArrayLower: context.sdk.getPdaTickArrayAddress(clmmProgram, POOL_ID, lowerStart).publicKey,
          tickArrayUpper: context.sdk.getPdaTickArrayAddress(clmmProgram, POOL_ID, upperStart).publicKey,
          personalPosition,
          raydiumPoolVault0: context.rpcData.vaultA,
          raydiumPoolVault1: context.rpcData.vaultB,
          vaultMint0: VAULT_TOKENS[0].mint,
          vaultMint1: VAULT_TOKENS[1].mint,
          admin: wallet,
          rent: SYSVAR_RENT_PUBKEY,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          metadataProgram: context.sdk.METADATA_PROGRAM_ID,
          tokenProgram2022: TOKEN_2022_PROGRAM_ID,
          clmmProgram,
        })
        .rpc();
      deps.showTransaction(`Opened CLMM range ${lowerTick} to ${upperTick}`, signature);
      await refresh();
    } catch (error) {
      currentStatus(error instanceof Error ? error.message : "Could not open the position.", "error");
    }
  }

  async function managePosition(action: "collect" | "close") {
    const wallet = deps.getWallet();
    if (!wallet) return currentStatus("Connect the admin wallet first.", "error");
    try {
      const context = await loadPositionContext(wallet);
      const saved = context.position;
      if (!saved?.isOpen) throw new Error("There is no open position to manage.");
      const clmmProgram = context.sdk.DEVNET_PROGRAM_ID.CLMM_PROGRAM_ID;
      const signature = await (getProgram().methods as any)[
        action === "collect" ? "collectClmmFees" : "closeClmmPosition"
      ]()
        .accounts({
          vaultState0: context.vault0.vaultState,
          vaultState1: context.vault1.vaultState,
          tokenVault0: context.vault0.tokenVault,
          tokenVault1: context.vault1.tokenVault,
          positionState: context.controller,
          positionNftMint: saved.positionNftMint,
          positionNftAccount: getAssociatedTokenAddressSync(saved.positionNftMint, context.controller, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
          personalPosition: saved.personalPosition,
          poolState: POOL_ID,
          protocolPosition: context.sdk.getPdaProtocolPositionAddress(clmmProgram, POOL_ID, saved.tickLower, saved.tickUpper).publicKey,
          raydiumPoolVault0: context.rpcData.vaultA,
          raydiumPoolVault1: context.rpcData.vaultB,
          tickArrayLower: context.sdk.getPdaTickArrayAddress(clmmProgram, POOL_ID, tickArrayStart(saved.tickLower, context.poolInfo.config.tickSpacing)).publicKey,
          tickArrayUpper: context.sdk.getPdaTickArrayAddress(clmmProgram, POOL_ID, tickArrayStart(saved.tickUpper, context.poolInfo.config.tickSpacing)).publicKey,
          vaultMint0: VAULT_TOKENS[0].mint,
          vaultMint1: VAULT_TOKENS[1].mint,
          admin: wallet,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          tokenProgram2022: TOKEN_2022_PROGRAM_ID,
          memoProgram: MEMO_PROGRAM,
          clmmProgram,
        })
        .rpc();
      deps.showTransaction(action === "collect" ? "Collected CLMM fees to the vault" : "Closed the CLMM position", signature);
      await refresh();
    } catch (error) {
      currentStatus(error instanceof Error ? error.message : `Could not ${action} the position.`, "error");
    }
  }

  document.querySelector<HTMLFormElement>("#swap-form")!.addEventListener("submit", (event) => void submitSwap(event));
  document.querySelector<HTMLButtonElement>("#admin-refresh")!.addEventListener("click", () => void refresh());
  document.querySelector<HTMLButtonElement>("#position-init")!.addEventListener("click", () => void initializeController());
  document.querySelector<HTMLButtonElement>("#position-open")!.addEventListener("click", () => void openPosition());
  document.querySelector<HTMLButtonElement>("#position-collect")!.addEventListener("click", () => void managePosition("collect"));
  document.querySelector<HTMLButtonElement>("#position-close")!.addEventListener("click", () => void managePosition("close"));

  return { refresh };
}
