#!/usr/bin/env ts-node

import { ethers } from 'ethers';
import * as dotenv from 'dotenv';

dotenv.config();

// Hardhat 本地节点默认账户 #0（预充值 10000 ETH）
const HARDHAT_DEFAULT_ACCOUNT = {
  address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
};

const EVMBridgeABI = [
  "function lock(uint256 amount, bytes32 solanaAddress) external",
  "function getLockTransactionStatus(uint256 nonce) external view returns (uint8)",
  "function lockNonce() external view returns (uint256)",
  "event Locked(uint256 indexed nonce, address indexed user, bytes32 solanaAddress, uint256 amount, uint256 timestamp)",
];

const MockUSDCABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function decimals() external view returns (uint8)",
];

async function main() {
  console.log('\n============== EVM to Solana Bridge Demo ==============\n');

  // 连接到本地网络
  const provider = new ethers.JsonRpcProvider(process.env.EVM_RPC_URL || 'http://localhost:8545');
  
  // 使用 Hardhat 默认账户 #0（预充值 10000 ETH）
  // 这样确保在本地测试时总是有足够的余额
  console.log('Using Hardhat default account for testing');
  const wallet = new ethers.Wallet(HARDHAT_DEFAULT_ACCOUNT.privateKey, provider);

  const bridgeAddress = process.env.EVM_BRIDGE_ADDRESS;
  const usdcAddress = process.env.MOCK_USDC_ADDRESS;

  if (!bridgeAddress || !usdcAddress) {
    console.error('Error: Please deploy contracts first and set addresses in .env');
    process.exit(1);
  }

  const bridge = new ethers.Contract(bridgeAddress, EVMBridgeABI, wallet);
  const usdc = new ethers.Contract(usdcAddress, MockUSDCABI, wallet);

  // 模拟 Solana 接收地址（32字节）- 使用实际的 Solana 公钥格式
  // 这里使用一个示例地址，实际应该是真实的 Solana base58 地址解码后的 32 字节
  const solanaAddressBytes = Buffer.alloc(32);
  Buffer.from('SolanaRecipient12345').copy(solanaAddressBytes);
  const solanaAddress = '0x' + solanaAddressBytes.toString('hex');

  console.log('User Address (EVM):', wallet.address);
  console.log('Solana Recipient:', solanaAddress);
  console.log('Bridge Address:', bridgeAddress);
  console.log('USDC Address:', usdcAddress);
  console.log('');

  // 1. 查询初始余额
  console.log('1. Checking initial balances...');
  const decimals = await usdc.decimals();
  const initialBalance = await usdc.balanceOf(wallet.address);
  console.log('   EVM USDC Balance:', ethers.formatUnits(initialBalance, decimals), 'USDC');
  console.log('');

  // 2. 授权
  const lockAmount = ethers.parseUnits('100', decimals); // 锁定 100 USDC
  console.log('2. Approving bridge to spend USDC...');
  const approveTx = await usdc.approve(bridgeAddress, lockAmount);
  await approveTx.wait();
  console.log('   ✓ Approved');
  console.log('');

  // 3. 锁定代币
  console.log('3. Locking', ethers.formatUnits(lockAmount, decimals), 'USDC...');
  const currentNonce = await bridge.lockNonce();
  console.log('   Current nonce:', currentNonce.toString());
  
  // 获取当前账户的交易 nonce
  const txNonce = await provider.getTransactionCount(wallet.address);
  
  const lockTx = await bridge.lock(lockAmount, solanaAddress, { nonce: txNonce });
  console.log('   Transaction sent:', lockTx.hash);
  
  const receipt = await lockTx.wait();
  console.log('   ✓ Transaction confirmed in block:', receipt.blockNumber);
  
  // 解析事件
  const lockEvent = receipt.logs
    .map((log: any) => {
      try {
        return bridge.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((event: any) => event && event.name === 'Locked');

  if (lockEvent) {
    console.log('   ✓ Locked Event:');
    console.log('     - Nonce:', lockEvent.args.nonce.toString());
    console.log('     - User:', lockEvent.args.user);
    console.log('     - Solana Address:', lockEvent.args.solanaAddress);
    console.log('     - Amount:', ethers.formatUnits(lockEvent.args.amount, decimals), 'USDC');
    console.log('     - Timestamp:', new Date(Number(lockEvent.args.timestamp) * 1000).toISOString());
  }
  console.log('');

  // 4. 查询最终余额
  console.log('4. Checking final balances...');
  const finalBalance = await usdc.balanceOf(wallet.address);
  console.log('   EVM USDC Balance:', ethers.formatUnits(finalBalance, decimals), 'USDC');
  console.log('   Locked:', ethers.formatUnits(initialBalance - finalBalance, decimals), 'USDC');
  console.log('');

  // 5. 查询交易状态
  console.log('5. Checking transaction status...');
  const status = await bridge.getLockTransactionStatus(currentNonce);
  const statusNames = ['Pending', 'Completed', 'Refunded'];
  console.log('   Status:', statusNames[status] || 'Unknown');
  console.log('');

  console.log('============== Demo Complete ==============\n');
  console.log('Next steps:');
  console.log('1. Wait for Relayer to process the lock event');
  console.log('2. Relayer will call mint on Solana side');
  console.log('3. Check Solana token balance to verify cross-chain transfer');
  console.log('');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
