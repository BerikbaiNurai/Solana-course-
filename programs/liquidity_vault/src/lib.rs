use anchor_lang::prelude::*;
use anchor_spl::token::{self, Approve, Burn, Mint, MintTo, Revoke, Token, TokenAccount, Transfer};
use raydium_clmm_cpi::{cpi, program::RaydiumClmm, states::{AmmConfig, ObservationState, PersonalPositionState, PoolState, TickArrayState}};
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::{Mint as InterfaceMint, TokenAccount as InterfaceTokenAccount};
use anchor_spl::{associated_token::AssociatedToken, memo::Memo, metadata::Metadata};

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
        require!(tokens <= ctx.accounts.token_vault.amount, VaultError::InsufficientVaultLiquidity);
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

    /// Creates a controller PDA that records a CLMM position owned by this vault program.
    pub fn initialize_position_controller(ctx: Context<InitializePositionController>) -> Result<()> {
        require_keys_eq!(ctx.accounts.vault_state_0.admin, ctx.accounts.admin.key(), VaultError::Unauthorized);
        require_keys_eq!(ctx.accounts.vault_state_1.admin, ctx.accounts.admin.key(), VaultError::Unauthorized);
        require_keys_neq!(ctx.accounts.vault_state_0.key(), ctx.accounts.vault_state_1.key(), VaultError::SameVault);
        let pool = ctx.accounts.pool_state.load()?;
        require_keys_eq!(ctx.accounts.vault_state_0.token_mint, pool.token_mint_0, VaultError::PoolMintMismatch);
        require_keys_eq!(ctx.accounts.vault_state_1.token_mint, pool.token_mint_1, VaultError::PoolMintMismatch);
        let state = &mut ctx.accounts.position_state;
        state.vault_state_0 = ctx.accounts.vault_state_0.key();
        state.vault_state_1 = ctx.accounts.vault_state_1.key();
        state.pool = ctx.accounts.pool_state.key();
        state.position_nft_mint = Pubkey::default();
        state.personal_position = Pubkey::default();
        state.tick_lower = 0;
        state.tick_upper = 0;
        state.generation = 0;
        state.is_open = false;
        state.bump = ctx.bumps.position_state;
        Ok(())
    }

    /// Opens a Raydium position using tokens held by two vault token accounts.
    /// The admin pays rent; temporary SPL delegates let the Raydium CPI transfer
    /// only the caller-supplied maximums from the vault PDAs.
    pub fn open_clmm_position<'a, 'b, 'c: 'info, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, OpenClmmPosition<'info>>,
        tick_lower: i32,
        tick_upper: i32,
        tick_array_lower_start: i32,
        tick_array_upper_start: i32,
        amount_0_max: u64,
        amount_1_max: u64,
        base_flag: bool,
    ) -> Result<()> {
        require!(!ctx.accounts.position_state.is_open, VaultError::PositionAlreadyOpen);
        require!(tick_lower < tick_upper, VaultError::InvalidTickRange);
        require!(amount_0_max > 0 && amount_1_max > 0, VaultError::ZeroAmount);
        require_keys_eq!(ctx.accounts.vault_state_0.admin, ctx.accounts.admin.key(), VaultError::Unauthorized);
        require_keys_eq!(ctx.accounts.vault_state_1.admin, ctx.accounts.admin.key(), VaultError::Unauthorized);
        require!(amount_0_max <= ctx.accounts.token_vault_0.amount, VaultError::InsufficientVaultLiquidity);
        require!(amount_1_max <= ctx.accounts.token_vault_1.amount, VaultError::InsufficientVaultLiquidity);

        let pool = ctx.accounts.pool_state.load()?;
        require_keys_eq!(ctx.accounts.position_state.pool, ctx.accounts.pool_state.key(), VaultError::InvalidPositionState);
        require_keys_eq!(ctx.accounts.position_state.vault_state_0, ctx.accounts.vault_state_0.key(), VaultError::InvalidPositionState);
        require_keys_eq!(ctx.accounts.position_state.vault_state_1, ctx.accounts.vault_state_1.key(), VaultError::InvalidPositionState);
        require_keys_eq!(ctx.accounts.vault_state_0.token_mint, pool.token_mint_0, VaultError::PoolMintMismatch);
        require_keys_eq!(ctx.accounts.vault_state_1.token_mint, pool.token_mint_1, VaultError::PoolMintMismatch);
        require_keys_eq!(ctx.accounts.token_vault_0.key(), ctx.accounts.vault_state_0.token_vault, VaultError::PoolAccountMismatch);
        require_keys_eq!(ctx.accounts.token_vault_1.key(), ctx.accounts.vault_state_1.token_vault, VaultError::PoolAccountMismatch);
        require_keys_eq!(ctx.accounts.raydium_pool_vault_0.key(), pool.token_vault_0, VaultError::PoolAccountMismatch);
        require_keys_eq!(ctx.accounts.raydium_pool_vault_1.key(), pool.token_vault_1, VaultError::PoolAccountMismatch);
        drop(pool);

        let v0_mint = ctx.accounts.vault_state_0.token_mint;
        let v1_mint = ctx.accounts.vault_state_1.token_mint;
        let v0_bump = [ctx.accounts.vault_state_0.bump];
        let v1_bump = [ctx.accounts.vault_state_1.bump];
        let v0_seeds: &[&[u8]] = &[b"vault", v0_mint.as_ref(), &v0_bump];
        let v1_seeds: &[&[u8]] = &[b"vault", v1_mint.as_ref(), &v1_bump];
        let v0_signer = [v0_seeds];
        let v1_signer = [v1_seeds];

        token::approve(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), Approve {
            to: ctx.accounts.token_vault_0.to_account_info(), delegate: ctx.accounts.admin.to_account_info(), authority: ctx.accounts.vault_state_0.to_account_info(),
        }, &v0_signer), amount_0_max)?;
        token::approve(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), Approve {
            to: ctx.accounts.token_vault_1.to_account_info(), delegate: ctx.accounts.admin.to_account_info(), authority: ctx.accounts.vault_state_1.to_account_info(),
        }, &v1_signer), amount_1_max)?;

        let generation = ctx.accounts.position_state.generation.to_le_bytes();
        let state_bump = [ctx.accounts.position_state.bump];
        let vault0_key = ctx.accounts.vault_state_0.key();
        let vault1_key = ctx.accounts.vault_state_1.key();
        let pool_key = ctx.accounts.pool_state.key();
        let position_state_key = ctx.accounts.position_state.key();
        let state_seeds: &[&[u8]] = &[
            b"clmm_position",
            vault0_key.as_ref(),
            vault1_key.as_ref(),
            pool_key.as_ref(),
            &state_bump,
        ];
        let nft_bump = [ctx.bumps.position_nft_mint];
        let nft_seeds: &[&[u8]] = &[b"position_nft", position_state_key.as_ref(), &generation, &nft_bump];
        let signers = [state_seeds, nft_seeds];
        let cpi_accounts = cpi::accounts::OpenPositionV2 {
            payer: ctx.accounts.admin.to_account_info(),
            position_nft_owner: ctx.accounts.position_state.to_account_info(),
            position_nft_mint: ctx.accounts.position_nft_mint.to_account_info(),
            position_nft_account: ctx.accounts.position_nft_account.to_account_info(),
            metadata_account: ctx.accounts.metadata_account.to_account_info(),
            pool_state: ctx.accounts.pool_state.to_account_info(),
            protocol_position: ctx.accounts.protocol_position.to_account_info(),
            tick_array_lower: ctx.accounts.tick_array_lower.to_account_info(),
            tick_array_upper: ctx.accounts.tick_array_upper.to_account_info(),
            personal_position: ctx.accounts.personal_position.to_account_info(),
            token_account_0: ctx.accounts.token_vault_0.to_account_info(),
            token_account_1: ctx.accounts.token_vault_1.to_account_info(),
            token_vault_0: ctx.accounts.raydium_pool_vault_0.to_account_info(),
            token_vault_1: ctx.accounts.raydium_pool_vault_1.to_account_info(),
            rent: ctx.accounts.rent.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            associated_token_program: ctx.accounts.associated_token_program.to_account_info(),
            metadata_program: ctx.accounts.metadata_program.to_account_info(),
            token_program_2022: ctx.accounts.token_program_2022.to_account_info(),
            vault_0_mint: ctx.accounts.vault_mint_0.to_account_info(),
            vault_1_mint: ctx.accounts.vault_mint_1.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.clmm_program.to_account_info(), cpi_accounts)
            .with_signer(&signers)
            .with_remaining_accounts(ctx.remaining_accounts.to_vec());
        cpi::open_position_v2(
            cpi_ctx, tick_lower, tick_upper, tick_array_lower_start, tick_array_upper_start,
            0, amount_0_max, amount_1_max, false, Some(base_flag),
        )?;

        token::revoke(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), Revoke {
            source: ctx.accounts.token_vault_0.to_account_info(), authority: ctx.accounts.vault_state_0.to_account_info(),
        }, &v0_signer))?;
        token::revoke(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), Revoke {
            source: ctx.accounts.token_vault_1.to_account_info(), authority: ctx.accounts.vault_state_1.to_account_info(),
        }, &v1_signer))?;

        let state = &mut ctx.accounts.position_state;
        state.position_nft_mint = ctx.accounts.position_nft_mint.key();
        state.personal_position = ctx.accounts.personal_position.key();
        state.tick_lower = tick_lower;
        state.tick_upper = tick_upper;
        state.is_open = true;
        Ok(())
    }

    /// Collects fees without changing liquidity (Raydium decrease-liquidity with zero).
    pub fn collect_clmm_fees<'a, 'b, 'c: 'info, 'info>(ctx: Context<'a, 'b, 'c, 'info, ManageClmmPosition<'info>>) -> Result<()> {
        require!(ctx.accounts.position_state.is_open, VaultError::NoOpenPosition);
        require_keys_eq!(ctx.accounts.vault_state_0.admin, ctx.accounts.admin.key(), VaultError::Unauthorized);
        require_keys_eq!(ctx.accounts.vault_state_1.admin, ctx.accounts.admin.key(), VaultError::Unauthorized);
        require_keys_eq!(ctx.accounts.position_state.position_nft_mint, ctx.accounts.position_nft_mint.key(), VaultError::InvalidPositionState);
        require_keys_eq!(ctx.accounts.position_state.personal_position, ctx.accounts.personal_position.key(), VaultError::InvalidPositionState);
        require_keys_eq!(ctx.accounts.position_state.pool, ctx.accounts.pool_state.key(), VaultError::InvalidPositionState);
        {
            let pool = ctx.accounts.pool_state.load()?;
            require_keys_eq!(ctx.accounts.vault_state_0.token_mint, pool.token_mint_0, VaultError::PoolMintMismatch);
            require_keys_eq!(ctx.accounts.vault_state_1.token_mint, pool.token_mint_1, VaultError::PoolMintMismatch);
            require_keys_eq!(ctx.accounts.raydium_pool_vault_0.key(), pool.token_vault_0, VaultError::PoolAccountMismatch);
            require_keys_eq!(ctx.accounts.raydium_pool_vault_1.key(), pool.token_vault_1, VaultError::PoolAccountMismatch);
        }
        let bump = [ctx.accounts.position_state.bump];
        let vault0_key = ctx.accounts.vault_state_0.key();
        let vault1_key = ctx.accounts.vault_state_1.key();
        let pool_key = ctx.accounts.pool_state.key();
        let seeds: &[&[u8]] = &[
            b"clmm_position", vault0_key.as_ref(), vault1_key.as_ref(), pool_key.as_ref(), &bump,
        ];
        let signer = [seeds];
        let cpi_accounts = cpi::accounts::DecreaseLiquidityV2 {
            nft_owner: ctx.accounts.position_state.to_account_info(),
            nft_account: ctx.accounts.position_nft_account.to_account_info(),
            personal_position: ctx.accounts.personal_position.to_account_info(),
            pool_state: ctx.accounts.pool_state.to_account_info(),
            protocol_position: ctx.accounts.protocol_position.to_account_info(),
            token_vault_0: ctx.accounts.raydium_pool_vault_0.to_account_info(),
            token_vault_1: ctx.accounts.raydium_pool_vault_1.to_account_info(),
            tick_array_lower: ctx.accounts.tick_array_lower.to_account_info(),
            tick_array_upper: ctx.accounts.tick_array_upper.to_account_info(),
            recipient_token_account_0: ctx.accounts.token_vault_0.to_account_info(),
            recipient_token_account_1: ctx.accounts.token_vault_1.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            token_program_2022: ctx.accounts.token_program_2022.to_account_info(),
            memo_program: ctx.accounts.memo_program.to_account_info(),
            vault_0_mint: ctx.accounts.vault_mint_0.to_account_info(),
            vault_1_mint: ctx.accounts.vault_mint_1.to_account_info(),
        };
        cpi::decrease_liquidity_v2(
            CpiContext::new(ctx.accounts.clmm_program.to_account_info(), cpi_accounts)
                .with_signer(&signer)
                .with_remaining_accounts(ctx.remaining_accounts.to_vec()),
            0, 0, 0,
        )
    }

    /// Removes all liquidity, collects accrued fees, closes the Raydium position,
    /// and advances the NFT generation so a replacement range can be opened.
    pub fn close_clmm_position<'a, 'b, 'c: 'info, 'info>(ctx: Context<'a, 'b, 'c, 'info, ManageClmmPosition<'info>>) -> Result<()> {
        require!(ctx.accounts.position_state.is_open, VaultError::NoOpenPosition);
        require_keys_eq!(ctx.accounts.vault_state_0.admin, ctx.accounts.admin.key(), VaultError::Unauthorized);
        require_keys_eq!(ctx.accounts.vault_state_1.admin, ctx.accounts.admin.key(), VaultError::Unauthorized);
        require_keys_eq!(ctx.accounts.position_state.position_nft_mint, ctx.accounts.position_nft_mint.key(), VaultError::InvalidPositionState);
        require_keys_eq!(ctx.accounts.position_state.personal_position, ctx.accounts.personal_position.key(), VaultError::InvalidPositionState);
        require_keys_eq!(ctx.accounts.position_state.pool, ctx.accounts.pool_state.key(), VaultError::InvalidPositionState);
        {
            let pool = ctx.accounts.pool_state.load()?;
            require_keys_eq!(ctx.accounts.vault_state_0.token_mint, pool.token_mint_0, VaultError::PoolMintMismatch);
            require_keys_eq!(ctx.accounts.vault_state_1.token_mint, pool.token_mint_1, VaultError::PoolMintMismatch);
            require_keys_eq!(ctx.accounts.raydium_pool_vault_0.key(), pool.token_vault_0, VaultError::PoolAccountMismatch);
            require_keys_eq!(ctx.accounts.raydium_pool_vault_1.key(), pool.token_vault_1, VaultError::PoolAccountMismatch);
        }
        let liquidity = ctx.accounts.personal_position.liquidity;
        let bump = [ctx.accounts.position_state.bump];
        let vault0_key = ctx.accounts.vault_state_0.key();
        let vault1_key = ctx.accounts.vault_state_1.key();
        let pool_key = ctx.accounts.pool_state.key();
        let seeds: &[&[u8]] = &[
            b"clmm_position", vault0_key.as_ref(), vault1_key.as_ref(), pool_key.as_ref(), &bump,
        ];
        let signer = [seeds];
        let decrease_accounts = cpi::accounts::DecreaseLiquidityV2 {
            nft_owner: ctx.accounts.position_state.to_account_info(),
            nft_account: ctx.accounts.position_nft_account.to_account_info(),
            personal_position: ctx.accounts.personal_position.to_account_info(),
            pool_state: ctx.accounts.pool_state.to_account_info(),
            protocol_position: ctx.accounts.protocol_position.to_account_info(),
            token_vault_0: ctx.accounts.raydium_pool_vault_0.to_account_info(),
            token_vault_1: ctx.accounts.raydium_pool_vault_1.to_account_info(),
            tick_array_lower: ctx.accounts.tick_array_lower.to_account_info(),
            tick_array_upper: ctx.accounts.tick_array_upper.to_account_info(),
            recipient_token_account_0: ctx.accounts.token_vault_0.to_account_info(),
            recipient_token_account_1: ctx.accounts.token_vault_1.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
            token_program_2022: ctx.accounts.token_program_2022.to_account_info(),
            memo_program: ctx.accounts.memo_program.to_account_info(),
            vault_0_mint: ctx.accounts.vault_mint_0.to_account_info(),
            vault_1_mint: ctx.accounts.vault_mint_1.to_account_info(),
        };
        cpi::decrease_liquidity_v2(
            CpiContext::new(ctx.accounts.clmm_program.to_account_info(), decrease_accounts)
                .with_signer(&signer)
                .with_remaining_accounts(ctx.remaining_accounts.to_vec()),
            liquidity, 0, 0,
        )?;
        let close_accounts = cpi::accounts::ClosePosition {
            nft_owner: ctx.accounts.position_state.to_account_info(),
            position_nft_mint: ctx.accounts.position_nft_mint.to_account_info(),
            position_nft_account: ctx.accounts.position_nft_account.to_account_info(),
            personal_position: ctx.accounts.personal_position.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        };
        cpi::close_position(
            CpiContext::new(ctx.accounts.clmm_program.to_account_info(), close_accounts).with_signer(&signer),
        )?;
        let state = &mut ctx.accounts.position_state;
        state.is_open = false;
        state.position_nft_mint = Pubkey::default();
        state.personal_position = Pubkey::default();
        state.generation = state.generation.checked_add(1).ok_or(VaultError::MathOverflow)?;
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
    pub vault_state: Box<Account<'info, VaultState>>,
    #[account(address = vault_state.token_mint)]
    pub input_mint: Box<Account<'info, Mint>>,
    #[account(mut, address = vault_state.token_vault, token::mint = input_mint, token::authority = vault_state)]
    pub token_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = vault_state.share_mint, mint::authority = vault_state)]
    pub share_mint: Box<Account<'info, Mint>>,
    #[account(mut, token::mint = share_mint, token::authority = user)]
    pub user_share_account: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = output_mint, token::authority = user)]
    pub user_output_token_account: Box<Account<'info, TokenAccount>>,
    pub output_mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [b"user_card", vault_state.key().as_ref(), user.key().as_ref()], bump = user_card.bump, constraint = user_card.vault == vault_state.key() @ VaultError::InvalidUserCard, constraint = user_card.owner == user.key() @ VaultError::InvalidUserCard)]
    pub user_card: Box<Account<'info, UserCard>>,
    pub user: Signer<'info>,
    #[account(address = pool_state.load()?.amm_config)]
    pub amm_config: Box<Account<'info, AmmConfig>>,
    #[account(mut)]
    pub pool_state: AccountLoader<'info, PoolState>,
    #[account(mut)]
    pub pool_token_vault_0: Box<InterfaceAccount<'info, InterfaceTokenAccount>>,
    #[account(mut)]
    pub pool_token_vault_1: Box<InterfaceAccount<'info, InterfaceTokenAccount>>,
    pub pool_mint_0: Box<InterfaceAccount<'info, InterfaceMint>>,
    pub pool_mint_1: Box<InterfaceAccount<'info, InterfaceMint>>,
    #[account(mut, address = pool_state.load()?.observation_key)]
    pub observation_state: AccountLoader<'info, ObservationState>,
    pub clmm_program: Program<'info, RaydiumClmm>,
    pub token_program: Program<'info, Token>,
    pub token_program_2022: Program<'info, Token2022>,
    /// CHECK: constrained to the canonical SPL Memo program.
    #[account(address = anchor_spl::memo::spl_memo::id())]
    pub memo_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct InitializePositionController<'info> {
    #[account(seeds = [b"vault", vault_state_0.token_mint.as_ref()], bump = vault_state_0.bump)]
    pub vault_state_0: Account<'info, VaultState>,
    #[account(seeds = [b"vault", vault_state_1.token_mint.as_ref()], bump = vault_state_1.bump)]
    pub vault_state_1: Account<'info, VaultState>,
    pub pool_state: AccountLoader<'info, PoolState>,
    #[account(init, payer = admin, space = PositionState::SPACE, seeds = [b"clmm_position", vault_state_0.key().as_ref(), vault_state_1.key().as_ref(), pool_state.key().as_ref()], bump)]
    pub position_state: Account<'info, PositionState>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OpenClmmPosition<'info> {
    #[account(mut, seeds = [b"vault", vault_state_0.token_mint.as_ref()], bump = vault_state_0.bump)]
    pub vault_state_0: Box<Account<'info, VaultState>>,
    #[account(mut, seeds = [b"vault", vault_state_1.token_mint.as_ref()], bump = vault_state_1.bump)]
    pub vault_state_1: Box<Account<'info, VaultState>>,
    #[account(mut, address = vault_state_0.token_vault, token::mint = vault_state_0.token_mint, token::authority = vault_state_0)]
    pub token_vault_0: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = vault_state_1.token_vault, token::mint = vault_state_1.token_mint, token::authority = vault_state_1)]
    pub token_vault_1: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [b"clmm_position", vault_state_0.key().as_ref(), vault_state_1.key().as_ref(), pool_state.key().as_ref()], bump = position_state.bump)]
    pub position_state: Box<Account<'info, PositionState>>,
    #[account(mut, seeds = [b"position_nft", position_state.key().as_ref(), &position_state.generation.to_le_bytes()], bump)]
    /// CHECK: Raydium initializes this deterministic NFT mint through CPI.
    pub position_nft_mint: UncheckedAccount<'info>,
    /// CHECK: Raydium initializes this associated NFT account.
    #[account(mut)]
    pub position_nft_account: UncheckedAccount<'info>,
    /// CHECK: Metadata is disabled for the position NFT.
    #[account(mut)]
    pub metadata_account: UncheckedAccount<'info>,
    #[account(mut)]
    pub pool_state: AccountLoader<'info, PoolState>,
    /// CHECK: Deprecated by Raydium but retained in its CPI layout.
    pub protocol_position: UncheckedAccount<'info>,
    /// CHECK: Raydium validates the tick-array PDAs for the provided start indexes.
    #[account(mut)]
    pub tick_array_lower: UncheckedAccount<'info>,
    /// CHECK: Raydium validates the tick-array PDAs for the provided start indexes.
    #[account(mut)]
    pub tick_array_upper: UncheckedAccount<'info>,
    /// CHECK: Raydium creates the personal-position PDA for this NFT.
    #[account(mut)]
    pub personal_position: UncheckedAccount<'info>,
    #[account(mut)]
    pub raydium_pool_vault_0: Box<InterfaceAccount<'info, InterfaceTokenAccount>>,
    #[account(mut)]
    pub raydium_pool_vault_1: Box<InterfaceAccount<'info, InterfaceTokenAccount>>,
    #[account(address = vault_state_0.token_mint)]
    pub vault_mint_0: Box<InterfaceAccount<'info, InterfaceMint>>,
    #[account(address = vault_state_1.token_mint)]
    pub vault_mint_1: Box<InterfaceAccount<'info, InterfaceMint>>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub metadata_program: Program<'info, Metadata>,
    pub token_program_2022: Program<'info, Token2022>,
    pub clmm_program: Program<'info, RaydiumClmm>,
}

#[derive(Accounts)]
pub struct ManageClmmPosition<'info> {
    #[account(seeds = [b"vault", vault_state_0.token_mint.as_ref()], bump = vault_state_0.bump)]
    pub vault_state_0: Box<Account<'info, VaultState>>,
    #[account(seeds = [b"vault", vault_state_1.token_mint.as_ref()], bump = vault_state_1.bump)]
    pub vault_state_1: Box<Account<'info, VaultState>>,
    #[account(mut, address = vault_state_0.token_vault, token::mint = vault_state_0.token_mint, token::authority = vault_state_0)]
    pub token_vault_0: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = vault_state_1.token_vault, token::mint = vault_state_1.token_mint, token::authority = vault_state_1)]
    pub token_vault_1: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [b"clmm_position", vault_state_0.key().as_ref(), vault_state_1.key().as_ref(), pool_state.key().as_ref()], bump = position_state.bump)]
    pub position_state: Box<Account<'info, PositionState>>,
    #[account(mut, address = position_state.position_nft_mint)]
    pub position_nft_mint: Box<InterfaceAccount<'info, InterfaceMint>>,
    #[account(mut, token::mint = position_nft_mint, token::authority = position_state)]
    pub position_nft_account: Box<InterfaceAccount<'info, InterfaceTokenAccount>>,
    #[account(mut, address = position_state.personal_position)]
    pub personal_position: Box<Account<'info, PersonalPositionState>>,
    #[account(mut, address = position_state.pool)]
    pub pool_state: AccountLoader<'info, PoolState>,
    /// CHECK: Deprecated by Raydium but retained in its CPI layout.
    pub protocol_position: UncheckedAccount<'info>,
    #[account(mut)]
    pub raydium_pool_vault_0: Box<InterfaceAccount<'info, InterfaceTokenAccount>>,
    #[account(mut)]
    pub raydium_pool_vault_1: Box<InterfaceAccount<'info, InterfaceTokenAccount>>,
    #[account(mut)]
    pub tick_array_lower: AccountLoader<'info, TickArrayState>,
    #[account(mut)]
    pub tick_array_upper: AccountLoader<'info, TickArrayState>,
    #[account(address = vault_state_0.token_mint)]
    pub vault_mint_0: Box<InterfaceAccount<'info, InterfaceMint>>,
    #[account(address = vault_state_1.token_mint)]
    pub vault_mint_1: Box<InterfaceAccount<'info, InterfaceMint>>,
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub token_program_2022: Program<'info, Token2022>,
    pub memo_program: Program<'info, Memo>,
    pub clmm_program: Program<'info, RaydiumClmm>,
}

#[account]
pub struct PositionState {
    pub vault_state_0: Pubkey,
    pub vault_state_1: Pubkey,
    pub pool: Pubkey,
    pub position_nft_mint: Pubkey,
    pub personal_position: Pubkey,
    pub tick_lower: i32,
    pub tick_upper: i32,
    pub generation: u64,
    pub is_open: bool,
    pub bump: u8,
}
impl PositionState {
    pub const SPACE: usize = 8 + 5 * 32 + 2 * 4 + 8 + 1 + 1;
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
    #[msg("Only the vault administrator can manage its CLMM position")]
    Unauthorized,
    #[msg("The two vaults must be different")]
    SameVault,
    #[msg("The lower tick must be less than the upper tick")]
    InvalidTickRange,
    #[msg("This controller already has an open CLMM position")]
    PositionAlreadyOpen,
    #[msg("There is no active CLMM position to manage")]
    NoOpenPosition,
    #[msg("Position controller or Raydium accounts do not match stored state")]
    InvalidPositionState,
}
