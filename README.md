# Week 12 — Swap through Raydium CLMM

This week I added a vault instruction that swaps part of a user's vault claim through a Raydium CLMM pool. The user chooses an exact input amount and a slippage limit. The program burns the matching share tokens, signs the input transfer with the vault PDA, and sends the output token to the user. The swap only succeeds if Raydium returns at least `min_amount_out`; otherwise the whole transaction is rolled back.

## How the swap works

```text
User signs the request and authorizes burning shares
  -> Vault PDA signs the input-token transfer
  -> Vault calls Raydium CLMM with an exact input amount
  -> Raydium checks min_amount_out
  -> Output tokens go to the user's output-token account
```

`amount_in` is in token base units. The script quotes the current pool state and computes the minimum output from the selected slippage in basis points. The on-chain Raydium instruction enforces that minimum, so a stale quote or price move beyond the limit fails atomically. The corresponding share tokens are burned and `total_deposited` is reduced by the input amount, so the swap acts as a partial redemption into the other token.

I used the official Raydium CLMM CPI interface for Anchor 0.31.1. The program validates the selected pool, token pair, vault accounts, user card, and share balance before invoking Raydium. The pool is limited to Raydium's devnet CLMM program.

The client IDL used by the setup, deposit, and swap scripts is checked in at `idl/liquidity_vault.json`. I kept the instruction account lists and argument types there so the scripts can build transactions without reading account state from a generated IDL.

## Devnet setup

The original Week 11 pool had no active liquidity and its token authority belonged to a different wallet. For this Week 12 run, I created a fresh test pair and a new CLMM pool from the wallet configured on my machine:

- W11A: [`7S6KLpGa4HjC4BtuQKsrmufKcUtky7WTn7jwDM1Pnj2E`](https://explorer.solana.com/address/7S6KLpGa4HjC4BtuQKsrmufKcUtky7WTn7jwDM1Pnj2E?cluster=devnet)
- W11B: [`HxxdDXKJN3n3kWfutQ1PjTkHXFHtvHqNz9atwLEu3Kvh`](https://explorer.solana.com/address/HxxdDXKJN3n3kWfutQ1PjTkHXFHtvHqNz9atwLEu3Kvh?cluster=devnet)
- CLMM pool: [`3R29TR1M6hmJAPF3QfiKkErMowhEHHpvprRdKecLBSmt`](https://explorer.solana.com/address/3R29TR1M6hmJAPF3QfiKkErMowhEHHpvprRdKecLBSmt?cluster=devnet)

To reproduce the demo, install the dependencies, make sure the devnet wallet has SOL, and set `ANCHOR_PROVIDER_URL=https://api.devnet.solana.com` and `ANCHOR_WALLET=~/.config/solana/id.json`. The token and pool scripts ask before sending transactions:

```bash
yarn install --frozen-lockfile
yarn create:test-tokens:devnet
yarn create:clmm-pool:devnet
yarn seed:clmm:devnet 3R29TR1M6hmJAPF3QfiKkErMowhEHHpvprRdKecLBSmt
yarn setup:devnet 7S6KLpGa4HjC4BtuQKsrmufKcUtky7WTn7jwDM1Pnj2E
yarn deposit:devnet 7S6KLpGa4HjC4BtuQKsrmufKcUtky7WTn7jwDM1Pnj2E 1000
yarn swap:devnet 3R29TR1M6hmJAPF3QfiKkErMowhEHHpvprRdKecLBSmt 7S6KLpGa4HjC4BtuQKsrmufKcUtky7WTn7jwDM1Pnj2E HxxdDXKJN3n3kWfutQ1PjTkHXFHtvHqNz9atwLEu3Kvh 10 100
```

The last swap argument is slippage in basis points: `100` means 1%. The script quotes the pool and shows the minimum output before asking to submit. It uses `~/.config/solana/id.json` by default; set `KEYPAIR` to use another local keypair. Never commit or share a secret key.

## Devnet results

The program upgrade and all Week 12 demo transactions below are finalized on devnet with no transaction errors.

- Vault program upgrade: [transaction](https://explorer.solana.com/tx/7bFF65ek6Rbk8A1EiL8bQhXeTtribuZ5xhqFcWaZmdfWhyhNcsGDSmyUtyGJUgTRVwvXA5Wakno7GyTD6U3PKu4?cluster=devnet) · [program](https://explorer.solana.com/address/7deCasDiUCe9D4T4QD8RYMzxMameRDpeE1yZAv4J3o4S?cluster=devnet)
- W11A mint: [creation and mint transaction](https://explorer.solana.com/tx/4Jz6SNEBdLjWhp9fHZVCX4p3vbinXXTHu3Z3iRwxK5MdrS52bW5zzo534YpbMKsGpiiVLWbrSY8kSUin2qDVwZFk?cluster=devnet)
- W11B mint: [creation and mint transaction](https://explorer.solana.com/tx/36JxzCjjZuvWm2MbcboFJG7nzoYnfUvbVupW4nq5AToisKwrFqW3vmcZjc5rMkThHTQRToDyb1WavuPAojLAJ8Qw?cluster=devnet)
- CLMM pool: [initialization transaction](https://explorer.solana.com/tx/2ftsUgSMRXPFXB2kku2JNeEhZ4t1Z7UBAxb6srNgBJktrH5PYezZK57cbEbRUGadNKPzmfGtFcitYZWsfQt36rou?cluster=devnet)
- Test liquidity position: [transaction](https://explorer.solana.com/tx/3rrkKKzb1SuZQhHqjAUF4594PpgMwR1spLAbFjJTSshjcxXpkes5yoBWURp1p2yZv7dD17ZUg32f2STfPJ1iFtDW?cluster=devnet) · [position NFT](https://explorer.solana.com/address/DuKSzs8S1FYofFK9TgJqEftxX9wjHs9C7Qs2YiPnjf76?cluster=devnet)
- Vault initialization: [transaction](https://explorer.solana.com/tx/5zNBVNMp5FdWEJtm9cm9Di6g2p8j1LUWire4MvezuGaof6hou5b68xnpnSkkFr2Q1bDLF9Lh2eELcSDcQ9R8jnYn?cluster=devnet)
- User card creation: [transaction](https://explorer.solana.com/tx/32RRtdSU8CqgtPXbweGr3fEdkpo3nRoqhnjiePvhgmhkcbu4CWntBWb8urdE9LBoP1dDCjV3iB9GH67EjBojGhd8?cluster=devnet)
- Deposit of 1,000 W11A and share minting: [transaction](https://explorer.solana.com/tx/5FqWnFYUNxQWgzKMG225DBqPT65PwU8SzESLNnpjahnXruH73M2U3WggoYaw7DfEJQxwmAB2gd8B4Fz4dxSk6qZn?cluster=devnet)
- Vault state: [account](https://explorer.solana.com/address/5J7HsLtkxT74gxQTf4C2ivK67AtDxF17mmUcZdVDAaSE?cluster=devnet) · token vault: [account](https://explorer.solana.com/address/985E6fVDu4FxMPyyNP6nXqzrZm8vXjrcKGHkE3k2fjHz?cluster=devnet) · share mint: [account](https://explorer.solana.com/address/DLp14Xdvqb3PDFkGwTqSvzjzYjvTRuxtxWwVf63edbKt?cluster=devnet) · user card: [account](https://explorer.solana.com/address/8CLtAbdrLo1PWofHxkX2Mvmy7yXjBtdoqGXjEmRhZVqV?cluster=devnet)
- Vault-to-CLMM swap: [transaction](https://explorer.solana.com/tx/58vJPbFuZtt8EAaBFeN8p85T9Pq6oxx4n8zQjgJi8RHtxThQwDFKMKCGPoepbDQTabbitod2SQbieq5HBh561Zti?cluster=devnet)

For the 10 W11A exact-input swap, the quote was 9.972097 W11B, `min_amount_out` was 9.872376 W11B (1% slippage), and the user received 9.972097 W11B. After the swap, the vault and share supply each held 990 W11A-equivalent tokens (990,000,000 base units). I also checked the confirmed account data and the transaction's finalized status.

## What I learned

- A CLMM exact-input swap takes both an input amount and a minimum acceptable output.
- Slippage protection belongs in the on-chain swap instruction, not only in a client-side quote.
- A vault PDA can authorize a Raydium CPI with its seeds, while the user authorizes burning their own shares.
- A pool without an active liquidity position cannot fill a swap, so the devnet demo needs test liquidity first.

## References

- [Raydium CLMM instruction reference](https://docs.raydium.io/products/clmm/instructions)
- [Raydium official CLMM swap SDK example](https://github.com/raydium-io/raydium-sdk-V2-demo/blob/master/src/clmm/swap.ts)
- [Raydium CPI example](https://github.com/raydium-io/raydium-cpi-example/blob/master/clmm-cpi/programs/clmm-cpi/src/instructions/proxy_swap.rs)
