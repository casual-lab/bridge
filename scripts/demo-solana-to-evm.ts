#!/usr/bin/env ts-node

import pkg from '@coral-xyz/anchor';
const { Program, BN, AnchorProvider, setProvider } = pkg;
import { PublicKey, Keypair } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

// 使用与 demo-evm-to-solana 相同的测试账户
const SOLANA_TEST_SEED = new Uint8Array(32).fill(1);
const SOLANA_TEST_KEYPAIR = Keypair.fromSeed(SOLANA_TEST_SEED);

async function main() {
  console.log('\n============== Solana to EVM Bridge Demo ==============\n');

  // 从命令行参数获取转账金额,默认 50 tokens
  const amountArg = process.argv[2];
  const transferAmount = amountArg ? parseFloat(amountArg) : 50;
  
  if (isNaN(transferAmount) || transferAmount <= 0) {
    console.error('❌ Error: Invalid amount. Usage: npm run demo:solana-to-evm [amount]');
    console.error('   Example: npm run demo:solana-to-evm 25');
    process.exit(1);
  }

  console.log(`📦 Transfer Amount: ${transferAmount} tokens\n`);

  // 设置 provider（使用部署者钱包作为 payer）
  const provider = AnchorProvider.env();
  setProvider(provider);

  // 但使用测试账户来 burn 代币
  const testUser = SOLANA_TEST_KEYPAIR;
  console.log('Note: Using test account (not deployer) for burning tokens');
  console.log('Test account has tokens from previous EVM->Solana demo\n');

  // 加载程序
  const programId = new PublicKey(process.env.SOLANA_BRIDGE_PROGRAM_ID!);
  const idlPath = path.join(process.cwd(), 'target/idl/local_bridge.json');
  const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));
  const program = new Program(idl, provider);

  const mint = new PublicKey(process.env.SOLANA_MINT_ADDRESS!);
  const [bridgeState] = PublicKey.findProgramAddressSync(
    [Buffer.from('bridge_state')],
    program.programId
  );

  // 使用真实的 EVM 用户地址 (Hardhat account #0)
  // 这样 release 的代币会返回到真实的用户账户
  const evmUserAddress = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
  const evmRecipient = Array.from(Buffer.from(evmUserAddress.slice(2), 'hex'));

  console.log('User (Solana):', testUser.publicKey.toBase58());
  console.log('EVM Recipient:', evmUserAddress);
  console.log('Program ID:', program.programId.toBase58());
  console.log('Bridge State:', bridgeState.toBase58());
  console.log('Mint:', mint.toBase58());
  console.log('');

  // 0. 确保测试账户有足够的 SOL（用于交易费用和租金）
  console.log('0. Ensuring test account has SOL...');
  const balance = await provider.connection.getBalance(testUser.publicKey);
  const minBalance = 0.1 * 1e9; // 至少需要 0.1 SOL
  
  if (balance < minBalance) {
    console.log(`   Current balance: ${balance / 1e9} SOL`);
    console.log('   Requesting airdrop of 2 SOL...');
    try {
      const airdropSignature = await provider.connection.requestAirdrop(
        testUser.publicKey,
        2 * 1e9 // 2 SOL
      );
      await provider.connection.confirmTransaction(airdropSignature);
      console.log('   ✓ Airdrop confirmed');
      const newBalance = await provider.connection.getBalance(testUser.publicKey);
      console.log(`   New balance: ${newBalance / 1e9} SOL`);
    } catch (error: any) {
      console.log(`   ⚠️  Airdrop failed: ${error.message}`);
      console.log('   Continuing anyway...');
    }
  } else {
    console.log(`   ✓ Sufficient balance: ${balance / 1e9} SOL`);
  }
  console.log('');

  // 1. 查询初始余额并确保有足够的代币
  console.log('1. Checking initial token balance...');
  const userTokenAccount = await getAssociatedTokenAddress(mint, testUser.publicKey);
  
  let currentBalance = 0;
  try {
    const tokenAccountInfo = await getAccount(provider.connection, userTokenAccount);
    currentBalance = Number(tokenAccountInfo.amount);
    console.log('   Solana Token Balance:', currentBalance / 1e6, 'tokens');
  } catch {
    console.log('   Solana Token Balance: 0 tokens (account not found)');
  }
  
  const burnAmount = new BN(transferAmount * 1e6); // 使用命令行参数的数量
  const requiredBalance = burnAmount.toNumber();
  
  // 如果余额不足，先执行 EVM→Solana mint
  if (currentBalance < requiredBalance) {
    console.log(`   ⚠️  Insufficient balance! Need ${requiredBalance / 1e6} tokens, have ${currentBalance / 1e6}`);
    console.log(`\n   → Running EVM→Solana mint to top up balance (minting ${transferAmount} USDC)...\n`);
    
    // 动态导入并执行 demo-evm-to-solana
    const { execSync } = await import('child_process');
    try {
      const result = execSync(`npm run demo:evm-to-solana ${transferAmount}`, {
        cwd: process.cwd(),
        stdio: 'inherit',
        encoding: 'utf8',
      });
      
      console.log('\n   ✓ Top-up completed! Waiting 10 seconds for Relayer to process...\n');
      await new Promise(resolve => setTimeout(resolve, 10000));
      
      // 重新查询余额
      const newTokenAccountInfo = await getAccount(provider.connection, userTokenAccount);
      currentBalance = Number(newTokenAccountInfo.amount);
      console.log(`   → New balance: ${currentBalance / 1e6} tokens\n`);
      
      if (currentBalance < requiredBalance) {
        throw new Error('Still insufficient balance after top-up. Relayer may not be running.');
      }
    } catch (error: any) {
      console.error('   ❌ Top-up failed:', error.message);
      throw error;
    }
  } else {
    console.log(`   ✓ Sufficient balance to burn ${burnAmount.toNumber() / 1e6} tokens`);
  }
  console.log('');

  // 2. 销毁代币
  console.log('2. Burning', burnAmount.toNumber() / 1e6, 'tokens...');

  const bridgeStateAccount = await (program.account as any).bridgeState.fetch(bridgeState);
  const burnNonce = bridgeStateAccount.burnNonce;
  
  const [burnTransaction] = PublicKey.findProgramAddressSync(
    [Buffer.from('burn_tx'), burnNonce.toArrayLike(Buffer, 'le', 8)],
    program.programId
  );

  try {
    const tx = await program.methods
      .burnTokens(burnAmount, evmRecipient)
      .accounts({
        bridgeState,
        burnTransaction,
        mint,
        userTokenAccount,
        user: testUser.publicKey,
      })
      .signers([testUser])
      .rpc();

    console.log('   Transaction signature:', tx);
    console.log('   ✓ Burn transaction confirmed');
    console.log('   Burn nonce:', burnNonce.toString());
  } catch (error: any) {
    console.error('   Error burning tokens:', error.message);
    if (error.logs) {
      console.error('   Logs:', error.logs);
    }
    throw error;
  }
  console.log('');

  // 3. 等待确认
  console.log('3. Waiting for transaction confirmation...');
  await new Promise(resolve => setTimeout(resolve, 2000));
  console.log('   ✓ Confirmed');
  console.log('');

  // 4. 查询最终余额
  console.log('4. Checking final balances...');
  try {
    const tokenAccountInfo = await getAccount(provider.connection, userTokenAccount);
    console.log('   Solana Token Balance:', Number(tokenAccountInfo.amount) / 1e6, 'tokens');
  } catch {
    console.log('   Solana Token Balance: 0 tokens');
  }
  console.log('');

  // 5. 查询交易状态
  console.log('5. Checking burn transaction status...');
  const burnTx = await (program.account as any).burnTransaction.fetch(burnTransaction);
  const statusNames = ['Pending', 'Completed', 'Refunded'];
  console.log('   Status:', statusNames[burnTx.status] || 'Unknown');
  console.log('   Amount:', burnTx.amount.toNumber() / 1e6, 'tokens');
  console.log('   Timestamp:', new Date(burnTx.timestamp.toNumber() * 1000).toISOString());
  console.log('');

  console.log('============== Demo Complete ==============\n');
  console.log('Next steps:');
  console.log('1. Wait for Relayer to process the burn event');
  console.log('2. Relayer will call release on EVM side');
  console.log('3. Check EVM USDC balance to verify cross-chain transfer');
  console.log('');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
