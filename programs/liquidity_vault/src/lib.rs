use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount, Transfer};

// Replace with the keypair address after generating target/deploy/liquidity_vault-keypair.json.
declare_id!("7deCasDiUCe9D4T4QD8RYMzxMameRDpeE1yZAv4J3o4S");

#[program]
pub mod liquidity_vault {
    use super::*;

    /// Creates the vault configuration, its token custody account, and its receipt-token mint.
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

    /// Opens one deterministic position card for this wallet in this vault.
    pub fn create_user_card(ctx: Context<CreateUserCard>) -> Result<()> {
        let card = &mut ctx.accounts.user_card;
        card.vault = ctx.accounts.vault_state.key();
        card.owner = ctx.accounts.user.key();
        card.deposited = 0;
        card.bump = ctx.bumps.user_card;
        Ok(())
    }

    /// Deposits accepted SPL tokens and mints proportional receipt shares.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);
        require!(
            ctx.accounts.share_mint.decimals == ctx.accounts.token_mint.decimals,
            VaultError::MismatchedDecimals
        );

        let vault = &ctx.accounts.vault_state;
        let shares_to_mint = if vault.total_deposited == 0 {
            require!(ctx.accounts.share_mint.supply == 0, VaultError::InconsistentVaultTotals);
            amount
        } else {
            require!(ctx.accounts.share_mint.supply > 0, VaultError::InconsistentVaultTotals);
            let numerator = (amount as u128)
                .checked_mul(ctx.accounts.share_mint.supply as u128)
                .ok_or(VaultError::MathOverflow)?;
            u64::try_from(numerator / vault.total_deposited as u128)
                .map_err(|_| error!(VaultError::MathOverflow))?
        };
        require!(shares_to_mint > 0, VaultError::SharesTooSmall);

        let new_total_deposited = vault
            .total_deposited
            .checked_add(amount)
            .ok_or(VaultError::MathOverflow)?;
        let new_user_deposited = ctx.accounts.user_card
            .deposited
            .checked_add(amount)
            .ok_or(VaultError::MathOverflow)?;
        let token_mint_key = vault.token_mint;
        let vault_bump = [vault.bump];
        let vault_seeds: &[&[u8]] = &[b"vault", token_mint_key.as_ref(), &vault_bump];
        let signer_seeds = &[vault_seeds];

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_token_account.to_account_info(),
                    to: ctx.accounts.token_vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.share_mint.to_account_info(),
                    to: ctx.accounts.user_share_account.to_account_info(),
                    authority: ctx.accounts.vault_state.to_account_info(),
                },
                signer_seeds,
            ),
            shares_to_mint,
        )?;

        let vault = &mut ctx.accounts.vault_state;
        vault.total_deposited = new_total_deposited;
        ctx.accounts.user_card.deposited = new_user_deposited;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(
        init,
        payer = admin,
        space = VaultState::SPACE,
        seeds = [b"vault", token_mint.key().as_ref()],
        bump
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        init,
        payer = admin,
        token::mint = token_mint,
        token::authority = vault_state,
        seeds = [b"token_vault", token_mint.key().as_ref()],
        bump
    )]
    pub token_vault: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = admin,
        mint::decimals = token_mint.decimals,
        mint::authority = vault_state,
        seeds = [b"share_mint", token_mint.key().as_ref()],
        bump
    )]
    pub share_mint: Account<'info, Mint>,

    pub token_mint: Account<'info, Mint>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct CreateUserCard<'info> {
    #[account(
        seeds = [b"vault", vault_state.token_mint.as_ref()],
        bump = vault_state.bump
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(
        init,
        payer = user,
        space = UserCard::SPACE,
        seeds = [b"user_card", vault_state.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub user_card: Account<'info, UserCard>,

    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct VaultState {
    pub admin: Pubkey,
    pub token_mint: Pubkey,
    pub token_vault: Pubkey,
    pub share_mint: Pubkey,
    pub total_deposited: u64,
    pub bump: u8,
}

impl VaultState {
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 32 + 8 + 1;
}

#[account]
pub struct UserCard {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub deposited: u64,
    pub bump: u8,
}

impl UserCard {
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 1;
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(
        mut,
        seeds = [b"vault", vault_state.token_mint.as_ref()],
        bump = vault_state.bump
    )]
    pub vault_state: Account<'info, VaultState>,

    #[account(address = vault_state.token_mint)]
    pub token_mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [b"user_card", vault_state.key().as_ref(), user.key().as_ref()],
        bump = user_card.bump,
        constraint = user_card.vault == vault_state.key() @ VaultError::InvalidUserCard,
        constraint = user_card.owner == user.key() @ VaultError::InvalidUserCard
    )]
    pub user_card: Account<'info, UserCard>,

    #[account(
        mut,
        address = vault_state.token_vault,
        token::mint = vault_state.token_mint,
        token::authority = vault_state
    )]
    pub token_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        address = vault_state.share_mint,
        mint::authority = vault_state
    )]
    pub share_mint: Account<'info, Mint>,

    #[account(
        mut,
        token::mint = vault_state.token_mint,
        token::authority = user
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = share_mint,
        token::authority = user
    )]
    pub user_share_account: Account<'info, TokenAccount>,

    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[error_code]
pub enum VaultError {
    #[msg("Deposit amount must be greater than zero")]
    ZeroAmount,
    #[msg("The vault totals and share mint supply are inconsistent")]
    InconsistentVaultTotals,
    #[msg("Deposit is too small to mint at least one share")]
    SharesTooSmall,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("User card does not belong to this user and vault")]
    InvalidUserCard,
    #[msg("Share mint decimals must match the accepted token mint decimals")]
    MismatchedDecimals,
}
