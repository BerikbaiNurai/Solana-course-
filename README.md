# Solana Course — Weekly Projects

I'm building a Liquidity Vault as I work through the course. I keep each week's work in its own branch so it's easy to see what I added along the way. This README is the starting point for the project.

## Weekly branches

- [Week 8 — Vault scaffold and PDA user card](https://github.com/BerikbaiNurai/Solana-course-/tree/week-8) · [Week 8 README](https://github.com/BerikbaiNurai/Solana-course-/blob/week-8/README.md)
- [Week 9 — Deposits and share tokens](https://github.com/BerikbaiNurai/Solana-course-/tree/week-9) · [Week 9 README](https://github.com/BerikbaiNurai/Solana-course-/blob/week-9/README.md)
- [Week 10 — CPI withdrawals](https://github.com/BerikbaiNurai/Solana-course-/tree/week-10) · [Week 10 README](https://github.com/BerikbaiNurai/Solana-course-/blob/week-10/README.md)
- [Week 11 — AMM and Raydium CLMM](https://github.com/BerikbaiNurai/Solana-course-/tree/week-11) · [Week 11 README](https://github.com/BerikbaiNurai/Solana-course-/blob/week-11/README.md)

## What I built each week

- **Week 8:** I added the vault settings, a token account controlled by the vault PDA, a share mint, and a personal user card. The program was built and deployed to devnet. The README in that branch has the account links.
- **Week 9:** I added deposits. The program transfers SPL tokens into the vault and mints share tokens for the user. The branch README includes the setup and deposit details.
- **Week 10:** I added withdrawals. The program burns the user's shares and transfers the proportional SPL token amount from the vault through a Token Program CPI signed by the vault PDA. The branch includes 12 integration scenarios tested on localnet.
- **Week 11:** I created two SPL test tokens on devnet and initialized a Raydium CLMM pool at a 1:1 starting price. The branch README has the mint, pool, and transaction links.

Each branch has its own code and README. Open the README for a week to see how I built and checked that part of the project.
