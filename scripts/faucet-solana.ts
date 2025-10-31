#!/usr/bin/env ts-node

/**
 * Solana 水龙头脚本
 * 用途: 直接在 Solana 上铸造测试 tokens,不需要从 EVM 跨链
 */

import pkg from '@coral-xyz/anchor';
const { Program, BN, AnchorProvider, setProvider } = pkg;
import { PublicKey, Keypair } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount, createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

// 使用固定的测试账户
const SOLANA_TEST_SEED = new Uint8Array(32).fill(1);
const SOLANA_TEST_KEYPAIR = Keypair.fromSeed(SOLANA_TEST_SEED);

async function main() {
  console.log('\n🚰 Solana Token Faucet\n');

  // 从命令行参数获取金额,默认 100 tokens
  const amountArg = process.argv[2];
  const amount = amountArg ? parseFloat(amountArg) : 100;
  
  if (isNaN(amount) || amount <= 0 || amount > 1000) {
    console.error('❌ Error: Invalid amount. Usage: npm run faucet [amount]');
    console.error('   Amount must be between 0 and 1000');
    console.error('   Example: npm run faucet 100');
    process.exit(1);
  }

  const amountLamports = new BN(amount * 1_000_000); // 6 decimals

  // 设置 provider
  const provider = AnchorProvider.env();
  setProvider(provider);

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

  const testUser = SOLANA_TEST_KEYPAIR;

  console.log('User:', testUser.publicKey.toBase58());
  console.log('Program ID:', program.programId.toBase58());
  console.log('Mint:', mint.toBase58());
  console.log('Amount:', amount, 'tokens\n');

  // 1. 确保有 SOL
  console.log('1. Checking SOL balance...');
  const balance = await provider.connection.getBalance(testUser.publicKey);
  
  if (balance < 0.1 * 1e9) {
    console.log('   Requesting SOL airdrop...');
    try {
      const airdropSig = await provider.connection.requestAirdrop(
        testUser.publicKey,
        2 * 1e9
      );
      await provider.connection.confirmTransaction(airdropSig);
      console.log('   ✓ Airdrop confirmed');
    } catch (error: any) {
      console.log('   ⚠️  Airdrop failed:', error.message);
    }
  } else {
    console.log(`   ✓ Sufficient SOL: ${(balance / 1e9).toFixed(4)}`);
  }

  // 2. 获取或创建 token account
  console.log('\n2. Setting up token account...');
  const userTokenAccount = await getAssociatedTokenAddress(mint, testUser.publicKey);
  console.log('   Token Account:', userTokenAccount.toBase58());

  let accountExists = false;
  try {
    await getAccount(provider.connection, userTokenAccount);
    accountExists = true;
    console.log('   ✓ Token account exists');
  } catch {
    console.log('   Creating token account...');
    const ix = createAssociatedTokenAccountInstruction(
      testUser.publicKey,
      userTokenAccount,
      testUser.publicKey,
      mint
    );
    const tx = new (await import('@solana/web3.js')).Transaction().add(ix);
    const sig = await provider.connection.sendTransaction(tx, [testUser]);
    await provider.connection.confirmTransaction(sig);
    console.log('   ✓ Token account created');
  }

  // 3. 调用 faucet
  console.log('\n3. Calling faucet...');
  
  try {
    const tx = await program.methods
      .faucet(amountLamports)
      .accounts({
        bridgeState,
        mint,
        userTokenAccount,
        user: testUser.publicKey,
      })
      .signers([testUser])
      .rpc();

    console.log('   ✓ Transaction confirmed');
    console.log('   Signature:', tx);

    // 4. 查询新余额
    console.log('\n4. Checking new balance...');
    const accountInfo = await getAccount(provider.connection, userTokenAccount);
    const newBalance = Number(accountInfo.amount) / 1_000_000;
    console.log(`   Token Balance: ${newBalance} tokens`);

    console.log('\n✅ Success! You now have', amount, 'more tokens');
  } catch (error: any) {
    console.error('\n❌ Faucet failed:', error.message);
    if (error.logs) {
      console.error('\nLogs:');
      error.logs.forEach((log: string) => console.error('  ', log));
    }
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
