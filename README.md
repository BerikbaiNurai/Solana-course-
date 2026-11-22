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
yarn clmm:position open "$POOL" "$MINT_0" "$MINT_1" 0.8 1.25 1500000 1800000
```

I can collect fees and close the position with these commands:

```bash
yarn clmm:position collect "$POOL" "$MINT_0" "$MINT_1"
yarn clmm:position close "$POOL" "$MINT_0" "$MINT_1"
```

The pool needs trades for fees to build up. If no swaps happen while the position is active, there may be nothing to collect.

To check whether the price left my range and move the position if needed, I run:

```bash
yarn clmm:position rebalance "$POOL" "$MINT_0" "$MINT_1" 5 500000 500000
```

Here `5` sets the new range around the current tick. This script is a simple keeper that I run when I want to check the price; Solana programs do not wake up by themselves when the market moves.

## What I checked

The Rust program passes `cargo check --features idl-build --locked`, the SBF build completes without stack-frame errors, and the TypeScript files pass `npx tsc --noEmit`. I also checked the instructions on Devnet. The controller PDA is `Hqyd7ufiFVjUUUQBR1vSdAwvVV7KuDZwVqapzcxpe8rP`, and the final position is open in ticks `-720..300`.

Here are the transactions I used:

- [Updated the vault program](https://explorer.solana.com/tx/95E8JMcFZfU85xawZHCWdrduQeBncZGyQekpfqNruSHCuJ1E93tnDgcwNzzscA6i4pPn9rK9feC2GbvLPeHMXMA?cluster=devnet)
- [Created the Token B vault](https://explorer.solana.com/tx/66dmCDqZHgh6cxT3UXy4zK1UejHw2GAUNKAXFW2VGTJynJTGxnEe1XFf4M6k3ztM6FVHdSFUphhJpJesebJkNDDB?cluster=devnet) and [deposited tokens into both vaults](https://explorer.solana.com/tx/2DeL8J2trsZgD5TdfLceJDo3hhWBeCisQutN2dG5XD5mXajXfMuy9YTtbvSkgTdEuZcaMr7S5eSoFSbFV8YFcF3k?cluster=devnet), [Token B](https://explorer.solana.com/tx/4cXkBCNW9QUuoZpYGeyDPYhCvhGNiM4hfvqK92QSbx41JLw3TBwrSJt5VBCeUqGrtYsEw2wB8HEetgiZB33gCnbY?cluster=devnet)
- [Created the position controller](https://explorer.solana.com/tx/4jWrfGeeVdLU8QysjnrrcKMgKzZrdU3NHsv2BY364xtyzXVB94kvDsajXfNGMdVBjjrgRrFrRCbSfGyJNTAU7yko?cluster=devnet) and [opened the first position](https://explorer.solana.com/tx/31EZqRyJmjTpnaVhBRCwXG45BfbJspo5Q7npNd4PvT64jK7EfwFXShXXpDS1sxQpFoW9tp1VYg7eqF8AoNNy5q4N?cluster=devnet)
- [Swapped tokens through the vault](https://explorer.solana.com/tx/6JHudYCZkuuVLvEvhv5sHsuN6Sv9VrNa8bBaXYqZCXM2B7JpAZBbrRedW3C5NGiYscDsEtEbfV5fZQhs2xR8AGZ?cluster=devnet) and [collected 87 base units of Token A fees](https://explorer.solana.com/tx/5BGhbF5hyhgsw4uyToqrB5tKbsCDi4P3NamWVszLNJxsKRo515tWyzZtG3QG99HiLPwPP832yDWzcUpwCdcUiRrN?cluster=devnet)
- [Closed a position](https://explorer.solana.com/tx/4tHCbErjWLch1Ypb6Cx16AsRqwTeNeSpBwZLVRWTg9asW7xPE3vhGn7hvVAgXXFq4mzDhEnhL2Yd3sKeinhCsHM4?cluster=devnet)
- [Moved the price outside a narrow range](https://explorer.solana.com/tx/2C2ormdtiJbnHQyzz3kxQUKyey4YJPUk1raQKjCrpfpbUXb1Qj9pdBS54gD884h846r4sZyWHhFVaZ3jXrcP5uos?cluster=devnet), then the keeper [closed the old position](https://explorer.solana.com/tx/2hR88kWH9hcsdgBPKVC8KsZoDBaXN93kqmBW5yaVrBPmv9gtwR6nLcTBUiSW92tS9ChhgWSoXZMSiwitFMZLZuxH?cluster=devnet) and [opened a new range around the current tick](https://explorer.solana.com/tx/e7m7MBmrkCcT3uK3ts3geBZF9wogum3WQrjK645dTm4WRiWyASBNUS5vgreWWoBwuRtqGpBkCXcPdjSv3iJ1URU?cluster=devnet)

The fee collection happened after a swap while the position was active. Only Token A had a small fee to collect; the amount was 87 base units, or `0.000087` tokens with six decimals. Devnet test tokens do not have real value.

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
