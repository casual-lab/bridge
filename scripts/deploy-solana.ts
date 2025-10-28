#!/usr/bin/env ts-node

import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PublicKey, Keypair, SystemProgram } from '@solana/web3.js';
import { 
  TOKEN_PROGRAM_ID, 
  createMint, 
  getOrCreateAssociatedTokenAccount,
  mintTo 
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log('Starting Solana program deployment...\n');

  // 设置 provider
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const wallet = provider.wallet as anchor.Wallet;
  console.log('Deployer:', wallet.publicKey.toBase58());
  console.log('Cluster:', provider.connection.rpcEndpoint);

  // 加载程序
  const programId = new PublicKey(process.env.SOLANA_BRIDGE_PROGRAM_ID || 'BRDGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
  const idlPath = path.join(process.cwd(), 'target/idl/local_bridge.json');
  const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));
  const program = new Program(idl, provider);

  console.log('Program ID:', program.programId.toBase58());

  // 1. 创建 SPL Token Mint
  console.log('\n1. Creating SPL Token Mint...');
  
  // 生成 bridge_state PDA（用作 mint authority）
  const [bridgeState, bridgeStateBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('bridge_state')],
    program.programId
  );
  console.log('Bridge State PDA:', bridgeState.toBase58());

  const mint = await createMint(
    provider.connection,
    wallet.payer,
    bridgeState,  // mint authority 为 bridge_state PDA
    null,         // freeze authority
    6             // decimals (与 USDC 一致)
  );
  console.log('SPL Token Mint created:', mint.toBase58());

  // 2. 初始化 bridge 程序
  console.log('\n2. Initializing bridge program...');
  
  // 模拟 EVM bridge 地址（实际应该从 .env 读取）
  const evmBridgeAddress = process.env.EVM_BRIDGE_ADDRESS 
    ? Array.from(Buffer.from(process.env.EVM_BRIDGE_ADDRESS.slice(2), 'hex'))
    : new Array(20).fill(0);

  const relayerKeypair = wallet.payer; // 使用部署者作为 relayer
  
  try {
    const tx = await program.methods
      .initialize(evmBridgeAddress)
      .accounts({
        bridgeState,
        authority: wallet.publicKey,
        relayer: relayerKeypair.publicKey,
        mint,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    
    console.log('Initialize transaction:', tx);
    console.log('Bridge initialized successfully');
  } catch (error: any) {
    if (error.message.includes('already in use')) {
      console.log('Bridge already initialized, skipping...');
    } else {
      throw error;
    }
  }

  // 3. 创建测试用户并铸造一些代币
  console.log('\n3. Setting up test user...');
  
  const testUserTokenAccount = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    wallet.payer,
    mint,
    wallet.publicKey
  );
  console.log('Test user token account:', testUserTokenAccount.address.toBase58());

  // 4. 保存部署信息
  console.log('\n4. Saving deployment info...');
  
  // 更新 .env 文件
  const envPath = path.join(process.cwd(), '.env');
  let envContent = fs.readFileSync(envPath, 'utf-8');  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf-8');
  }
  
  const updateEnv = (content: string, key: string, value: string): string => {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(content)) {
      return content.replace(regex, `${key}=${value}`);
    } else {
      return content + `\n${key}=${value}`;
    }
  };
  
  envContent = updateEnv(envContent, 'SOLANA_BRIDGE_PROGRAM_ID', program.programId.toBase58());
  envContent = updateEnv(envContent, 'SOLANA_MINT_ADDRESS', mint.toBase58());
  envContent = updateEnv(envContent, 'SOLANA_BRIDGE_STATE', bridgeState.toBase58());
  
  fs.writeFileSync(envPath, envContent);
  console.log('Deployment info saved to .env');

  // 5. 生成部署摘要
  const deploymentSummary = {
    network: 'localnet',
    deployer: wallet.publicKey.toBase58(),
    program: {
      programId: program.programId.toBase58(),
      bridgeState: bridgeState.toBase58(),
    },
    token: {
      mint: mint.toBase58(),
      decimals: 6,
      mintAuthority: bridgeState.toBase58(),
    },
    relayer: relayerKeypair.publicKey.toBase58(),
    timestamp: new Date().toISOString(),
  };

  const summaryPath = path.join(process.cwd(), 'deployments/solana-deployment.json');
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  fs.writeFileSync(summaryPath, JSON.stringify(deploymentSummary, null, 2));
  console.log('Deployment summary saved to deployments/solana-deployment.json');

  console.log('\n============== Deployment Summary ==============');
  console.log('Program ID:', program.programId.toBase58());
  console.log('Bridge State:', bridgeState.toBase58());
  console.log('Token Mint:', mint.toBase58());
  console.log('Relayer:', relayerKeypair.publicKey.toBase58());
  console.log('================================================\n');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
