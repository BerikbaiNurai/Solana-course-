# Liquidity Vault — Week 10: CPI and Withdrawals

This week I added withdrawals to my vault. A user can burn share tokens and receive the matching amount of the accepted SPL token. The vault sends tokens from its own token account, and the vault PDA signs that transfer through a Token Program CPI.

## What I changed

- Added a `withdraw` instruction that takes the amount of share tokens to redeem.
- The program checks the vault, user card, mints, token accounts, and authorities before doing the CPIs.
- The user's shares are burned with the SPL Token Program. The user signs this operation.
- The accepted tokens are transferred from the vault token account with `new_with_signer` and the vault PDA seeds.
- The program updates the vault total and the user's recorded shares and deposited amount.
- Zero withdrawals, an empty vault, invalid amounts, and arithmetic overflow are rejected.

## Withdrawal calculation

The user receives their proportional part of the vault:

```text
amount_out = shares_to_burn * vault.total_deposited / share_mint.supply
```

The multiplication uses `u128` before division to reduce overflow risk. The result is rounded down to token base units. If a transaction fails during either CPI, Solana rolls back the whole instruction, so the user does not lose shares without receiving tokens.

## Why the vault PDA signs

The vault token account is controlled by the vault PDA. A PDA has no private key, so a wallet cannot sign for it. My program uses the PDA seeds and bump with `new_with_signer` to authorize the Token Program transfer. The admin cannot directly move tokens from this account.

## Run it locally

I tested this branch with Anchor 0.31.1, Node.js 22, Yarn, and the local validator:

```bash
corepack yarn install
anchor build
corepack yarn tsc --noEmit
corepack yarn test
```

The integration suite has 12 scenarios covering initialization, opening a user card, deposits, successful withdrawals, full withdrawal, zero amounts, missing cards, and insufficient shares.

## Devnet status

The Week 9 program and vault links are below for reference. Week 10 was verified on localnet; I have not deployed this updated withdrawal instruction or made a Week 10 withdrawal transaction on devnet.

The Week 10 user card includes additional share accounting. Existing Week 9 cards were created with the older account layout, so use a fresh vault/card for a deployment of this version or add an explicit migration before reusing the old cards. Do not assume an upgrade automatically changes existing account data.

| Account | Week 9 devnet explorer |
|---|---|
| Program | [7deCasDiUCe9D4T4QD8RYMzxMameRDpeE1yZAv4J3o4S](https://explorer.solana.com/address/7deCasDiUCe9D4T4QD8RYMzxMameRDpeE1yZAv4J3o4S?cluster=devnet) |
| Accepted token mint | [3ZF2ErKWGGpZAK4HEWPTgk4kxF95avg5qEKSZS8R7fVm](https://explorer.solana.com/address/3ZF2ErKWGGpZAK4HEWPTgk4kxF95avg5qEKSZS8R7fVm?cluster=devnet) |
| Vault state | [5tTHydct51S4mUeP3YHfgVkvv58fVQFQ2gxkbKGMmob6](https://explorer.solana.com/address/5tTHydct51S4mUeP3YHfgVkvv58fVQFQ2gxkbKGMmob6?cluster=devnet) |
| Vault token account | [EQuEpnsP7Ld6tcbrG46ViJ5pMMA76fLnvNvZyyqTLxqp](https://explorer.solana.com/address/EQuEpnsP7Ld6tcbrG46ViJ5pMMA76fLnvNvZyyqTLxqp?cluster=devnet) |

## What I learned

Burning shares reduces the outstanding claim on the vault. The user signs to burn their own shares, while the program signs for the vault PDA when it transfers the deposited tokens. Keeping both CPIs in one instruction makes the withdrawal atomic.
