# Week 13 — Raydium CLMM Position

This week I added a position controller to the liquidity vault. The vault program can open a Raydium CLMM position from two vault token accounts, collect the position fees back into those vaults, and close the position. A small keeper script checks the current pool tick and can close an out-of-range position before opening a new range around the current price.

## Account flow

```text
Vault state 0 PDA -> vault token account 0 ─┐
                                             ├─ Raydium CLMM position
Vault state 1 PDA -> vault token account 1 ─┘         │
                                                      ├─ Personal position (Raydium)
Position controller PDA -> owns position NFT ─────────┘
```

- Each `VaultState` PDA controls one SPL token account. The two vaults must hold the pool's token 0 and token 1, in Raydium's mint order.
- `PositionState` is a PDA derived from both vault state addresses and the pool address. It stores the active NFT mint, Raydium personal-position account, selected tick range, and NFT generation.
- Raydium owns the personal-position account. The vault program's position-controller PDA owns the position NFT, so an admin cannot move the NFT or withdraw liquidity directly.
- The vault administrator pays rent and authorizes each management instruction. Before the open CPI, each vault PDA grants the admin a one-transaction-sized token delegate allowance; the program revokes both allowances in the same instruction.

## Instructions

- `initialize_position_controller` creates the controller PDA once for a pair of vaults and a pool.
- `open_clmm_position` validates the vaults against the pool mints, validates the range and available balances, and opens the Raydium position by CPI. The amounts are maximum token amounts in base units.
- `collect_clmm_fees` calls Raydium's decrease-liquidity instruction with zero liquidity. Raydium updates the fee growth and transfers any accrued fees to the two vault token accounts.
- `close_clmm_position` removes all liquidity, collects the accrued fees, closes the Raydium position, and increments the NFT generation so a new position can be opened.
- `rebalance` is a keeper action in the TypeScript client. It checks the current tick; if price has left the stored range, it closes the old position and opens a new range around the current tick. It sends no transaction while the position remains in range.

## Devnet setup

I used the test pair and CLMM pool from Week 12:

- Token A: [`7S6KLpGa4HjC4BtuQKsrmufKcUtky7WTn7jwDM1Pnj2E`](https://explorer.solana.com/address/7S6KLpGa4HjC4BtuQKsrmufKcUtky7WTn7jwDM1Pnj2E?cluster=devnet)
- Token B: [`HxxdDXKJN3n3kWfutQ1PjTkHXFHtvHqNz9atwLEu3Kvh`](https://explorer.solana.com/address/HxxdDXKJN3n3kWfutQ1PjTkHXFHtvHqNz9atwLEu3Kvh?cluster=devnet)
- Raydium CLMM pool: [`3R29TR1M6hmJAPF3QfiKkErMowhEHHpvprRdKecLBSmt`](https://explorer.solana.com/address/3R29TR1M6hmJAPF3QfiKkErMowhEHHpvprRdKecLBSmt?cluster=devnet)
- Vault program: [`7deCasDiUCe9D4T4QD8RYMzxMameRDpeE1yZAv4J3o4S`](https://explorer.solana.com/address/7deCasDiUCe9D4T4QD8RYMzxMameRDpeE1yZAv4J3o4S?cluster=devnet)

Use a devnet wallet that is the admin of both vaults. Do not put its keypair or seed phrase in this repository. Set the wallet and RPC locally:

```bash
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
export ANCHOR_WALLET="$HOME/.config/solana/id.json"
yarn install --frozen-lockfile
```

Build and deploy the program before using the new instructions:

```bash
yarn build:sbf
yarn deploy:devnet
```

The sample A vault already exists from Week 12. Create the B vault and deposit enough of both tokens for the chosen range. The setup command also creates the admin's user card:

```bash
yarn setup:devnet HxxdDXKJN3n3kWfutQ1PjTkHXFHtvHqNz9atwLEu3Kvh
yarn deposit:devnet 7S6KLpGa4HjC4BtuQKsrmufKcUtky7WTn7jwDM1Pnj2E 2
yarn deposit:devnet HxxdDXKJN3n3kWfutQ1PjTkHXFHtvHqNz9atwLEu3Kvh 2
```

The pool mint order must match the SDK output (`mintA` then `mintB`). If the pool reports the opposite order for another pair, pass the corresponding vault mints in that order.

```bash
POOL=3R29TR1M6hmJAPF3QfiKkErMowhEHHpvprRdKecLBSmt
MINT_0=7S6KLpGa4HjC4BtuQKsrmufKcUtky7WTn7jwDM1Pnj2E
MINT_1=HxxdDXKJN3n3kWfutQ1PjTkHXFHtvHqNz9atwLEu3Kvh

yarn clmm:position init "$POOL" "$MINT_0" "$MINT_1"
yarn clmm:position open "$POOL" "$MINT_0" "$MINT_1" 0.8 1.25 1000000 1000000
yarn clmm:position collect "$POOL" "$MINT_0" "$MINT_1"
yarn clmm:position close "$POOL" "$MINT_0" "$MINT_1"
```

The range values are token B per token A. `1000000` is one token with six decimals. The pool must have been created with active liquidity in a range that includes the selected range. Fee collection depends on swaps having occurred while the position was active; it can correctly collect zero if no fees accrued.

To let the keeper close and replace the position only after the price leaves the range, leave a position open and run:

```bash
yarn clmm:position rebalance "$POOL" "$MINT_0" "$MINT_1" 5 1000000 1000000
```

`5` selects a new range about five percent wide on either side of the current tick. The keeper signs with the vault admin wallet and pays transaction fees. It checks the pool each time it runs; it is not a continuously running on-chain price monitor.

## Checks and deployment status

I ran the Anchor IDL feature check and the TypeScript type check while adding these instructions. The checked-in `idl/liquidity_vault.json` includes the Week 13 instruction and account definitions.

The devnet program upgrade and Week 13 position transactions still need to be run before I can add finalized transaction links here. I will only mark those operations complete after the explorer shows the confirmed signatures.

## What I learned

- A CLMM position is an NFT-controlled account, so the vault needs to own the NFT through a PDA if the vault is meant to manage that liquidity.
- The vault approves only bounded transfers for opening a position and revokes those allowances immediately after the Raydium CPI.
- Collecting fees and withdrawing liquidity are separate actions; closing the position does both in sequence.
- A program cannot wake itself up when a price moves. A keeper has to check the pool and submit the close-and-reopen transactions.

## References

- [Raydium CLMM instructions](https://docs.raydium.io/products/clmm/instructions)
- [Raydium CLMM program](https://github.com/raydium-io/raydium-clmm)
- [Raydium CPI library for Anchor 0.31.1](https://github.com/raydium-io/raydium-cpi/tree/anchor-0.31.1)
- [Raydium CPI example](https://github.com/raydium-io/raydium-cpi-example/tree/master/clmm-cpi)
