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

## Devnet setup

I used the Week 11 test pair:

- W11A: `jSmbzFUSKYLaYrcm9cbgDyV7vxKLKXcVP9sv7jwjcrs`
- W11B: `JAGfeWQD8ZUi2kkHUF7pBR7SakND9NMugUQ1PmCnkjyY`
- CLMM pool: `HGuzZ8Ee9sCnHF7i5XUBRfT5yFNe37HavsACLGzAQdDA`

The Week 11 pool was created without an active liquidity position. Before the swap demo, the seed script below opens a small external test position so the pool can fill the trade. That wallet position is only pool liquidity; the swap still spends tokens from the vault PDA and burns the user's shares.

Install dependencies and build/deploy the updated vault program:

```bash
yarn install --frozen-lockfile
anchor build
yarn deploy:devnet
```

Create the test liquidity position, initialize a vault for W11A, and deposit W11A:

```bash
yarn seed:clmm:devnet HGuzZ8Ee9sCnHF7i5XUBRfT5yFNe37HavsACLGzAQdDA
yarn setup:devnet jSmbzFUSKYLaYrcm9cbgDyV7vxKLKXcVP9sv7jwjcrs
yarn deposit:devnet jSmbzFUSKYLaYrcm9cbgDyV7vxKLKXcVP9sv7jwjcrs 1000
```

Then swap 10 W11A into W11B with a 1% maximum slippage:

```bash
yarn swap:devnet HGuzZ8Ee9sCnHF7i5XUBRfT5yFNe37HavsACLGzAQdDA jSmbzFUSKYLaYrcm9cbgDyV7vxKLKXcVP9sv7jwjcrs JAGfeWQD8ZUi2kkHUF7pBR7SakND9NMugUQ1PmCnkjyY 10 100
```

The last argument is slippage in basis points: `100` means 1%. The script shows the quote and exact minimum output before asking to submit the swap. It uses `~/.config/solana/id.json` by default; set `KEYPAIR` to use another local keypair. Never commit or share a secret key.

## Devnet results

The code and commands are ready, but I have not run the Week 12 program upgrade or swap transaction yet. I will add the Explorer links here after the devnet transactions are confirmed.

- Program upgrade: not run for Week 12
- Test liquidity position: not opened yet
- W11A vault state and deposit: not created yet
- Vault-to-CLMM swap transaction: not submitted yet

## What I learned

- A CLMM exact-input swap takes both an input amount and a minimum acceptable output.
- Slippage protection belongs in the on-chain swap instruction, not only in a client-side quote.
- A vault PDA can authorize a Raydium CPI with its seeds, while the user authorizes burning their own shares.
- A pool without an active liquidity position cannot fill a swap, so the devnet demo needs test liquidity first.

## References

- [Raydium CLMM instruction reference](https://docs.raydium.io/products/clmm/instructions)
- [Raydium official CLMM swap SDK example](https://github.com/raydium-io/raydium-sdk-V2-demo/blob/master/src/clmm/swap.ts)
- [Raydium CPI example](https://github.com/raydium-io/raydium-cpi-example/blob/master/clmm-cpi/programs/clmm-cpi/src/instructions/proxy_swap.rs)
