# Liquidity Vault — Week 10: CPI and Withdrawals

This week I added the withdrawal part to my vault. A user can redeem share tokens and get their proportional amount of SPL tokens back. The program burns the shares first, then transfers tokens from the vault with its PDA as signer.

I used Anchor 0.31.1. This branch continues the Week 8 scaffold and Week 9 deposit flow.

## What I built

- `withdraw(shares)` accepts the number of share-token base units to redeem.
- The program checks the user card, vault, mint, and token-account addresses and authorities.
- It burns shares from the user's share-token account through the SPL Token Program.
- It transfers the corresponding accepted tokens from the vault token account. The vault PDA signs this CPI with its seeds and bump.
- It updates `VaultState.total_deposited` after the transfer.

## Share calculation

Withdrawals use the current vault totals, so the user receives their current fraction of the vault:

```text
tokens_out = shares × vault.total_deposited / share_mint.supply
```

The calculation uses `u128` for the intermediate multiplication and rounds down to token base units. The instruction rejects zero shares, shares above the user's balance, inconsistent vault totals, arithmetic overflow, and an amount that rounds down to zero.

The user card's `deposited` value remains a record of gross deposits. The user's share-token balance is the current withdrawable claim, because shares can be transferred between wallets.

## Why the PDA signs the transfer

The vault token account is controlled by the vault PDA. A normal wallet cannot sign for that address because a PDA has no private key. During the CPI, my program supplies the PDA seeds and bump with `new_with_signer`, so the Token Program can verify that the program authorized the transfer. The user signs the burn of their own shares.

Both CPI calls are in the same Solana instruction. If the transfer fails after the burn call, the transaction is rolled back and the shares are not lost.

## Build

I used Rust stable, Node.js 22, Yarn, Solana CLI, and Anchor CLI 0.31.1:

```bash
yarn install
anchor build
yarn tsc --noEmit
```

The program ID is `7deCasDiUCe9D4T4QD8RYMzxMameRDpeE1yZAv4J3o4S`. The Week 9 devnet deposit is in the vault, so the program can be upgraded at the same address to try the new instruction. Before calling `withdraw`, build this branch and deploy it with the configured devnet wallet.

## Devnet accounts from my Week 9 setup

| Account | Explorer |
|---|---|
| Program | [7deCasDiUCe9D4T4QD8RYMzxMameRDpeE1yZAv4J3o4S](https://explorer.solana.com/address/7deCasDiUCe9D4T4QD8RYMzxMameRDpeE1yZAv4J3o4S?cluster=devnet) |
| Accepted token mint | [3ZF2ErKWGGpZAK4HEWPTgk4kxF95avg5qEKSZS8R7fVm](https://explorer.solana.com/address/3ZF2ErKWGGpZAK4HEWPTgk4kxF95avg5qEKSZS8R7fVm?cluster=devnet) |
| Vault state | [5tTHydct51S4mUeP3YHfgVkvv58fVQFQ2gxkbKGMmob6](https://explorer.solana.com/address/5tTHydct51S4mUeP3YHfgVkvv58fVQFQ2gxkbKGMmob6?cluster=devnet) |
| Vault token account | [EQuEpnsP7Ld6tcbrG46ViJ5pMMA76fLnvNvZyyqTLxqp](https://explorer.solana.com/address/EQuEpnsP7Ld6tcbrG46ViJ5pMMA76fLnvNvZyyqTLxqp?cluster=devnet) |
| Share mint | [FxNGzH6bM7u2nNSwR2vMYhhG72wJRQ9DwpCm3kiLpgAp](https://explorer.solana.com/address/FxNGzH6bM7u2nNSwR2vMYhhG72wJRQ9DwpCm3kiLpgAp?cluster=devnet) |
| User card | [4o6tfffq4AFVLXQ5sEMnh9HHeDXmVM83QcSns6hAw8h9](https://explorer.solana.com/address/4o6tfffq4AFVLXQ5sEMnh9HHeDXmVM83QcSns6hAw8h9?cluster=devnet) |

The Week 9 demo deposited 1 test token and minted 1 share token: [view deposit transaction](https://explorer.solana.com/tx/2acZRqaqJgYiX3zndDSUhKBs22UeSinMoJBktppYXzo6bMPoWD7sZCJFo1MKdDDB2pgGutWsbLhRsmAU1Vtpqvw2?cluster=devnet). I have not linked a Week 10 withdrawal transaction yet.

## What I learned

- Burning shares makes the supply reflect the remaining claims on the vault.
- `new_with_signer` lets the program authorize a Token Program CPI using PDA seeds.
- The PDA is the authority for the vault's token account, so the admin wallet cannot withdraw those tokens directly.
- Keeping the burn and transfer in one instruction gives the withdrawal atomic behavior.
