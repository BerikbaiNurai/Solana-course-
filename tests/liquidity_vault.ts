import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { createMint, createAccount, mintTo, getAccount, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { strict as assert } from "assert";

// These tests use Anchor's local validator. Run them with: anchor test --provider.cluster localnet

describe("liquidity_vault withdrawals", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.LiquidityVault as Program<any>;
  const admin = (provider.wallet as anchor.Wallet & { payer: Keypair }).payer;
  const userA = Keypair.generate();
  const userB = Keypair.generate();
  const userWithoutCard = Keypair.generate();
  const UNIT = 1_000_000;
  let tokenMint: PublicKey;
  let vaultState: PublicKey;
  let tokenVault: PublicKey;
  let shareMint: PublicKey;
  const userTokens = new Map<string, PublicKey>();
  const userShares = new Map<string, PublicKey>();

  const cardPda = (owner: PublicKey) => PublicKey.findProgramAddressSync(
    [Buffer.from("user_card"), vaultState.toBuffer(), owner.toBuffer()], program.programId
  )[0];
  const fundUser = async (user: Keypair) => provider.sendAndConfirm(
    new Transaction().add(SystemProgram.transfer({fromPubkey: admin.publicKey, toPubkey: user.publicKey, lamports: 50_000_000})), [admin]
  );
  const deposit = (user: Keypair, amount: number) => program.methods.deposit(new anchor.BN(amount)).accounts({
    vaultState, tokenMint, userCard: cardPda(user.publicKey), tokenVault, shareMint,
    userTokenAccount: userTokens.get(user.publicKey.toBase58()), userShareAccount: userShares.get(user.publicKey.toBase58()),
    user: user.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
  }).signers([user]).rpc();
  const withdraw = (user: Keypair, shares: number) => program.methods.withdraw(new anchor.BN(shares)).accounts({
    vaultState, tokenMint, userCard: cardPda(user.publicKey), tokenVault, shareMint,
    userTokenAccount: userTokens.get(user.publicKey.toBase58()), userShareAccount: userShares.get(user.publicKey.toBase58()),
    user: user.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
  }).signers([user]).rpc();
  const mustFail = async (action: () => Promise<unknown>) => {
    let failed = false;
    try { await action(); } catch { failed = true; }
    assert.equal(failed, true, "instruction should fail");
  };

  before(async () => {
    for (const user of [userA, userB, userWithoutCard]) await fundUser(user);
    tokenMint = await createMint(provider.connection, admin, admin.publicKey, null, 6);
    [vaultState] = PublicKey.findProgramAddressSync([Buffer.from("vault"), tokenMint.toBuffer()], program.programId);
    [tokenVault] = PublicKey.findProgramAddressSync([Buffer.from("token_vault"), tokenMint.toBuffer()], program.programId);
    [shareMint] = PublicKey.findProgramAddressSync([Buffer.from("share_mint"), tokenMint.toBuffer()], program.programId);
    await program.methods.initializeVault().accounts({vaultState, tokenVault, shareMint, tokenMint, admin: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId}).rpc();
    for (const user of [userA, userB]) await program.methods.createUserCard().accounts({vaultState, userCard: cardPda(user.publicKey), user: user.publicKey, systemProgram: SystemProgram.programId}).signers([user]).rpc();
    for (const user of [userA, userB, userWithoutCard]) {
      const key = user.publicKey.toBase58();
      userTokens.set(key, await createAccount(provider.connection, admin, tokenMint, user.publicKey));
      userShares.set(key, await createAccount(provider.connection, admin, shareMint, user.publicKey));
      await mintTo(provider.connection, admin, tokenMint, userTokens.get(key)!, admin, 1_000 * UNIT);
    }
  });

  it("A deposits 100 tokens and receives 100 shares", async () => {
    await deposit(userA, 100 * UNIT);
    assert.equal((await getAccount(provider.connection, userShares.get(userA.publicKey.toBase58())!)).amount, BigInt(100 * UNIT));
  });
  it("B deposits 50 tokens and gets the proportional shares", async () => {
    await deposit(userB, 50 * UNIT);
    const vault = await program.account.vaultState.fetch(vaultState);
    assert.equal(vault.totalDeposited.toNumber(), 150 * UNIT);
    assert.equal((await getAccount(provider.connection, tokenVault)).amount, BigInt(150 * UNIT));
  });
  it("A withdraws half of their shares and gets half the tokens", async () => {
    const before = (await getAccount(provider.connection, userTokens.get(userA.publicKey.toBase58())!)).amount;
    await withdraw(userA, 50 * UNIT);
    const after = (await getAccount(provider.connection, userTokens.get(userA.publicKey.toBase58())!)).amount;
    assert.equal(after - before, BigInt(50 * UNIT));
    const card = await program.account.userCard.fetch(cardPda(userA.publicKey));
    assert.equal(card.deposited.toNumber(), 50 * UNIT);
    assert.equal(card.shares.toNumber(), 50 * UNIT);
  });
  it("B withdraws all shares and gets their tokens back", async () => {
    await withdraw(userB, 50 * UNIT);
    assert.equal((await getAccount(provider.connection, userShares.get(userB.publicKey.toBase58())!)).amount, 0n);
    assert.equal((await getAccount(provider.connection, userTokens.get(userB.publicKey.toBase58())!)).amount, BigInt(1_000 * UNIT));
  });
  it("rejects withdrawing zero shares", async () => mustFail(() => withdraw(userA, 0)));
  it("rejects withdrawing more shares than the user owns", async () => mustFail(() => withdraw(userA, 51 * UNIT)));
  it("requires a user card before withdrawal", async () => mustFail(() => withdraw(userWithoutCard, UNIT))); 
  it("keeps the vault total consistent after withdrawals", async () => {
    const vault = await program.account.vaultState.fetch(vaultState);
    assert.equal(vault.totalDeposited.toNumber(), 50 * UNIT);
  });
  it("tracks the user's remaining shares in their card", async () => {
    const card = await program.account.userCard.fetch(cardPda(userA.publicKey));
    assert.equal(card.deposited.toNumber(), 50 * UNIT);
    assert.equal(card.owner.toBase58(), userA.publicKey.toBase58());
    assert.equal(card.shares.toNumber(), 50 * UNIT);
  });
  it("rejects creating a second card for the same user", async () => {
    await mustFail(() => program.methods.createUserCard().accounts({vaultState, userCard: cardPda(userA.publicKey), user: userA.publicKey, systemProgram: SystemProgram.programId}).signers([userA]).rpc());
  });
  it("requires a user card before deposit", async () => mustFail(() => deposit(userWithoutCard, UNIT)));
  it("rejects depositing zero tokens", async () => mustFail(() => deposit(userA, 0)));

});
