use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, MintTo, Burn};

declare_id!("4zNJzVfMcFQsYWR62i6akHQXKB1t1YatSJtcJVHdbLt2");

#[program]
pub mod local_bridge {
    use super::*;

    /// 初始化桥接程序
    pub fn initialize(
        ctx: Context<Initialize>,
        evm_bridge_address: [u8; 20],  // EVM 桥接合约地址
    ) -> Result<()> {
        let bridge_state = &mut ctx.accounts.bridge_state;
        bridge_state.authority = ctx.accounts.authority.key();
        bridge_state.relayer = ctx.accounts.relayer.key();
        bridge_state.mint = ctx.accounts.mint.key();
        bridge_state.evm_bridge_address = evm_bridge_address;
        bridge_state.mint_nonce = 0;
        bridge_state.burn_nonce = 0;
        bridge_state.bump = ctx.bumps.bridge_state;
        
        msg!("Bridge initialized with mint: {}", ctx.accounts.mint.key());
        Ok(())
    }

    /// 铸造代币（Relayer 调用，响应 EVM 的 lock 操作）
    pub fn mint_tokens(
        ctx: Context<MintTokens>,
        evm_lock_nonce: u64,      // EVM lock 交易的 nonce
        evm_user_address: [u8; 20], // EVM 用户地址
        amount: u64,
    ) -> Result<()> {
        let bridge_state = &mut ctx.accounts.bridge_state;
        
        // 检查该 EVM lock nonce 是否已处理
        require!(
            !bridge_state.processed_evm_nonces.contains(&evm_lock_nonce),
            BridgeError::NonceAlreadyProcessed
        );

        // 记录已处理的 nonce
        bridge_state.processed_evm_nonces.push(evm_lock_nonce);

        // 铸造代币到用户账户
        let bridge_state_bump = bridge_state.bump;
        let seeds: &[&[u8]] = &[
            b"bridge_state",
            &[bridge_state_bump],
        ];
        let signer = &[seeds];

        let cpi_accounts = MintTo {
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.bridge_state.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        
        token::mint_to(cpi_ctx, amount)?;

        emit!(MintedEvent {
            evm_lock_nonce,
            solana_user: ctx.accounts.user.key(),
            evm_user_address,
            amount,
            timestamp: Clock::get()?.unix_timestamp,
        });

        msg!("Minted {} tokens for EVM nonce {}", amount, evm_lock_nonce);
        Ok(())
    }

    /// 销毁代币（用户调用，触发 EVM 的 release 操作）
    pub fn burn_tokens(
        ctx: Context<BurnTokens>,
        amount: u64,
        evm_recipient: [u8; 20],  // EVM 接收地址
    ) -> Result<()> {
        require!(amount > 0, BridgeError::InvalidAmount);

        let bridge_state = &mut ctx.accounts.bridge_state;
        let nonce = bridge_state.burn_nonce;
        bridge_state.burn_nonce += 1;

        // 创建 burn 交易记录
        let burn_tx = &mut ctx.accounts.burn_transaction;
        burn_tx.nonce = nonce;
        burn_tx.user = ctx.accounts.user.key();
        burn_tx.evm_recipient = evm_recipient;
        burn_tx.amount = amount;
        burn_tx.timestamp = Clock::get()?.unix_timestamp;
        burn_tx.status = TransactionStatus::Pending;

        // 销毁代币
        let cpi_accounts = Burn {
            mint: ctx.accounts.mint.to_account_info(),
            from: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        
        token::burn(cpi_ctx, amount)?;

        emit!(BurnedEvent {
            nonce,
            solana_user: ctx.accounts.user.key(),
            evm_recipient,
            amount,
            timestamp: burn_tx.timestamp,
        });

        msg!("Burned {} tokens, nonce: {}", amount, nonce);
        Ok(())
    }

    /// 用户退款（当 burn 操作超时后，用户可以重新获得代币）
    pub fn refund_burn(ctx: Context<RefundBurn>) -> Result<()> {
        let burn_tx = &mut ctx.accounts.burn_transaction;
        let clock = Clock::get()?;
        
        // 检查交易状态
        require!(
            burn_tx.status == TransactionStatus::Pending,
            BridgeError::InvalidTransactionStatus
        );

        // 检查是否超时（60秒）
        require!(
            clock.unix_timestamp >= burn_tx.timestamp + 60,
            BridgeError::TimeoutNotReached
        );

        // 更新状态
        burn_tx.status = TransactionStatus::Refunded;

        // 重新铸造代币给用户
        let bridge_state = &ctx.accounts.bridge_state;
        let bridge_state_bump = bridge_state.bump;
        let seeds: &[&[u8]] = &[
            b"bridge_state",
            &[bridge_state_bump],
        ];
        let signer = &[seeds];

        let cpi_accounts = MintTo {
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.bridge_state.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        
        token::mint_to(cpi_ctx, burn_tx.amount)?;

        emit!(RefundedEvent {
            nonce: burn_tx.nonce,
            user: burn_tx.user,
            amount: burn_tx.amount,
            timestamp: clock.unix_timestamp,
        });

        msg!("Refunded {} tokens for nonce {}", burn_tx.amount, burn_tx.nonce);
        Ok(())
    }

    /// 水龙头：铸造测试代币给用户（仅用于测试）
    pub fn faucet(ctx: Context<Faucet>, amount: u64) -> Result<()> {
        require!(amount > 0, BridgeError::InvalidAmount);
        require!(amount <= 1000 * 1_000_000, BridgeError::InvalidAmount); // 最多 1000 tokens

        let bridge_state = &ctx.accounts.bridge_state;
        let bridge_state_bump = bridge_state.bump;
        let seeds: &[&[u8]] = &[
            b"bridge_state",
            &[bridge_state_bump],
        ];
        let signer = &[seeds];

        let cpi_accounts = MintTo {
            mint: ctx.accounts.mint.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.bridge_state.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        
        token::mint_to(cpi_ctx, amount)?;

        msg!("Faucet: Minted {} tokens to {}", amount, ctx.accounts.user.key());
        Ok(())
    }

    /// Relayer 标记 burn 交易已完成（release 成功后调用）
    pub fn complete_burn(ctx: Context<CompleteBurn>) -> Result<()> {
        let burn_tx = &mut ctx.accounts.burn_transaction;
        
        require!(
            burn_tx.status == TransactionStatus::Pending,
            BridgeError::InvalidTransactionStatus
        );

        burn_tx.status = TransactionStatus::Completed;
        
        msg!("Completed burn transaction nonce: {}", burn_tx.nonce);
        Ok(())
    }

    /// 更新 Relayer 地址
    pub fn update_relayer(ctx: Context<UpdateRelayer>, new_relayer: Pubkey) -> Result<()> {
        let bridge_state = &mut ctx.accounts.bridge_state;
        bridge_state.relayer = new_relayer;
        
        msg!("Updated relayer to: {}", new_relayer);
        Ok(())
    }
}

// ============== Accounts ==============

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + BridgeState::INIT_SPACE,
        seeds = [b"bridge_state"],
        bump
    )]
    pub bridge_state: Account<'info, BridgeState>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// CHECK: Relayer address
    pub relayer: UncheckedAccount<'info>,
    
    pub mint: Account<'info, Mint>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MintTokens<'info> {
    #[account(
        mut,
        seeds = [b"bridge_state"],
        bump = bridge_state.bump,
        has_one = relayer
    )]
    pub bridge_state: Account<'info, BridgeState>,
    
    #[account(mut)]
    pub mint: Account<'info, Mint>,
    
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    
    /// CHECK: User account
    pub user: UncheckedAccount<'info>,
    
    pub relayer: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct BurnTokens<'info> {
    #[account(
        mut,
        seeds = [b"bridge_state"],
        bump = bridge_state.bump
    )]
    pub bridge_state: Account<'info, BridgeState>,
    
    #[account(
        init,
        payer = user,
        space = 8 + BurnTransaction::INIT_SPACE,
        seeds = [b"burn_tx", bridge_state.burn_nonce.to_le_bytes().as_ref()],
        bump
    )]
    pub burn_transaction: Account<'info, BurnTransaction>,
    
    #[account(mut)]
    pub mint: Account<'info, Mint>,
    
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub user: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RefundBurn<'info> {
    #[account(
        seeds = [b"bridge_state"],
        bump = bridge_state.bump
    )]
    pub bridge_state: Account<'info, BridgeState>,
    
    #[account(
        mut,
        seeds = [b"burn_tx", &burn_transaction.nonce.to_le_bytes()],
        bump,
        has_one = user
    )]
    pub burn_transaction: Account<'info, BurnTransaction>,
    
    #[account(mut)]
    pub mint: Account<'info, Mint>,
    
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    
    pub user: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Faucet<'info> {
    #[account(
        seeds = [b"bridge_state"],
        bump = bridge_state.bump
    )]
    pub bridge_state: Account<'info, BridgeState>,
    
    #[account(mut)]
    pub mint: Account<'info, Mint>,
    
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    
    pub user: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CompleteBurn<'info> {
    #[account(
        seeds = [b"bridge_state"],
        bump = bridge_state.bump,
        has_one = relayer
    )]
    pub bridge_state: Account<'info, BridgeState>,
    
    #[account(
        mut,
        seeds = [b"burn_tx", &burn_transaction.nonce.to_le_bytes()],
        bump
    )]
    pub burn_transaction: Account<'info, BurnTransaction>,
    
    pub relayer: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateRelayer<'info> {
    #[account(
        mut,
        seeds = [b"bridge_state"],
        bump = bridge_state.bump,
        has_one = authority
    )]
    pub bridge_state: Account<'info, BridgeState>,
    
    pub authority: Signer<'info>,
}

// ============== State ==============

#[account]
#[derive(InitSpace)]
pub struct BridgeState {
    pub authority: Pubkey,           // 管理员
    pub relayer: Pubkey,             // Relayer 地址
    pub mint: Pubkey,                // SPL Token Mint 地址
    pub evm_bridge_address: [u8; 20], // EVM 桥接合约地址
    pub mint_nonce: u64,             // Mint 操作计数
    pub burn_nonce: u64,             // Burn 操作计数
    #[max_len(1000)]
    pub processed_evm_nonces: Vec<u64>, // 已处理的 EVM lock nonce
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct BurnTransaction {
    pub nonce: u64,                  // 交易 nonce
    pub user: Pubkey,                // Solana 用户地址
    pub evm_recipient: [u8; 20],     // EVM 接收地址
    pub amount: u64,                 // 销毁金额
    pub timestamp: i64,              // 时间戳
    pub status: TransactionStatus,   // 交易状态
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, InitSpace)]
pub enum TransactionStatus {
    Pending,
    Completed,
    Refunded,
}

// ============== Events ==============

#[event]
pub struct MintedEvent {
    pub evm_lock_nonce: u64,
    pub solana_user: Pubkey,
    pub evm_user_address: [u8; 20],
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct BurnedEvent {
    pub nonce: u64,
    pub solana_user: Pubkey,
    pub evm_recipient: [u8; 20],
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct RefundedEvent {
    pub nonce: u64,
    pub user: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

// ============== Errors ==============

#[error_code]
pub enum BridgeError {
    #[msg("Nonce already processed")]
    NonceAlreadyProcessed,
    
    #[msg("Invalid amount")]
    InvalidAmount,
    
    #[msg("Invalid transaction status")]
    InvalidTransactionStatus,
    
    #[msg("Timeout not reached")]
    TimeoutNotReached,
    
    #[msg("Unauthorized")]
    Unauthorized,
}
