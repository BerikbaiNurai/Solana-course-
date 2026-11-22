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

## Week 10 withdrawal on devnet

I tested the withdrawal with a fresh test mint and vault. I kept it separate from the Week 9 vault because the Week 10 user card also stores share accounting, and an upgrade does not migrate old account data. The course reuses this program ID in later weeks; the Devnet withdrawal below was executed by the deployed vault program.

```bash
corepack yarn install
anchor build
anchor upgrade target/deploy/liquidity_vault.so --program-id 7deCasDiUCe9D4T4QD8RYMzxMameRDpeE1yZAv4J3o4S --provider.cluster devnet
corepack yarn setup:devnet
```

To repeat the flow with a fresh vault, build the current branch, initialize a vault, deposit one demo token, and withdraw one share. The setup command creates a test mint for which the configured wallet is the mint authority:

```bash
corepack yarn deposit:devnet <TOKEN_MINT_ADDRESS> 1 --mint-demo
corepack yarn withdraw:devnet <TOKEN_MINT_ADDRESS> 1
```

I completed this flow on Devnet. The test mint has six decimals, so `1,000,000` base units equals one token. The deposit put one token in the vault and minted one share. The withdrawal burned that share and returned one token to my wallet.

| Account or action | Devnet Explorer |
|---|---|
| Test token mint | [63NhV3KmbyaczGQ8sozk23mtKmoX7bub42AXLtgTUhps](https://explorer.solana.com/address/63NhV3KmbyaczGQ8sozk23mtKmoX7bub42AXLtgTUhps?cluster=devnet) |
| Vault state PDA | [3owstGga2wZV6G2RNPiQUvbWKfVhiFTmYZVx7ziaAcrH](https://explorer.solana.com/address/3owstGga2wZV6G2RNPiQUvbWKfVhiFTmYZVx7ziaAcrH?cluster=devnet) |
| Vault token account | [FCaGLEQmMDtyFdcwooNj1VNmW6XqTxyCUznD5noKEsV8](https://explorer.solana.com/address/FCaGLEQmMDtyFdcwooNj1VNmW6XqTxyCUznD5noKEsV8?cluster=devnet) |
| Share mint | [pFWxUJBqX686V7btGNJDxydgm3cXuURr5Lk6eYZZE9M](https://explorer.solana.com/address/pFWxUJBqX686V7btGNJDxydgm3cXuURr5Lk6eYZZE9M?cluster=devnet) |
| User card PDA | [FrnPuMhLuAkGoZCEYjMdnQVv1pX1yiqxLp4iGmkmDD2r](https://explorer.solana.com/address/FrnPuMhLuAkGoZCEYjMdnQVv1pX1yiqxLp4iGmkmDD2r?cluster=devnet) |
| Vault initialization | [transaction](https://explorer.solana.com/tx/3uUo5oT4NjLtfEfYfrFPeDqx1mZdZZHTSxkK3RaTPNbYcBKSSi6iuupXKgHLMPrWHUuGJwzf1upezga3uxMdEcek?cluster=devnet) |
| User card creation | [transaction](https://explorer.solana.com/tx/4E9qtwxHgS5aQVYchGUQgdRmLMuTKzZoEDKpJ675pNUYguDTyecofJFpkfAR3QAQL6sm5qeKr692peh7gKbcqkPH?cluster=devnet) |
| Deposit of one token and minting one share | [transaction](https://explorer.solana.com/tx/Sma153ar2Tn7Nxhao3PZ7sPNh7jUrhDqSF4bXtRQ2G7GnEjyHpix6WyoP6eddTP5etz51xrcQmzLubaagbYjxdV?cluster=devnet) |
| Withdrawal of one share | [transaction with Token Program CPI details](https://explorer.solana.com/tx/2gSKF13YLCNqQTX4SaaDu8Bk82jQFwxtBLgdLrsCkedMbtaoWs3SE2vnYmuarii7mtGdftMdAptmDmhvSk67HfZs?cluster=devnet) |

In the withdrawal transaction, the Token Program first burns `1,000,000` share base units. It then transfers `1,000,000` token base units from the vault token account to my token account. The burn is authorized by my wallet; the transfer is authorized by the `VaultState` PDA through the vault program. Both inner instructions are visible in the Explorer transaction details and logs.

| Balance | Before withdrawal | After withdrawal |
|---|---:|---:|
| My test tokens | 0 | 1,000,000 base units (1 token) |
| My share tokens | 1,000,000 base units (1 share) | 0 |
| Vault token account | 1,000,000 base units (1 token) | 0 |
| Share mint supply | 1,000,000 base units | 0 |

## Week 9 devnet accounts

These links are the previous week's setup and are included for reference. The withdrawal above uses a separate fresh vault, so it does not change the Week 9 deposit.

| Account | Week 9 devnet explorer |
|---|---|
| Program | [7deCasDiUCe9D4T4QD8RYMzxMameRDpeE1yZAv4J3o4S](https://explorer.solana.com/address/7deCasDiUCe9D4T4QD8RYMzxMameRDpeE1yZAv4J3o4S?cluster=devnet) |
| Accepted token mint | [3ZF2ErKWGGpZAK4HEWPTgk4kxF95avg5qEKSZS8R7fVm](https://explorer.solana.com/address/3ZF2ErKWGGpZAK4HEWPTgk4kxF95avg5qEKSZS8R7fVm?cluster=devnet) |
| Vault state | [5tTHydct51S4mUeP3YHfgVkvv58fVQFQ2gxkbKGMmob6](https://explorer.solana.com/address/5tTHydct51S4mUeP3YHfgVkvv58fVQFQ2gxkbKGMmob6?cluster=devnet) |
| Vault token account | [EQuEpnsP7Ld6tcbrG46ViJ5pMMA76fLnvNvZyyqTLxqp](https://explorer.solana.com/address/EQuEpnsP7Ld6tcbrG46ViJ5pMMA76fLnvNvZyyqTLxqp?cluster=devnet) |

## What I learned

Burning shares reduces the outstanding claim on the vault. The user signs to burn their own shares, while the program signs for the vault PDA when it transfers the deposited tokens. Keeping both CPIs in one instruction makes the withdrawal atomic.
