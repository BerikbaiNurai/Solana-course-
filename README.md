# Solana Course — Weekly Projects

I'm building a Liquidity Vault as I work through the course. I keep each week's work in its own branch so it's easy to see what I added along the way. This README is the starting point for the project.

## Weekly branches

- [Week 8 — Vault scaffold and PDA user card](https://github.com/BerikbaiNurai/Solana-course-/tree/week-8) · [Week 8 README](https://github.com/BerikbaiNurai/Solana-course-/blob/week-8/README.md)
- [Week 9 — Deposits and share tokens](https://github.com/BerikbaiNurai/Solana-course-/tree/week-9) · [Week 9 README](https://github.com/BerikbaiNurai/Solana-course-/blob/week-9/README.md)
- [Week 10 — CPI withdrawals](https://github.com/BerikbaiNurai/Solana-course-/tree/week-10) · [Week 10 README](https://github.com/BerikbaiNurai/Solana-course-/blob/week-10/README.md)
- [Week 11 — AMM and Raydium CLMM](https://github.com/BerikbaiNurai/Solana-course-/tree/week-11) · [Week 11 README](https://github.com/BerikbaiNurai/Solana-course-/blob/week-11/README.md)
- [Week 12 — Swap through Raydium CLMM](https://github.com/BerikbaiNurai/Solana-course-/tree/week-12) · [Week 12 README](https://github.com/BerikbaiNurai/Solana-course-/blob/week-12/README.md)
- [Week 13 — Raydium CLMM position](https://github.com/BerikbaiNurai/Solana-course-/tree/week-13) · [Week 13 README](https://github.com/BerikbaiNurai/Solana-course-/blob/week-13/README.md) · Complete
- [Week 14 — Liquidity Vault capstone dApp](https://github.com/BerikbaiNurai/Solana-course-/tree/week-14) · [Week 14 README](https://github.com/BerikbaiNurai/Solana-course-/blob/week-14/README.md) · Complete

## What I built each week

- **Week 8:** I added the vault settings, a token account controlled by the vault PDA, a share mint, and a personal user card. The program was built and deployed to devnet. The README in that branch has the account links.
- **Week 9:** I added deposits. The program transfers SPL tokens into the vault and mints share tokens for the user. The branch README includes the setup and deposit details.
- **Week 10:** I added withdrawals. The program burns the user's shares and transfers the proportional SPL token amount from the vault through a Token Program CPI signed by the vault PDA. The branch includes 12 integration scenarios tested on localnet.
- **Week 11:** I created two SPL test tokens on devnet and initialized a Raydium CLMM pool at a 1:1 starting price. The branch README has the mint, pool, and transaction links.
- **Week 12:** I added an exact-input swap from the vault through Raydium CLMM. The instruction burns the user's matching shares and enforces `min_amount_out`. I created a funded test pool, deposited W11A, and finalized a swap with a 1% slippage limit. The [Week 12 README](https://github.com/BerikbaiNurai/Solana-course-/blob/week-12/README.md) has the account and transaction links.
- **Week 13:** I added vault-managed CLMM positions, fee collection, closing, and a keeper script that moves the position when the price leaves its range. I deployed the program to Devnet and checked the open, fee collection, close, and rebalance transactions. The final position is open around the current price. The [Week 13 README](https://github.com/BerikbaiNurai/Solana-course-/blob/week-13/README.md) has the code and Explorer links.
- **Week 14:** I built a small web app for the vault. It connects to Phantom on Devnet and lets a user deposit test tokens, see their shares, and withdraw. I added seven unit tests and checked that the app builds for production. The [Week 14 README](https://github.com/BerikbaiNurai/Solana-course-/blob/week-14/README.md) has the setup steps and details.

Each branch has its own code and README. Open the README for a week to see how I built and checked that part of the project.
