import { AnchorProvider, BN, Program, type Idl } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { Buffer } from "buffer";
import { mountAdminView } from "./admin";
import idl from "../../idl/liquidity_vault.json";
import {
  POOL_ID,
  PROGRAM_ID,
  VAULT_TOKENS,
  derivePositionController,
  deriveVaultAddresses,
  formatTokenAmount,
  parseTokenAmount,
  readPositionState,
  readU64,
} from "./lib/vault";
import "./styles.css";

interface PhantomWalletProvider {
  isPhantom?: boolean;
  publicKey?: PublicKey | null;
  connect(options?: {
    onlyIfTrusted?: boolean;
  }): Promise<{ publicKey: PublicKey }>;
  disconnect(): Promise<void>;
  signTransaction<T extends Transaction | VersionedTransaction>(
    transaction: T,
  ): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(
    transactions: T[],
  ): Promise<T[]>;
  on?(event: string, callback: (value?: unknown) => void): void;
}

declare global {
  interface Window {
    phantom?: { solana?: PhantomWalletProvider };
    solana?: PhantomWalletProvider;
  }
}

interface VaultSnapshot {
  tokenBalance: bigint;
  totalDeposited: bigint;
  shareSupply: bigint;
  walletTokenBalance: bigint;
  walletShares: bigint;
  userDeposit: bigint;
  decimals: number;
}

const DEVNET_RPC = "https://api.devnet.solana.com";
const connection = new Connection(DEVNET_RPC, "confirmed");
const walletButton =
  document.querySelector<HTMLButtonElement>("#wallet-button")!;
const heroConnect = document.querySelector<HTMLButtonElement>("#hero-connect")!;
const refreshButton =
  document.querySelector<HTMLButtonElement>("#refresh-button")!;
const form = document.querySelector<HTMLFormElement>("#vault-form")!;
const amountInput = document.querySelector<HTMLInputElement>("#amount-input")!;
const submitButton =
  document.querySelector<HTMLButtonElement>("#submit-button")!;
const notice = document.querySelector<HTMLDivElement>("#notice")!;
const withdrawQuote =
  document.querySelector<HTMLDivElement>("#withdraw-quote")!;
const tokenTabs = [
  ...document.querySelectorAll<HTMLButtonElement>(".token-tab"),
];
const actionTabs = [
  ...document.querySelectorAll<HTMLButtonElement>(".action-tab"),
];
const vaultPage = document.querySelector<HTMLElement>("#top")!;
const adminPage = document.querySelector<HTMLElement>("#admin-page")!;
const vaultViewButton = document.querySelector<HTMLButtonElement>("#vault-view-button")!;
const adminViewButton = document.querySelector<HTMLButtonElement>("#admin-view-button")!;

let walletProvider: PhantomWalletProvider | null = null;
let subscribedProvider: PhantomWalletProvider | null = null;
let walletPublicKey: PublicKey | null = null;
let selectedTokenIndex = 0;
let activeAction: "deposit" | "withdraw" = "deposit";
let snapshot: VaultSnapshot | null = null;
let adminView: ReturnType<typeof mountAdminView> | null = null;

const selectedToken = () => VAULT_TOKENS[selectedTokenIndex];
const truncate = (address: string) =>
  `${address.slice(0, 4)}…${address.slice(-4)}`;

function setNotice(
  message: string,
  kind: "info" | "success" | "error" = "info",
) {
  notice.textContent = message;
  notice.className = `notice${kind === "info" ? "" : ` ${kind}`}`;
}

function setTransactionNotice(message: string, signature: string) {
  notice.textContent = `${message} `;
  notice.className = "notice success";
  const link = document.createElement("a");
  link.href = `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = "View transaction ↗";
  notice.append(link);
}

function selectPage(page: "vault" | "admin") {
  const showAdmin = page === "admin";
  vaultPage.hidden = showAdmin;
  adminPage.hidden = !showAdmin;
  vaultViewButton.classList.toggle("active", !showAdmin);
  adminViewButton.classList.toggle("active", showAdmin);
  if (showAdmin) void adminView?.refresh();
}

function currentProvider() {
  return window.phantom?.solana ?? window.solana ?? null;
}

function anchorProvider() {
  if (!walletProvider || !walletPublicKey)
    throw new Error("Connect a wallet first.");
  const anchorWallet = {
    publicKey: walletPublicKey,
    signTransaction: <T extends Transaction | VersionedTransaction>(
      transaction: T,
    ) => walletProvider!.signTransaction(transaction),
    signAllTransactions: <T extends Transaction | VersionedTransaction>(
      transactions: T[],
    ) => walletProvider!.signAllTransactions(transactions),
  };
  return new AnchorProvider(connection, anchorWallet as never, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
}

function vaultProgram() {
  return new Program(idl as unknown as Idl, anchorProvider());
}

function accountOwnedByProgram(
  info: Awaited<ReturnType<Connection["getAccountInfo"]>>,
  label: string,
) {
  if (!info) throw new Error(`${label} has not been initialized on Devnet.`);
  if (!info.owner.equals(PROGRAM_ID))
    throw new Error(`${label} is not owned by the vault program.`);
  return info.data;
}

async function readOptionalTokenBalance(address: PublicKey): Promise<bigint> {
  const info = await connection.getAccountInfo(address, "confirmed");
  if (!info) return 0n;
  return (await getAccount(connection, address, "confirmed", TOKEN_PROGRAM_ID))
    .amount;
}

async function loadSnapshot(): Promise<VaultSnapshot> {
  if (!walletPublicKey) throw new Error("Connect a wallet to load vault data.");
  const token = selectedToken();
  const addresses = deriveVaultAddresses(token.mint, walletPublicKey);
  const [stateInfo, cardInfo] = await Promise.all([
    connection.getAccountInfo(addresses.vaultState, "confirmed"),
    connection.getAccountInfo(addresses.userCard, "confirmed"),
  ]);
  const stateData = accountOwnedByProgram(stateInfo, `${token.name} vault`);
  if (stateData.length < 145)
    throw new Error("Vault settings account has an invalid size.");
  if (!new PublicKey(stateData.subarray(40, 72)).equals(token.mint))
    throw new Error("Vault token mint does not match this token.");
  if (!new PublicKey(stateData.subarray(72, 104)).equals(addresses.tokenVault))
    throw new Error("Vault token account does not match its PDA.");
  if (!new PublicKey(stateData.subarray(104, 136)).equals(addresses.shareMint))
    throw new Error("Vault share mint does not match its PDA.");

  const cardData = cardInfo
    ? accountOwnedByProgram(cardInfo, "User card")
    : null;
  if (
    cardData &&
    (cardData.length < 89 ||
      !new PublicKey(cardData.subarray(8, 40)).equals(addresses.vaultState) ||
      !new PublicKey(cardData.subarray(40, 72)).equals(walletPublicKey))
  )
    throw new Error("User card belongs to a different wallet or vault.");

  const userTokenAccount = getAssociatedTokenAddressSync(
    token.mint,
    walletPublicKey,
  );
  const userShareAccount = getAssociatedTokenAddressSync(
    addresses.shareMint,
    walletPublicKey,
  );
  const [vaultTokenBalance, mintInfo, walletTokenBalance, walletShares] =
    await Promise.all([
      readOptionalTokenBalance(addresses.tokenVault),
      getMint(connection, addresses.shareMint, "confirmed", TOKEN_PROGRAM_ID),
      readOptionalTokenBalance(userTokenAccount),
      readOptionalTokenBalance(userShareAccount),
    ]);
  const positionController = derivePositionController(
    deriveVaultAddresses(VAULT_TOKENS[0].mint, walletPublicKey).vaultState,
    deriveVaultAddresses(VAULT_TOKENS[1].mint, walletPublicKey).vaultState,
    POOL_ID,
  );
  const positionInfo = await connection.getAccountInfo(
    positionController,
    "confirmed",
  );
  const position = positionInfo
    ? readPositionState(
        accountOwnedByProgram(positionInfo, "CLMM position controller"),
      )
    : null;
  const controllerLink =
    document.querySelector<HTMLAnchorElement>("#controller-link")!;
  controllerLink.href = `https://explorer.solana.com/address/${positionController.toBase58()}?cluster=devnet`;
  controllerLink.textContent = `${truncate(positionController.toBase58())} ↗`;
  const status = document.querySelector<HTMLSpanElement>("#position-status")!;
  const range = document.querySelector<HTMLElement>("#position-range")!;
  const detail = document.querySelector<HTMLElement>("#position-detail")!;
  if (position?.isOpen) {
    status.textContent = "Position open";
    status.className = "position-status open";
    range.textContent = `${position.tickLower.toLocaleString()} to ${position.tickUpper.toLocaleString()}`;
    detail.textContent = `Ticks ${position.tickLower}–${position.tickUpper} · NFT held by the vault PDA.`;
  } else {
    status.textContent = position ? "No active position" : "Not initialized";
    status.className = "position-status";
    range.textContent = "No active range";
    detail.textContent = position
      ? "The controller is ready for a new position."
      : "Position data is stored on the vault controller PDA.";
  }
  return {
    tokenBalance: vaultTokenBalance,
    totalDeposited: readU64(stateData, 136),
    shareSupply: mintInfo.supply,
    walletTokenBalance,
    walletShares,
    userDeposit: cardData ? readU64(cardData, 72) : 0n,
    decimals: mintInfo.decimals,
  };
}

function setText(selector: string, value: string) {
  const element = document.querySelector<HTMLElement>(selector);
  if (element) element.textContent = value;
}

function renderAction() {
  const token = selectedToken();
  const decimals = snapshot?.decimals ?? token.decimals;
  document.querySelector<HTMLLabelElement>("#amount-label")!.textContent =
    activeAction === "deposit" ? "Amount to deposit" : "Shares to withdraw";
  document.querySelector<HTMLElement>("#amount-symbol")!.textContent =
    activeAction === "deposit" ? token.symbol : `${token.symbol} shares`;
  document.querySelector<HTMLElement>("#balance-label")!.textContent =
    activeAction === "deposit" ? "Wallet balance" : "Available shares";
  setText(
    "#wallet-token-balance",
    snapshot
      ? formatTokenAmount(
          activeAction === "deposit"
            ? snapshot.walletTokenBalance
            : snapshot.walletShares,
          decimals,
        )
      : "Connect wallet",
  );
  submitButton.textContent = walletPublicKey
    ? activeAction === "deposit"
      ? "Deposit tokens →"
      : "Withdraw tokens →"
    : "Connect wallet first →";
  submitButton.disabled = !walletPublicKey;
  withdrawQuote.classList.toggle("hidden", activeAction !== "withdraw");
  updateWithdrawQuote();
}

function updateWithdrawQuote() {
  if (activeAction !== "withdraw" || !snapshot) return;
  try {
    const shares = parseTokenAmount(
      amountInput.value || "0",
      snapshot.decimals,
    );
    const output =
      snapshot.shareSupply > 0n
        ? (shares * snapshot.totalDeposited) / snapshot.shareSupply
        : 0n;
    withdrawQuote.textContent = `Estimated return: ${formatTokenAmount(output, snapshot.decimals)} ${selectedToken().symbol}`;
  } catch {
    withdrawQuote.textContent =
      "Enter a valid amount to see the estimated return.";
  }
}

async function refresh() {
  if (!walletPublicKey) {
    snapshot = null;
    setNotice("Connect a Phantom wallet set to Devnet to load your vault.");
    renderAction();
    return;
  }
  refreshButton.disabled = true;
  try {
    snapshot = await loadSnapshot();
    const token = selectedToken();
    setText(
      "#vault-balance",
      `${formatTokenAmount(snapshot.tokenBalance, snapshot.decimals)} ${token.symbol}`,
    );
    setText("#vault-balance-caption", "Tokens held by the vault PDA");
    setText(
      "#total-deposited",
      `${formatTokenAmount(snapshot.totalDeposited, snapshot.decimals)} ${token.symbol}`,
    );
    setText(
      "#user-shares",
      formatTokenAmount(snapshot.walletShares, snapshot.decimals),
    );
    setText(
      "#user-shares-caption",
      `${token.symbol} receipt tokens in your wallet`,
    );
    setText(
      "#user-deposit",
      `${formatTokenAmount(snapshot.userDeposit, snapshot.decimals)} ${token.symbol}`,
    );
    setNotice(`Loaded ${token.name} vault data from Solana Devnet.`, "success");
  } catch (error) {
    for (const selector of [
      "#vault-balance",
      "#total-deposited",
      "#user-shares",
      "#user-deposit",
    ])
      setText(selector, "—");
    setText("#vault-balance-caption", "Vault data unavailable");
    setNotice(
      error instanceof Error ? error.message : "Could not load vault data.",
      "error",
    );
  } finally {
    refreshButton.disabled = false;
    renderAction();
    if (!adminPage.hidden) void adminView?.refresh();
  }
}

function walletTransactionInstructions(
  wallet: PublicKey,
  mint: PublicKey,
  shareMint: PublicKey,
) {
  const transaction = new Transaction();
  const userTokenAccount = getAssociatedTokenAddressSync(mint, wallet);
  const userShareAccount = getAssociatedTokenAddressSync(shareMint, wallet);
  return { transaction, userTokenAccount, userShareAccount };
}

async function submitVaultAction(event: SubmitEvent) {
  event.preventDefault();
  if (!walletPublicKey) return setNotice("Connect your wallet first.", "error");
  const token = selectedToken();
  let amount: bigint;
  try {
    amount = parseTokenAmount(
      amountInput.value,
      snapshot?.decimals ?? token.decimals,
    );
    if (amount <= 0n) throw new Error("Amount must be greater than zero.");
  } catch (error) {
    return setNotice(
      error instanceof Error ? error.message : "Enter a valid amount.",
      "error",
    );
  }

  submitButton.disabled = true;
  submitButton.textContent = "Waiting for wallet…";
  try {
    const provider = anchorProvider();
    const program = vaultProgram();
    const addresses = deriveVaultAddresses(token.mint, walletPublicKey);
    const { transaction, userTokenAccount, userShareAccount } =
      walletTransactionInstructions(
        walletPublicKey,
        token.mint,
        addresses.shareMint,
      );
    const [tokenAtaInfo, shareAtaInfo, cardInfo] = await Promise.all([
      connection.getAccountInfo(userTokenAccount, "confirmed"),
      connection.getAccountInfo(userShareAccount, "confirmed"),
      connection.getAccountInfo(addresses.userCard, "confirmed"),
    ]);
    if (!tokenAtaInfo)
      transaction.add(
        createAssociatedTokenAccountInstruction(
          walletPublicKey,
          userTokenAccount,
          walletPublicKey,
          token.mint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
      );
    if (!shareAtaInfo)
      transaction.add(
        createAssociatedTokenAccountInstruction(
          walletPublicKey,
          userShareAccount,
          walletPublicKey,
          addresses.shareMint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
      );
    if (!cardInfo && activeAction === "deposit")
      transaction.add(
        await program.methods
          .createUserCard()
          .accounts({
            vaultState: addresses.vaultState,
            userCard: addresses.userCard,
            user: walletPublicKey,
            systemProgram: SystemProgram.programId,
          })
          .instruction(),
      );
    if (!cardInfo && activeAction === "withdraw")
      throw new Error(
        "Your user card is not initialized. Make a deposit first.",
      );

    if (activeAction === "deposit") {
      transaction.add(
        await program.methods
          .deposit(new BN(amount.toString()))
          .accounts({
            vaultState: addresses.vaultState,
            tokenMint: token.mint,
            userCard: addresses.userCard,
            tokenVault: addresses.tokenVault,
            shareMint: addresses.shareMint,
            userTokenAccount,
            userShareAccount,
            user: walletPublicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .instruction(),
      );
    } else {
      transaction.add(
        await program.methods
          .withdraw(new BN(amount.toString()))
          .accounts({
            vaultState: addresses.vaultState,
            tokenMint: token.mint,
            userCard: addresses.userCard,
            tokenVault: addresses.tokenVault,
            shareMint: addresses.shareMint,
            userTokenAccount,
            userShareAccount,
            user: walletPublicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .instruction(),
      );
    }

    setNotice("Review and approve the transaction in your wallet.");
    const signature = await provider.sendAndConfirm(transaction, [], {
      commitment: "confirmed",
    });
    amountInput.value = "";
    await refresh();
    setTransactionNotice(
      `${activeAction === "deposit" ? "Deposit" : "Withdrawal"} confirmed (${truncate(signature)}).`,
      signature,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Transaction failed.";
    setNotice(
      message.length > 240 ? `${message.slice(0, 237)}…` : message,
      "error",
    );
  } finally {
    renderAction();
  }
}

async function connectWallet() {
  const provider = currentProvider();
  if (!provider) {
    setNotice(
      "Phantom was not found. Install the Phantom wallet, then reload this page.",
      "error",
    );
    return;
  }
  walletProvider = provider;
  if (subscribedProvider !== provider) {
    subscribedProvider = provider;
    provider.on?.("disconnect", () => void clearConnection());
    provider.on?.("accountChanged", (account) => {
      if (account && typeof account === "object" && "toBase58" in account) {
        walletPublicKey = new PublicKey((account as PublicKey).toBase58());
        walletButton.textContent = truncate(walletPublicKey.toBase58());
        heroConnect.textContent = `Connected ${truncate(walletPublicKey.toBase58())}`;
        void refresh();
        void adminView?.refresh();
      } else {
        void clearConnection();
      }
    });
  }
  try {
    const response = await provider.connect();
    walletPublicKey = new PublicKey(response.publicKey.toBase58());
    walletButton.textContent = truncate(walletPublicKey.toBase58());
    walletButton.title = "Disconnect wallet";
    heroConnect.textContent = `Connected ${truncate(walletPublicKey.toBase58())}`;
    heroConnect.disabled = true;
    setNotice("Wallet connected. Reading vault accounts from Devnet…");
    await refresh();
    await adminView?.refresh();
  } catch (error) {
    setNotice(
      error instanceof Error
        ? error.message
        : "Wallet connection was not approved.",
      "error",
    );
  }
}

async function disconnectWallet() {
  await walletProvider?.disconnect();
  await clearConnection();
}

async function clearConnection() {
  walletProvider = null;
  walletPublicKey = null;
  walletButton.textContent = "Connect wallet";
  walletButton.title = "";
  heroConnect.textContent = "Connect wallet ↗";
  heroConnect.disabled = false;
  for (const selector of [
    "#vault-balance",
    "#total-deposited",
    "#user-shares",
    "#user-deposit",
  ])
    setText(selector, "—");
  setText("#vault-balance-caption", "Connect wallet to load");
  setText("#user-shares-caption", "Receipt tokens in your wallet");
  setText("#position-status", "Connect wallet");
  setText("#position-range", "—");
  void adminView?.refresh();
  renderAction();
  setNotice("Wallet disconnected.");
}

walletButton.addEventListener("click", () =>
  walletPublicKey ? void disconnectWallet() : void connectWallet(),
);
heroConnect.addEventListener("click", () => void connectWallet());
vaultViewButton.addEventListener("click", () => selectPage("vault"));
adminViewButton.addEventListener("click", () => selectPage("admin"));
refreshButton.addEventListener("click", () => void refresh());
form.addEventListener("submit", (event) => void submitVaultAction(event));
amountInput.addEventListener("input", updateWithdrawQuote);
tokenTabs.forEach((tab, index) =>
  tab.addEventListener("click", () => {
    selectedTokenIndex = index;
    tokenTabs.forEach((item, itemIndex) => {
      item.classList.toggle("active", itemIndex === index);
      item.setAttribute("aria-selected", String(itemIndex === index));
    });
    amountInput.value = "";
    setText("#amount-symbol", selectedToken().symbol);
    void refresh();
  }),
);
actionTabs.forEach((tab, index) =>
  tab.addEventListener("click", () => {
    activeAction = index === 0 ? "deposit" : "withdraw";
    actionTabs.forEach((item, itemIndex) => {
      item.classList.toggle("active", itemIndex === index);
      item.setAttribute("aria-selected", String(itemIndex === index));
    });
    amountInput.value = "";
    renderAction();
  }),
);
adminView = mountAdminView({
  connection,
  getProvider: anchorProvider,
  getWallet: () => walletPublicKey,
  showTransaction: setTransactionNotice,
});
renderAction();
