# Liquidity Vault — Week 10: CPI and Withdrawals

This week I added withdrawals to my vault. A user can burn share tokens and receive the matching amount of the accepted SPL token. The vault sends tokens from its own token account, and the vault PDA signs that transfer through a Token Program CPI.

## What I changed

- Added a `withdraw` instruction that takes the number of share tokens to redeem.
- The program validates the vault, user card, mints, token accounts, and authorities.
- The user's shares are burned through the SPL Token Program. The user signs this CPI.
- Accepted tokens are transferred from the vault token account using `new_with_signer` and the vault PDA seeds.
- The program updates the vault total and the user's recorded shares and deposited amount.
- Zero withdrawals, an empty vault, invalid amounts, and arithmetic overflow are rejected.

## Withdrawal calculation

The user receives their proportional part of the vault:

```text
amount_out = shares_to_burn * vault.total_deposited / share_mint.supply
```

The multiplication uses `u128` before division to reduce overflow risk. The result is rounded down to token base units. If either CPI fails, Solana rolls back the whole instruction, so shares are not burned without a successful token transfer.

## Why the vault PDA signs

The vault token account is controlled by the vault PDA. A PDA has no private key, so a wallet cannot sign for it. My program uses the PDA seeds and bump with `new_with_signer` to authorize the Token Program transfer. The admin cannot directly move tokens from this account.

## Run tests locally

I tested this branch with Anchor 0.31.1, Node.js 22, Yarn, and the local validator:

```bash
corepack yarn install
anchor build
corepack yarn tsc --noEmit
corepack yarn test
```

The integration suite has 12 scenarios covering initialization, user cards, deposits, successful and full withdrawals, invalid amounts, missing cards, and insufficient shares.

## Try the full flow on devnet

The program is already deployed at the same program ID as Week 9. The configured wallet is the upgrade authority. Deploying the updated program and running the commands below sends devnet transactions and spends devnet SOL for fees and account rent. I did not submit those transactions automatically.

Use a fresh test vault for this version. The Week 10 user card stores share accounting, while existing Week 9 cards have the older layout. Upgrading the program does not migrate existing account data. The setup script below creates a new test token mint and vault, so it does not touch the old Week 9 deposit.

```bash
corepack yarn install
anchor build
anchor upgrade target/deploy/liquidity_vault.so --program-id 7deCasDiUCe9D4T4QD8RYMzxMameRDpeE1yZAv4J3o4S --provider.cluster devnet
corepack yarn setup:devnet
```

The setup command prints the new token mint address. Use that address in the next two commands. The demo flag mints test tokens only because the wallet created by setup is the test mint authority:

```bash
corepack yarn deposit:devnet <TOKEN_MINT_ADDRESS> 1 --mint-demo
corepack yarn withdraw:devnet <TOKEN_MINT_ADDRESS> 1
```

The withdrawal command burns 1 share token and returns the proportional accepted token amount. It prints the transaction link and the balances after the withdrawal. Use only the new test mint printed by setup, not the Week 9 mint below.

## Week 9 devnet accounts

These links are the previous week's setup and are included for reference. Week 10 localnet tests passed; I have not yet recorded a Week 10 devnet withdrawal transaction.

| Account | Week 9 devnet explorer |
|---|---|
| Program | [7deCasDiUCe9D4T4QD8RYMzxMameRDpeE1yZAv4J3o4S](https://explorer.solana.com/address/7deCasDiUCe9D4T4QD8RYMzxMameRDpeE1yZAv4J3o4S?cluster=devnet) |
| Accepted token mint | [3ZF2ErKWGGpZAK4HEWPTgk4kxF95avg5qEKSZS8R7fVm](https://explorer.solana.com/address/3ZF2ErKWGGpZAK4HEWPTgk4kxF95avg5qEKSZS8R7fVm?cluster=devnet) |
| Vault state | [5tTHydct51S4mUeP3YHfgVkvv58fVQFQ2gxkbKGMmob6](https://explorer.solana.com/address/5tTHydct51S4mUeP3YHfgVkvv58fVQFQ2gxkbKGMmob6?cluster=devnet) |
| Vault token account | [EQuEpnsP7Ld6tcbrG46ViJ5pMMA76fLnvNvZyyqTLxqp](https://explorer.solana.com/address/EQuEpnsP7Ld6tcbrG46ViJ5pMMA76fLnvNvZyyqTLxqp?cluster=devnet) |

## What I learned

Burning shares reduces the outstanding claim on the vault. The user signs to burn their own shares, while the program signs for the vault PDA when it transfers the deposited tokens. Keeping both CPIs in one instruction makes the withdrawal atomic.
