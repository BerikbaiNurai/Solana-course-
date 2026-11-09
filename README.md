# Liquidity Vault — Week 9: Deposit and Share Tokens

This week I added the deposit flow to the vault I started in Week 8. A user can deposit SPL tokens, and the program gives them share tokens as a receipt for their part of the vault. Withdrawals and placing funds in an external liquidity pool are later steps, so they are not included here.

The program uses Anchor 0.31.1. The Solana SBF toolchain is pinned in `Anchor.toml`, and `Cargo.lock` keeps the Rust dependency versions fixed.

## What I built

- `initialize_vault` creates the vault settings, its token account, and the share mint.
- `create_user_card` opens a PDA card for a user and this vault.
- `deposit(amount)` transfers the user's SPL tokens into the vault and mints share tokens to the user.

### The Week 8 scaffold

`VaultState` stores the admin, accepted token mint, vault token account, share mint, total deposits, and PDA bump. The token account is owned by the SPL Token Program, but its authority is the `VaultState` PDA. The vault PDA is also the mint authority for the share mint.

Each `UserCard` is derived from the `user_card` seed, the vault address, and the user's wallet. The program can find the card from those addresses without keeping a separate list of users.

### How a deposit works

The user signs `deposit(amount)`. The instruction checks the user's card and token accounts, and verifies the mint and authorities. Then it makes two CPI calls to the SPL Token Program:

1. `transfer` moves the deposited tokens from the user's token account to the vault token account.
2. `mint_to` creates share tokens for the user's share account. The program signs this CPI with the vault PDA seeds and bump.
3. The program updates `total_deposited` in `VaultState` and `deposited` in the user's card.

For the first deposit, shares are issued 1:1. Later deposits use the current vault totals:

```text
shares = amount × share_mint.supply / vault.total_deposited
```

I use the share mint supply as the total number of shares instead of storing a duplicate `total_shares` field. The calculation uses `u128` for the intermediate value. The program rejects a zero deposit, overflow, mismatched decimals, and deposits that would round down to zero shares. The token mint and share mint use the same number of decimals.

## Build and run the demo

I used Rust stable, Node.js 22, Yarn, Solana CLI, and Anchor CLI 0.31.1. To build the program and run the TypeScript checks:

```bash
yarn install
anchor build
yarn tsc --noEmit
```

For the test mint in my devnet setup, this command creates any missing token accounts, mints 1 demo token to the wallet, and deposits it:

```bash
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com ANCHOR_WALLET="$HOME/.config/solana/id.json" yarn deposit:devnet 3ZF2ErKWGGpZAK4HEWPTgk4kxF95avg5qEKSZS8R7fVm 1 --mint-demo
```

The `--mint-demo` option only works when the wallet is the mint authority for the test token.

## My devnet deployment and deposit

I deployed the Week 9 build using the same program ID and vault accounts from Week 8. The demo deposit moved 1 test token into the vault and gave the user 1 share token. The user's token account now has 0 test tokens left, and the share account holds 1 share (1,000,000 base units with 6 decimals). Both transactions were finalized.

| Account | Explorer |
|---|---|
| Liquidity Vault program | [7deCasDiUCe9D4T4QD8RYMzxMameRDpeE1yZAv4J3o4S](https://explorer.solana.com/address/7deCasDiUCe9D4T4QD8RYMzxMameRDpeE1yZAv4J3o4S?cluster=devnet) |
| ProgramData | [HfuTjgLcVD52kqtwUWWzHbkrWVfKxBAEE7o5TBELb1Yh](https://explorer.solana.com/address/HfuTjgLcVD52kqtwUWWzHbkrWVfKxBAEE7o5TBELb1Yh?cluster=devnet) |
| Test token mint | [3ZF2ErKWGGpZAK4HEWPTgk4kxF95avg5qEKSZS8R7fVm](https://explorer.solana.com/address/3ZF2ErKWGGpZAK4HEWPTgk4kxF95avg5qEKSZS8R7fVm?cluster=devnet) |
| `VaultState` | [5tTHydct51S4mUeP3YHfgVkvv58fVQFQ2gxkbKGMmob6](https://explorer.solana.com/address/5tTHydct51S4mUeP3YHfgVkvv58fVQFQ2gxkbKGMmob6?cluster=devnet) |
| Vault token account | [EQuEpnsP7Ld6tcbrG46ViJ5pMMA76fLnvNvZyyqTLxqp](https://explorer.solana.com/address/EQuEpnsP7Ld6tcbrG46ViJ5pMMA76fLnvNvZyyqTLxqp?cluster=devnet) |
| Share mint | [FxNGzH6bM7u2nNSwR2vMYhhG72wJRQ9DwpCm3kiLpgAp](https://explorer.solana.com/address/FxNGzH6bM7u2nNSwR2vMYhhG72wJRQ9DwpCm3kiLpgAp?cluster=devnet) |
| User card | [4o6tfffq4AFVLXQ5sEMnh9HHeDXmVM83QcSns6hAw8h9](https://explorer.solana.com/address/4o6tfffq4AFVLXQ5sEMnh9HHeDXmVM83QcSns6hAw8h9?cluster=devnet) |
| User token account | [4etSxC5m9xjRDuk7jmxC1eqwayHdFByQf3jowfZCJBPs](https://explorer.solana.com/address/4etSxC5m9xjRDuk7jmxC1eqwayHdFByQf3jowfZCJBPs?cluster=devnet) |
| User share account | [82Ed4Q5ncmW1LWKjMWH7yEHNLvDhS8ZDKZVYt1SXH9dK](https://explorer.solana.com/address/82Ed4Q5ncmW1LWKjMWH7yEHNLvDhS8ZDKZVYt1SXH9dK?cluster=devnet) |

- [Week 9 program deployment](https://explorer.solana.com/tx/4RyQuFVfRh2BJFaBGiL4iS3oPPzya4YYBXLiLDXbEscEq3THrLsABrdAUFtGx46FrEc2D4hixLULdP17VMptDuhu?cluster=devnet), slot 520326963.
- [Deposit of 1 test token and minting of 1 share token](https://explorer.solana.com/tx/2acZRqaqJgYiX3zndDSUhKBs22UeSinMoJBktppYXzo6bMPoWD7sZCJFo1MKdDDB2pgGutWsbLhRsmAU1Vtpqvw2?cluster=devnet).

## What I learned

- The user signs the token transfer, while the vault PDA signs the share-token minting CPI.
- The number of shares depends on the vault deposits and the share mint supply.
- The `UserCard` keeps the user's deposit total; the share account holds the receipt tokens themselves.
- The mint and authority checks help prevent using the wrong token account or sending shares to another wallet.
