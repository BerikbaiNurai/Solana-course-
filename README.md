# Week 14 — My Liquidity Vault dApp

For the capstone, I turned my Liquidity Vault into a small web app. I wanted a user to connect a wallet, deposit test tokens, see the share tokens they received, and withdraw them again without using terminal commands. The app reads the vault and CLMM position from Solana Devnet; the program still controls the vault accounts.

## What I built

- Phantom wallet connection for Solana Devnet.
- Token A and Token B vault views with wallet balance, vault balance, total deposits, receipt shares, and the user's PDA card.
- Deposit and withdraw forms. The app creates the user's token accounts and card when needed, then asks the wallet to sign the transaction.
- A read-only Raydium CLMM panel that shows the position controller and its current tick range.
- Unit tests for amount parsing, PDA derivation, and account-data decoding.

The app uses the test mints and CLMM pool from the earlier weeks:

- Token A: [`7S6KLpGa4HjC4BtuQKsrmufKcUtky7WTn7jwDM1Pnj2E`](https://explorer.solana.com/address/7S6KLpGa4HjC4BtuQKsrmufKcUtky7WTn7jwDM1Pnj2E?cluster=devnet)
- Token B: [`HxxdDXKJN3n3kWfutQ1PjTkHXFHtvHqNz9atwLEu3Kvh`](https://explorer.solana.com/address/HxxdDXKJN3n3kWfutQ1PjTkHXFHtvHqNz9atwLEu3Kvh?cluster=devnet)
- Raydium CLMM pool: [`3R29TR1M6hmJAPF3QfiKkErMowhEHHpvprRdKecLBSmt`](https://explorer.solana.com/address/3R29TR1M6hmJAPF3QfiKkErMowhEHHpvprRdKecLBSmt?cluster=devnet)
- Vault program: [`7deCasDiUCe9D4T4QD8RYMzxMameRDpeE1yZAv4J3o4S`](https://explorer.solana.com/address/7deCasDiUCe9D4T4QD8RYMzxMameRDpeE1yZAv4J3o4S?cluster=devnet)

## Run the app

I use Node.js 22.12 or newer. These commands run Yarn 1 through `npx`, so I do not need a global Yarn installation:

```bash
npx --yes yarn@1.22.22 install --frozen-lockfile
```

Then start the local web app:

```bash
npx --yes yarn@1.22.22 web:dev
```

Open the local URL printed by Vite. Install Phantom if needed, switch it to Devnet, and connect the wallet that has the test tokens. Deposits and withdrawals are real Devnet transactions, so Phantom will ask for approval. The app never asks for a seed phrase or private key.

## Checks

I run the web unit tests and create a production build with:

```bash
npx --yes yarn@1.22.22 web:test
npx --yes yarn@1.22.22 web:build
```

The Anchor integration tests for deposits and withdrawals are in `tests/liquidity_vault.ts`. They use a local validator and can be run with:

```bash
npx --yes yarn@1.22.22 test
```

That command needs the Anchor CLI and the local Solana validator installed. The Week 13 README has the Devnet transaction links for the deployed vault, deposits, swap, fee collection, close, and position rebalance.

## Notes

This is a course prototype. It is configured for the two public Devnet test mints above, not arbitrary tokens or mainnet funds. The position panel is read-only; position management remains in the Week 13 CLI. The vault program and PDAs are the source of truth for balances and share ownership.

## What I learned

The wallet is only used to approve transactions. The vault PDA owns the token account, while the user card keeps the user's deposit record and share tokens stay in the user's wallet. Keeping those parts visible in the app helped me connect the Solana account model to the product flow.
