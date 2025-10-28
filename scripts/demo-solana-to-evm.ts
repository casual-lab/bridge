#!/usr/bin/env ts-node

import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log('\n============== Solana to EVM Bridge Demo ==============\n');

  // 设置 provider
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const wallet = provider.wallet as anchor.Wallet;

  // 加载程序
  const programId = new PublicKey(process.env.SOLANA_BRIDGE_PROGRAM_ID!);
  const idlPath = path.join(__dirname, '../target/idl/local_bridge.json');
  const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));
  const program = new Program(idl, programId, provider);

  const mint = new PublicKey(process.env.SOLANA_MINT_ADDRESS!);
  const [bridgeState] = PublicKey.findProgramAddressSync(
    [Buffer.from('bridge_state')],
    program.programId
  );

  // 模拟 EVM 接收地址
  const evmRecipient = Array.from(Buffer.from('0x1234567890123456789012345678901234567890'.slice(2), 'hex'));

  console.log('User (Solana):', wallet.publicKey.toBase58());
  console.log('EVM Recipient:', '0x' + Buffer.from(evmRecipient).toString('hex'));
  console.log('Program ID:', program.programId.toBase58());
  console.log('Bridge State:', bridgeState.toBase58());
  console.log('Mint:', mint.toBase58());
  console.log('');

  // 1. 查询初始余额
  console.log('1. Checking initial balances...');
  const userTokenAccount = await getAssociatedTokenAddress(mint, wallet.publicKey);
  
  try {
    const tokenAccountInfo = await getAccount(provider.connection, userTokenAccount);
    console.log('   Solana Token Balance:', Number(tokenAccountInfo.amount) / 1e6, 'tokens');
  } catch {
    console.log('   Solana Token Balance: 0 tokens (account not found)');
  }
  console.log('');

  // 2. 销毁代币
  const burnAmount = new anchor.BN(50 * 1e6); // 销毁 50 tokens
  console.log('2. Burning', burnAmount.toNumber() / 1e6, 'tokens...');

  const bridgeStateAccount = await program.account.bridgeState.fetch(bridgeState);
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
        user: wallet.publicKey,
      })
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
  const burnTx = await program.account.burnTransaction.fetch(burnTransaction);
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
