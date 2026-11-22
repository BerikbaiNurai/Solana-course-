# Week 14 — My Liquidity Vault dApp

For the capstone, I turned my Liquidity Vault into a small web app. I wanted a user to connect a wallet, deposit test tokens, see the share tokens they received, and withdraw them again without using terminal commands. The app reads the vault and CLMM position from Solana Devnet; the program still controls the vault accounts.

## What I built

- Phantom wallet connection for Solana Devnet.
- Token A and Token B vault views with wallet balance, vault balance, total deposits, receipt shares, and the user's PDA card.
- Deposit and withdraw forms. The app creates the user's token accounts and card when needed, then asks the wallet to sign the transaction.
- An admin page for exact-input swaps through the Raydium CLMM pool. It quotes the swap, applies a minimum-output slippage limit, and asks the wallet to approve it.
- Admin controls to initialize the position controller, open a price range, collect fees, and close the position. The app checks that the connected wallet administers both vaults.
- Explorer links after successful transactions, so I can check the on-chain result.
- Eight unit tests for amount handling, PDA derivation, account decoding, and the client IDL instructions.
- A small browser polyfill for `Buffer`, which Solana's JavaScript packages need to run in the app.

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

This is a course prototype. It is configured for the two public Devnet test mints above, not arbitrary tokens or mainnet funds. The Admin page only works with the wallet that is administrator of both vaults. Rebalancing a position after the pool price leaves its range is still available through the Week 13 CLI command. The vault program and PDAs are the source of truth for balances and share ownership.

I checked the production build and all eight unit tests. I also opened the app in Chrome and checked that both the Vault and Admin pages render. I could not finish the wallet click-through because Phantom was not available in that Chrome profile. I still need to connect Phantom on Devnet and check the transactions in the wallet.

## What I learned

The wallet is only used to approve transactions. The vault PDA owns the token account, while the user card keeps the user's deposit record and share tokens stay in the user's wallet. Keeping those parts visible in the app helped me connect the Solana account model to the product flow.
