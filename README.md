# Week 11 — AMM and Raydium CLMM

This week I studied how an AMM prices swaps from the assets in a pool and how concentrated liquidity lets a liquidity provider choose a lower and upper price for a position. A position earns fees only while the market price is inside its chosen range. A wider range covers more prices; a narrower range uses capital more efficiently but can go out of range sooner.

For the practical part, I prepared scripts to create two of my own SPL test tokens on Solana devnet and initialize a Raydium CLMM pool for the pair. The pool starts at a 1:1 price. This assignment asks for the test tokens and the pool, so I did not add a liquidity position or a swap.

## Account flow

```text
My devnet wallet
  ├─ creates W11A and W11B mint accounts (6 decimals)
  ├─ receives 1,000,000 of each test token
  └─ pays transaction fees and account rent

Raydium CLMM program (devnet)
  └─ initializes the pool, its token vaults, and pool state
```

The test token mints use the standard SPL Token Program. The pool is initialized by Raydium's CLMM program, not by a new Anchor program in this repository. The pool state stores the selected fee configuration and initial square-root price. At this stage, I have not deposited tokens into the pool; that requires opening a separate CLMM position with a chosen price range.

## Create the devnet tokens and pool

I used Node.js 22, Yarn, and the Raydium SDK v2. Install dependencies first:

```bash
yarn install
```

Set the Solana CLI to devnet and make sure the configured wallet has devnet SOL for mint accounts, token accounts, pool accounts, and fees:

```bash
solana config set --url devnet
solana balance
```

The scripts use the devnet RPC endpoint and `~/.config/solana/id.json` by default. To use another keypair file, set `KEYPAIR`. The secret key stays local and must not be committed or shared.

Create the two test mints and mint 1,000,000 tokens of each to the wallet:

```bash
yarn create:test-tokens:devnet
```

The script asks before sending transactions and saves public mint addresses in `.week11-mints.json`, which is ignored by Git. Then initialize the pool:

```bash
yarn create:clmm-pool:devnet
```

The pool script shows the devnet program, selected fee tier, derived configuration PDA, and pool address before asking to submit the pool transaction. If creation succeeds, it prints Explorer links for the pool and transaction. Keep the mint file between the two commands and use the same wallet for both.

## Devnet results

I will add the live links here after I run and confirm the transactions with my devnet wallet:

- W11A mint: pending
- W11B mint: pending
- Raydium CLMM pool: pending
- Token creation transaction links: pending
- Pool initialization transaction: pending

Until those transactions are confirmed, the scripts and setup are ready, but no Week 11 token or pool address is being claimed as deployed.

## What I learned

- In a basic constant-product AMM, the reserves follow `x × y = k`; a swap changes the reserve ratio and therefore the price.
- A CLMM position provides liquidity only between two tick boundaries instead of across the full price curve.
- The fee tier sets the pool's trading fee, while tick spacing constrains which range boundaries can be used for positions.
- A pool can be initialized before any liquidity position is opened. The pool alone is not yet usable for swaps with meaningful liquidity.

## References

- [Raydium CLMM guide](https://docs.raydium.io/products/clmm)
- [Raydium official SDK v2 pool-creation example](https://github.com/raydium-io/raydium-sdk-V2-demo/blob/master/src/clmm/createPool.ts)
- [Raydium program addresses](https://docs.raydium.io/reference/program-addresses)
