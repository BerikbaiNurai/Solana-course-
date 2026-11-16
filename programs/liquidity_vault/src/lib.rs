use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount, Transfer};
use raydium_clmm_cpi::{cpi, program::RaydiumClmm, states::{AmmConfig, ObservationState, PoolState}};
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::{Mint as InterfaceMint, TokenAccount as InterfaceTokenAccount};

declare_id!("7deCasDiUCe9D4T4QD8RYMzxMameRDpeE1yZAv4J3o4S");

#[program]
pub mod liquidity_vault {
    use super::*;

    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        let vault = &mut ctx.accounts.vault_state;
        vault.admin = ctx.accounts.admin.key();
        vault.token_mint = ctx.accounts.token_mint.key();
        vault.token_vault = ctx.accounts.token_vault.key();
        vault.share_mint = ctx.accounts.share_mint.key();
        vault.total_deposited = 0;
        vault.bump = ctx.bumps.vault_state;
        Ok(())
    }

    pub fn create_user_card(ctx: Context<CreateUserCard>) -> Result<()> {
        let card = &mut ctx.accounts.user_card;
        card.vault = ctx.accounts.vault_state.key();
        card.owner = ctx.accounts.user.key();
        card.deposited = 0;
        card.shares = 0;
        card.bump = ctx.bumps.user_card;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);
        require!(ctx.accounts.share_mint.decimals == ctx.accounts.token_mint.decimals, VaultError::MismatchedDecimals);
        let vault = &ctx.accounts.vault_state;
        let shares = if vault.total_deposited == 0 {
            require!(ctx.accounts.share_mint.supply == 0, VaultError::InconsistentVaultTotals);
            amount
        } else {
            require!(ctx.accounts.share_mint.supply > 0, VaultError::InconsistentVaultTotals);
            let n = (amount as u128).checked_mul(ctx.accounts.share_mint.supply as u128).ok_or(VaultError::MathOverflow)?;
            u64::try_from(n / vault.total_deposited as u128).map_err(|_| error!(VaultError::MathOverflow))?
        };
        require!(shares > 0, VaultError::SharesTooSmall);
        let total = vault.total_deposited.checked_add(amount).ok_or(VaultError::MathOverflow)?;
        let user_total = ctx.accounts.user_card.deposited.checked_add(amount).ok_or(VaultError::MathOverflow)?;
        let mint_key = vault.token_mint;
        let bump = [vault.bump];
        let seeds: &[&[u8]] = &[b"vault", mint_key.as_ref(), &bump];
        token::transfer(CpiContext::new(ctx.accounts.token_program.to_account_info(), Transfer {
            from: ctx.accounts.user_token_account.to_account_info(), to: ctx.accounts.token_vault.to_account_info(), authority: ctx.accounts.user.to_account_info(),
        }), amount)?;
        token::mint_to(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), MintTo {
            mint: ctx.accounts.share_mint.to_account_info(), to: ctx.accounts.user_share_account.to_account_info(), authority: ctx.accounts.vault_state.to_account_info(),
        }, &[seeds]), shares)?;
        ctx.accounts.vault_state.total_deposited = total;
        ctx.accounts.user_card.deposited = user_total;
        ctx.accounts.user_card.shares = ctx.accounts.user_card.shares.checked_add(shares).ok_or(VaultError::MathOverflow)?;
        Ok(())
    }

    /// Burns the user's receipt shares and returns their proportional vault tokens.
    pub fn withdraw(ctx: Context<Withdraw>, shares: u64) -> Result<()> {
        require!(shares > 0, VaultError::ZeroShares);
        let supply = ctx.accounts.share_mint.supply;
        let total = ctx.accounts.vault_state.total_deposited;
        require!(supply > 0 && total > 0, VaultError::InconsistentVaultTotals);
        require!(shares <= ctx.accounts.user_share_account.amount, VaultError::InsufficientShares);
        let n = (shares as u128).checked_mul(total as u128).ok_or(VaultError::MathOverflow)?;
        let tokens = u64::try_from(n / supply as u128).map_err(|_| error!(VaultError::MathOverflow))?;
        require!(tokens > 0, VaultError::SharesTooSmall);
        require!(tokens <= total, VaultError::InsufficientVaultLiquidity);
        let remaining = total.checked_sub(tokens).ok_or(VaultError::MathOverflow)?;
        let mint_key = ctx.accounts.vault_state.token_mint;
        let bump = [ctx.accounts.vault_state.bump];
        let seeds: &[&[u8]] = &[b"vault", mint_key.as_ref(), &bump];

        token::burn(CpiContext::new(ctx.accounts.token_program.to_account_info(), Burn {
            mint: ctx.accounts.share_mint.to_account_info(), from: ctx.accounts.user_share_account.to_account_info(), authority: ctx.accounts.user.to_account_info(),
        }), shares)?;
        token::transfer(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), Transfer {
            from: ctx.accounts.token_vault.to_account_info(), to: ctx.accounts.user_token_account.to_account_info(), authority: ctx.accounts.vault_state.to_account_info(),
        }, &[seeds]), tokens)?;
        ctx.accounts.vault_state.total_deposited = remaining;
        ctx.accounts.user_card.deposited = ctx.accounts.user_card.deposited.saturating_sub(tokens);
        ctx.accounts.user_card.shares = ctx.accounts.user_card.shares.saturating_sub(shares);
        Ok(())
    }

    /// Swaps part of a user's vault claim through Raydium CLMM and sends the
    /// output token to that user. The input amount is exact; Raydium enforces
    /// min_amount_out atomically, so a failed slippage check rolls everything back.
    pub fn swap_from_vault<'a, 'b, 'c: 'info, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, SwapFromVault<'info>>,
        amount_in: u64,
        min_amount_out: u64,
    ) -> Result<()> {
        require!(amount_in > 0 && min_amount_out > 0, VaultError::ZeroAmount);
        let total = ctx.accounts.vault_state.total_deposited;
        let supply = ctx.accounts.share_mint.supply;
        require!(total > 0 && supply > 0, VaultError::InconsistentVaultTotals);
        require!(amount_in <= total && amount_in <= ctx.accounts.token_vault.amount, VaultError::InsufficientVaultLiquidity);

        let shares_numerator = (amount_in as u128)
            .checked_mul(supply as u128)
            .ok_or(VaultError::MathOverflow)?;
        let shares = shares_numerator
            .checked_add(total as u128 - 1)
            .ok_or(VaultError::MathOverflow)? / total as u128;
        let shares = u64::try_from(shares).map_err(|_| error!(VaultError::MathOverflow))?;
        require!(shares > 0, VaultError::SharesTooSmall);
        require!(shares <= ctx.accounts.user_share_account.amount, VaultError::InsufficientShares);

        let pool = ctx.accounts.pool_state.load()?;
        let input_mint = ctx.accounts.input_mint.key();
        let output_mint = ctx.accounts.output_mint.key();
        let zero_for_one = if input_mint == pool.token_mint_0 {
            require_keys_eq!(output_mint, pool.token_mint_1, VaultError::PoolMintMismatch);
            true
        } else {
            require_keys_eq!(input_mint, pool.token_mint_1, VaultError::PoolMintMismatch);
            require_keys_eq!(output_mint, pool.token_mint_0, VaultError::PoolMintMismatch);
            false
        };
        let input_pool_vault = if zero_for_one { &ctx.accounts.pool_token_vault_0 } else { &ctx.accounts.pool_token_vault_1 };
        let output_pool_vault = if zero_for_one { &ctx.accounts.pool_token_vault_1 } else { &ctx.accounts.pool_token_vault_0 };
        let input_pool_mint = if zero_for_one { &ctx.accounts.pool_mint_0 } else { &ctx.accounts.pool_mint_1 };
        let output_pool_mint = if zero_for_one { &ctx.accounts.pool_mint_1 } else { &ctx.accounts.pool_mint_0 };
        require_keys_eq!(input_pool_vault.key(), if zero_for_one { pool.token_vault_0 } else { pool.token_vault_1 }, VaultError::PoolAccountMismatch);
        require_keys_eq!(output_pool_vault.key(), if zero_for_one { pool.token_vault_1 } else { pool.token_vault_0 }, VaultError::PoolAccountMismatch);
        require_keys_eq!(input_pool_mint.key(), input_mint, VaultError::PoolMintMismatch);
        require_keys_eq!(output_pool_mint.key(), output_mint, VaultError::PoolMintMismatch);
        drop(pool);

        let mint_key = ctx.accounts.vault_state.token_mint;
        let bump = [ctx.accounts.vault_state.bump];
        let signer_seeds: &[&[u8]] = &[b"vault", mint_key.as_ref(), &bump];
        let signer_seeds_array = [signer_seeds];
        let cpi_accounts = cpi::accounts::SwapSingleV2 {
            payer: ctx.accounts.vault_state.to_account_info(),
            amm_config: ctx.accounts.amm_config.to_account_info(),
            pool_state: ctx.accounts.pool_state.to_account_info(),
            input_token_account: ctx.accounts.token_vault.to_account_info(),
            output_token_account: ctx.accounts.user_output_token_account.to_account_info(),
            input_vault: input_pool_vault.to_account_info(),
            output_vault: output_pool_vault.to_account_info(),
            observation_state: ctx.accounts.observation_state.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            token_program_2022: ctx.accounts.token_program_2022.to_account_info(),
            memo_program: ctx.accounts.memo_program.to_account_info(),
            input_vault_mint: input_pool_mint.to_account_info(),
            output_vault_mint: output_pool_mint.to_account_info(),
        };

        token::burn(CpiContext::new(ctx.accounts.token_program.to_account_info(), Burn {
            mint: ctx.accounts.share_mint.to_account_info(),
            from: ctx.accounts.user_share_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        }), shares)?;

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.clmm_program.to_account_info(),
            cpi_accounts,
            &signer_seeds_array,
        ).with_remaining_accounts(ctx.remaining_accounts.to_vec());
        cpi::swap_v2(cpi_ctx, amount_in, min_amount_out, 0, true)?;

        ctx.accounts.vault_state.total_deposited = total.checked_sub(amount_in).ok_or(VaultError::MathOverflow)?;
        ctx.accounts.user_card.deposited = ctx.accounts.user_card.deposited.saturating_sub(amount_in);
        ctx.accounts.user_card.shares = ctx.accounts.user_card.shares.saturating_sub(shares);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(init, payer = admin, space = VaultState::SPACE, seeds = [b"vault", token_mint.key().as_ref()], bump)]
    pub vault_state: Account<'info, VaultState>,
    #[account(init, payer = admin, token::mint = token_mint, token::authority = vault_state, seeds = [b"token_vault", token_mint.key().as_ref()], bump)]
    pub token_vault: Account<'info, TokenAccount>,
    #[account(init, payer = admin, mint::decimals = token_mint.decimals, mint::authority = vault_state, seeds = [b"share_mint", token_mint.key().as_ref()], bump)]
    pub share_mint: Account<'info, Mint>,
    pub token_mint: Account<'info, Mint>,
    #[account(mut)] pub admin: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct CreateUserCard<'info> {
    #[account(seeds = [b"vault", vault_state.token_mint.as_ref()], bump = vault_state.bump)]
    pub vault_state: Account<'info, VaultState>,
    #[account(init, payer = user, space = UserCard::SPACE, seeds = [b"user_card", vault_state.key().as_ref(), user.key().as_ref()], bump)]
    pub user_card: Account<'info, UserCard>,
    #[account(mut)] pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct VaultState { pub admin: Pubkey, pub token_mint: Pubkey, pub token_vault: Pubkey, pub share_mint: Pubkey, pub total_deposited: u64, pub bump: u8 }
impl VaultState { pub const SPACE: usize = 8 + 32 + 32 + 32 + 32 + 8 + 1; }

#[account]
pub struct UserCard { pub vault: Pubkey, pub owner: Pubkey, pub deposited: u64, pub shares: u64, pub bump: u8 }
impl UserCard { pub const SPACE: usize = 8 + 32 + 32 + 8 + 8 + 1; }

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut, seeds = [b"vault", vault_state.token_mint.as_ref()], bump = vault_state.bump)] pub vault_state: Account<'info, VaultState>,
    #[account(address = vault_state.token_mint)] pub token_mint: Account<'info, Mint>,
    #[account(mut, seeds = [b"user_card", vault_state.key().as_ref(), user.key().as_ref()], bump = user_card.bump, constraint = user_card.vault == vault_state.key() @ VaultError::InvalidUserCard, constraint = user_card.owner == user.key() @ VaultError::InvalidUserCard)] pub user_card: Account<'info, UserCard>,
    #[account(mut, address = vault_state.token_vault, token::mint = vault_state.token_mint, token::authority = vault_state)] pub token_vault: Account<'info, TokenAccount>,
    #[account(mut, address = vault_state.share_mint, mint::authority = vault_state)] pub share_mint: Account<'info, Mint>,
    #[account(mut, token::mint = vault_state.token_mint, token::authority = user)] pub user_token_account: Account<'info, TokenAccount>,
    #[account(mut, token::mint = share_mint, token::authority = user)] pub user_share_account: Account<'info, TokenAccount>,
    pub user: Signer<'info>, pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut, seeds = [b"vault", vault_state.token_mint.as_ref()], bump = vault_state.bump)] pub vault_state: Account<'info, VaultState>,
    #[account(address = vault_state.token_mint)] pub token_mint: Account<'info, Mint>,
    #[account(mut, seeds = [b"user_card", vault_state.key().as_ref(), user.key().as_ref()], bump = user_card.bump, constraint = user_card.vault == vault_state.key() @ VaultError::InvalidUserCard, constraint = user_card.owner == user.key() @ VaultError::InvalidUserCard)] pub user_card: Account<'info, UserCard>,
    #[account(mut, address = vault_state.token_vault, token::mint = vault_state.token_mint, token::authority = vault_state)] pub token_vault: Account<'info, TokenAccount>,
    #[account(mut, address = vault_state.share_mint, mint::authority = vault_state)] pub share_mint: Account<'info, Mint>,
    #[account(mut, token::mint = vault_state.token_mint, token::authority = user)] pub user_token_account: Account<'info, TokenAccount>,
    #[account(mut, token::mint = share_mint, token::authority = user)] pub user_share_account: Account<'info, TokenAccount>,
    pub user: Signer<'info>, pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SwapFromVault<'info> {
    #[account(mut, seeds = [b"vault", vault_state.token_mint.as_ref()], bump = vault_state.bump)]
    pub vault_state: Account<'info, VaultState>,
    #[account(address = vault_state.token_mint)]
    pub input_mint: Account<'info, Mint>,
    #[account(mut, address = vault_state.token_vault, token::mint = input_mint, token::authority = vault_state)]
    pub token_vault: Account<'info, TokenAccount>,
    #[account(mut, address = vault_state.share_mint, mint::authority = vault_state)]
    pub share_mint: Account<'info, Mint>,
    #[account(mut, token::mint = share_mint, token::authority = user)]
    pub user_share_account: Account<'info, TokenAccount>,
    #[account(mut, token::mint = output_mint, token::authority = user)]
    pub user_output_token_account: Account<'info, TokenAccount>,
    pub output_mint: Account<'info, Mint>,
    #[account(mut, seeds = [b"user_card", vault_state.key().as_ref(), user.key().as_ref()], bump = user_card.bump, constraint = user_card.vault == vault_state.key() @ VaultError::InvalidUserCard, constraint = user_card.owner == user.key() @ VaultError::InvalidUserCard)]
    pub user_card: Account<'info, UserCard>,
    pub user: Signer<'info>,
    #[account(address = pool_state.load()?.amm_config)]
    pub amm_config: Box<Account<'info, AmmConfig>>,
    #[account(mut)]
    pub pool_state: AccountLoader<'info, PoolState>,
    #[account(mut)]
    pub pool_token_vault_0: InterfaceAccount<'info, InterfaceTokenAccount>,
    #[account(mut)]
    pub pool_token_vault_1: InterfaceAccount<'info, InterfaceTokenAccount>,
    pub pool_mint_0: InterfaceAccount<'info, InterfaceMint>,
    pub pool_mint_1: InterfaceAccount<'info, InterfaceMint>,
    #[account(mut, address = pool_state.load()?.observation_key)]
    pub observation_state: AccountLoader<'info, ObservationState>,
    pub clmm_program: Program<'info, RaydiumClmm>,
    pub token_program: Program<'info, Token>,
    pub token_program_2022: Program<'info, Token2022>,
    /// CHECK: constrained to the canonical SPL Memo program.
    #[account(address = anchor_spl::memo::spl_memo::id())]
    pub memo_program: UncheckedAccount<'info>,
}

#[error_code]
pub enum VaultError {
    #[msg("Deposit amount must be greater than zero")] ZeroAmount,
    #[msg("Share amount must be greater than zero")] ZeroShares,
    #[msg("The vault totals and share mint supply are inconsistent")] InconsistentVaultTotals,
    #[msg("Deposit or withdrawal is too small after rounding")] SharesTooSmall,
    #[msg("Arithmetic overflow")] MathOverflow,
    #[msg("User card does not belong to this user and vault")] InvalidUserCard,
    #[msg("Share mint decimals must match the accepted token mint decimals")] MismatchedDecimals,
    #[msg("User does not have enough share tokens")] InsufficientShares,
    #[msg("Vault does not have enough tokens for this withdrawal")] InsufficientVaultLiquidity,
    #[msg("The supplied mints do not match the selected Raydium pool")]
    PoolMintMismatch,
    #[msg("The supplied token vaults do not match the selected Raydium pool")]
    PoolAccountMismatch,
}
