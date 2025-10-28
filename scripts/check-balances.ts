#!/usr/bin/env ts-node

import { ethers } from 'ethers';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddress } from '@solana/spl-token';
import * as dotenv from 'dotenv';

dotenv.config();

// Hardhat 默认账户
const HARDHAT_DEFAULT_ACCOUNT = {
  address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
};

// EVM 合约 ABI
const MockUSDCABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function totalSupply() external view returns (uint256)",
];

const EVMBridgeABI = [
  "function lockNonce() external view returns (uint256)",
  "function processedReleaseNonces(uint256 nonce) external view returns (bool)",
  "function getLockTransactionStatus(uint256 nonce) external view returns (uint8)",
];

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║          Cross-Chain Bridge - Balance Checker                 ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // ============== EVM 侧检查 ==============
  console.log('🔷 EVM Chain (Hardhat Local Network)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const evmProvider = new ethers.JsonRpcProvider('http://localhost:8545');
  const usdcAddress = process.env.MOCK_USDC_ADDRESS!;
  const bridgeAddress = process.env.EVM_BRIDGE_ADDRESS!;
  
  const usdc = new ethers.Contract(usdcAddress, MockUSDCABI, evmProvider);
  const bridge = new ethers.Contract(bridgeAddress, EVMBridgeABI, evmProvider);

  // 检查用户余额
  const decimals = await usdc.decimals();
  const userBalance = await usdc.balanceOf(HARDHAT_DEFAULT_ACCOUNT.address);
  console.log(`\n📍 User Address: ${HARDHAT_DEFAULT_ACCOUNT.address}`);
  console.log(`   USDC Balance: ${ethers.formatUnits(userBalance, decimals)} USDC`);

  // 检查桥合约余额
  const bridgeBalance = await usdc.balanceOf(bridgeAddress);
  console.log(`\n📍 Bridge Contract: ${bridgeAddress}`);
  console.log(`   Locked USDC: ${ethers.formatUnits(bridgeBalance, decimals)} USDC`);

  // 检查总供应量
  const totalSupply = await usdc.totalSupply();
  console.log(`\n📍 USDC Contract: ${usdcAddress}`);
  console.log(`   Total Supply: ${ethers.formatUnits(totalSupply, decimals)} USDC`);

  // 检查交易 nonce
  const lockNonce = await bridge.lockNonce();
  console.log(`\n📊 Bridge Statistics:`);
  console.log(`   Total Locks: ${lockNonce.toString()}`);

  // 检查最近几个 Lock 交易的状态
  if (lockNonce > 0n) {
    console.log(`\n📋 Recent Lock Transactions:`);
    const startNonce = lockNonce > 5n ? lockNonce - 5n : 0n;
    for (let i = startNonce; i < lockNonce; i++) {
      const status = await bridge.getLockTransactionStatus(i);
      const statusText = status === 0 ? '⏳ Pending' : status === 1 ? '✅ Completed' : '🔙 Refunded';
      console.log(`   Nonce ${i}: ${statusText}`);
    }
  }

  // ============== Solana 侧检查 ==============
  console.log('\n\n🔶 Solana Chain (Local Validator)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const solanaConnection = new Connection('http://localhost:8899', 'confirmed');
  const mintAddress = new PublicKey(process.env.SOLANA_MINT_ADDRESS!);
  const programId = new PublicKey(process.env.SOLANA_BRIDGE_PROGRAM_ID!);

  // 检查 Mint 信息
  const mintInfo = await solanaConnection.getParsedAccountInfo(mintAddress);
  if (mintInfo.value && 'parsed' in mintInfo.value.data) {
    const mintData = mintInfo.value.data.parsed.info;
    console.log(`\n📍 SPL Token Mint: ${mintAddress.toBase58()}`);
    console.log(`   Total Supply: ${Number(mintData.supply) / 1_000_000} tokens`);
    console.log(`   Decimals: ${mintData.decimals}`);
    console.log(`   Mint Authority: ${mintData.mintAuthority || 'None'}`);
  }

  // 检查测试用户的代币账户
  const testUserPubkey = new PublicKey('AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9');
  try {
    const userTokenAccount = await getAssociatedTokenAddress(mintAddress, testUserPubkey);
    const accountInfo = await getAccount(solanaConnection, userTokenAccount);
    
    console.log(`\n📍 Test User: ${testUserPubkey.toBase58()}`);
    console.log(`   Token Account: ${userTokenAccount.toBase58()}`);
    console.log(`   Balance: ${Number(accountInfo.amount) / 1_000_000} tokens`);
  } catch (error: any) {
    if (error.message.includes('could not find account')) {
      console.log(`\n📍 Test User: ${testUserPubkey.toBase58()}`);
      console.log(`   ⚠️  No token account found (balance: 0)`);
    } else {
      console.log(`\n📍 Test User: ${testUserPubkey.toBase58()}`);
      console.log(`   ❌ Error: ${error.message}`);
    }
  }

  // 检查 Bridge State
  const [bridgeState] = PublicKey.findProgramAddressSync(
    [Buffer.from('bridge_state')],
    programId
  );
  console.log(`\n📍 Bridge State PDA: ${bridgeState.toBase58()}`);
  console.log(`   Program ID: ${programId.toBase58()}`);

  // 获取 Bridge State 账户数据
  try {
    const bridgeStateAccount = await solanaConnection.getAccountInfo(bridgeState);
    if (bridgeStateAccount) {
      console.log(`   Account exists: ✅`);
      console.log(`   Data size: ${bridgeStateAccount.data.length} bytes`);
    } else {
      console.log(`   Account exists: ❌`);
    }
  } catch (error: any) {
    console.log(`   Error fetching account: ${error.message}`);
  }

  // ============== 总结 ==============
  console.log('\n\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                          Summary                               ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  
  const evmLocked = Number(ethers.formatUnits(bridgeBalance, decimals));
  const solanaSupply = mintInfo.value && 'parsed' in mintInfo.value.data 
    ? Number(mintInfo.value.data.parsed.info.supply) / 1_000_000 
    : 0;
  
  console.log(`\n📊 Cross-Chain Balance:`);
  console.log(`   EVM Locked:     ${evmLocked.toFixed(2)} USDC`);
  console.log(`   Solana Minted:  ${solanaSupply.toFixed(2)} tokens`);
  console.log(`   Difference:     ${(evmLocked - solanaSupply).toFixed(2)}`);
  
  if (Math.abs(evmLocked - solanaSupply) < 0.01) {
    console.log(`   Status:         ✅ Balanced`);
  } else {
    console.log(`   Status:         ⚠️  Imbalanced (check for pending transactions)`);
  }
  
  console.log('\n');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
