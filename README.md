# Week 13 — My Raydium CLMM Position

This week I worked on the next part of my vault. I added instructions so the vault can put two tokens into a Raydium CLMM pool, collect fees, and take its liquidity back out. I also wrote a small script that checks whether the pool price has moved outside my range. If it has, the script closes the old position and opens a new one around the current price.

## How I set it up

I used the test tokens and pool from Week 12:

- Token A: [`7S6KLpGa4HjC4BtuQKsrmufKcUtky7WTn7jwDM1Pnj2E`](https://explorer.solana.com/address/7S6KLpGa4HjC4BtuQKsrmufKcUtky7WTn7jwDM1Pnj2E?cluster=devnet)
- Token B: [`HxxdDXKJN3n3kWfutQ1PjTkHXFHtvHqNz9atwLEu3Kvh`](https://explorer.solana.com/address/HxxdDXKJN3n3kWfutQ1PjTkHXFHtvHqNz9atwLEu3Kvh?cluster=devnet)
- Raydium pool: [`3R29TR1M6hmJAPF3QfiKkErMowhEHHpvprRdKecLBSmt`](https://explorer.solana.com/address/3R29TR1M6hmJAPF3QfiKkErMowhEHHpvprRdKecLBSmt?cluster=devnet)
- Vault program: [`7deCasDiUCe9D4T4QD8RYMzxMameRDpeE1yZAv4J3o4S`](https://explorer.solana.com/address/7deCasDiUCe9D4T4QD8RYMzxMameRDpeE1yZAv4J3o4S?cluster=devnet)

The vault program owns each token account through a PDA. I made a second vault for Token B so the position can use both sides of the pool. A separate position-controller PDA owns Raydium's position NFT. This means the vault program can manage the position without giving the NFT to my wallet.

```text
Token A vault PDA ─┐
                   ├─ Raydium position
Token B vault PDA ─┘          │
Position controller PDA ──────┘ owns the position NFT
```

## What I added

- `initialize_position_controller` makes one controller account for my two vaults and the selected pool.
- `open_clmm_position` checks the token mints, range, and available balances, then calls Raydium from the program. It only allows the specified maximum amounts to be transferred.
- `collect_clmm_fees` asks Raydium to update the position and sends collected fees back to the two vault token accounts.
- `close_clmm_position` removes all liquidity, collects any remaining fees, closes the old position, and prepares the controller for a new one.
- The `rebalance` script checks the current pool tick. If the price is still in range, it does nothing. If the price has left the range, it closes the position and opens a new one around the current price.

## Running it on devnet

I use the same devnet wallet that administers both vaults. I set these variables in my terminal and install the packages:

```bash
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
export ANCHOR_WALLET="$HOME/.config/solana/id.json"
yarn install --frozen-lockfile
```

The Token A vault is from Week 12. I create a vault for Token B and deposit some of each token. I need enough of both tokens for the range I choose:

```bash
yarn setup:devnet HxxdDXKJN3n3kWfutQ1PjTkHXFHtvHqNz9atwLEu3Kvh
yarn deposit:devnet 7S6KLpGa4HjC4BtuQKsrmufKcUtky7WTn7jwDM1Pnj2E 2
yarn deposit:devnet HxxdDXKJN3n3kWfutQ1PjTkHXFHtvHqNz9atwLEu3Kvh 2
```

Before using the new instructions, I build and deploy the updated program:

```bash
yarn build:sbf
yarn deploy:devnet
```

Then I create the position controller and open a range. The two mint arguments must be in the same order as the pool's Token A and Token B. The price values mean Token B per Token A. The last two values are maximum amounts in base units; for six-decimal tokens, `1000000` is one token.

```bash
POOL=3R29TR1M6hmJAPF3QfiKkErMowhEHHpvprRdKecLBSmt
MINT_0=7S6KLpGa4HjC4BtuQKsrmufKcUtky7WTn7jwDM1Pnj2E
MINT_1=HxxdDXKJN3n3kWfutQ1PjTkHXFHtvHqNz9atwLEu3Kvh

yarn clmm:position init "$POOL" "$MINT_0" "$MINT_1"
yarn clmm:position open "$POOL" "$MINT_0" "$MINT_1" 0.8 1.25 1000000 1000000
```

I can collect fees and close the position with these commands:

```bash
yarn clmm:position collect "$POOL" "$MINT_0" "$MINT_1"
yarn clmm:position close "$POOL" "$MINT_0" "$MINT_1"
```

The pool needs trades for fees to build up. If no swaps happen while the position is active, there may be nothing to collect.

To check whether the price left my range and move the position if needed, I run:

```bash
yarn clmm:position rebalance "$POOL" "$MINT_0" "$MINT_1" 5 1000000 1000000
```

Here `5` sets the new range around the current tick. This script is a simple keeper that I run when I want to check the price; Solana programs do not wake up by themselves when the market moves.

## What I checked

The Rust program passes `cargo check --features idl-build --locked` and the SBF build completes without stack-frame errors. The TypeScript files also pass `npx tsc --noEmit`.

I have not added Week 13 Devnet transaction links yet. I checked the program on Devnet and found that its upgrade authority is `A4LCC3q4PZt3orzGqowwMyJE23Xb5hxg1aizq3DRpucj`, while the wallet available to me is `DLgXdGoVya6j8iL4dnM75JxxbPA31XJLt28kJaUAMi4y`. I need the wallet that controls the upgrade authority to deploy these changes to the existing program. Until then, I cannot confirm the position, fee collection, close, or rebalance transactions on Explorer.

## What I learned

- The position NFT has to stay with the vault controller if the vault is going to manage the Raydium position.
- The vault only gives the CPI permission to use the maximum token amounts I set, then removes that permission.
- A position can earn fees only while swaps happen in the pool.
- I need a keeper script to notice when the price leaves the range and send the transactions to move the position.

## Links I used

- [Raydium CLMM instructions](https://docs.raydium.io/products/clmm/instructions)
- [Raydium CLMM program](https://github.com/raydium-io/raydium-clmm)
- [Raydium CPI library for Anchor 0.31.1](https://github.com/raydium-io/raydium-cpi/tree/anchor-0.31.1)
- [Raydium CPI example](https://github.com/raydium-io/raydium-cpi-example/tree/master/clmm-cpi)
