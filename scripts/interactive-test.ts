#!/usr/bin/env ts-node

/**
 * 交互式跨链桥测试脚本
 * 
 * 功能:
 * 1. EVM → Solana 跨链转账
 * 2. Solana → EVM 跨链转账
 * 3. 查看资产分布状态
 * 4. 查看交易历史
 */

import { ethers } from 'ethers';
import pkg from '@coral-xyz/anchor';
const { Program, BN, AnchorProvider, setProvider } = pkg;
import { PublicKey, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import * as readline from 'readline';

dotenv.config();

// 使用固定的测试账户
const SOLANA_TEST_SEED = new Uint8Array(32).fill(1);
const SOLANA_TEST_KEYPAIR = Keypair.fromSeed(SOLANA_TEST_SEED);

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

function colorize(text: string, color: keyof typeof colors): string {
  return `${colors[color]}${text}${colors.reset}`;
}

// 创建 readline 接口
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

// 全局变量
let evmProvider: ethers.Provider;
let evmSigner: ethers.Wallet;
let evmBridge: ethers.Contract;
let evmUsdc: ethers.Contract;
let solanaProvider: any;
let solanaProgram: any;
let solanaMint: PublicKey;
let solanaBridgeState: PublicKey;

// 初始化连接
async function initialize() {
  console.log(colorize('\n🔧 初始化连接...', 'cyan'));

  // EVM 初始化
  evmProvider = new ethers.JsonRpcProvider(process.env.EVM_RPC_URL || 'http://localhost:8545');
  evmSigner = new ethers.Wallet(
    process.env.RELAYER_EVM_PRIVATE_KEY || '',
    evmProvider
  );

  const bridgeAbi = [
    'event Locked(uint256 indexed nonce, address indexed user, bytes32 solanaAddress, uint256 amount, uint256 timestamp)',
    'event Released(uint256 indexed nonce, address indexed user, uint256 amount, uint256 timestamp)',
    'function lock(uint256 amount, bytes32 solanaAddress) external',
    'function release(uint256 nonce, address user, uint256 amount) external',
    'function getLockTransactionStatus(uint256 nonce) external view returns (uint8)',
    'function lockNonce() external view returns (uint256)',
  ];

  const usdcAbi = [
    'function balanceOf(address account) external view returns (uint256)',
    'function approve(address spender, uint256 amount) external returns (bool)',
    'function allowance(address owner, address spender) external view returns (uint256)',
    'function mint(address to, uint256 amount) external',
    'function transfer(address to, uint256 amount) external returns (bool)',
  ];

  evmBridge = new ethers.Contract(process.env.EVM_BRIDGE_ADDRESS || '', bridgeAbi, evmSigner);
  evmUsdc = new ethers.Contract(process.env.MOCK_USDC_ADDRESS || '', usdcAbi, evmSigner);

  // Solana 初始化
  solanaProvider = AnchorProvider.env();
  setProvider(solanaProvider);

  const programId = new PublicKey(process.env.SOLANA_BRIDGE_PROGRAM_ID!);
  const idlPath = path.join(process.cwd(), 'target/idl/local_bridge.json');
  const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));
  solanaProgram = new Program(idl, solanaProvider);

  solanaMint = new PublicKey(process.env.SOLANA_MINT_ADDRESS!);
  [solanaBridgeState] = PublicKey.findProgramAddressSync(
    [Buffer.from('bridge_state')],
    solanaProgram.programId
  );

  // 检查 USDC 余额,如果不足则自动铸造
  const userBalance = await evmUsdc.balanceOf(evmSigner.address);
  const minBalance = ethers.parseUnits('1000', 6); // 最少 1000 USDC
  
  if (userBalance < minBalance) {
    console.log(colorize('⚠️  USDC 余额不足,正在铸造测试代币...', 'yellow'));
    const mintAmount = ethers.parseUnits('1000000', 6); // 铸造 100 万
    const mintTx = await evmUsdc.mint(evmSigner.address, mintAmount);
    await mintTx.wait();
    console.log(colorize('✅ 已铸造 1,000,000 USDC\n', 'green'));
  }

  console.log(colorize('✅ 连接初始化完成\n', 'green'));
}

// 查看资产状态
async function checkBalances() {
  console.log(colorize('\n📊 资产分布状态', 'bright'));
  console.log('='.repeat(70));

  try {
    // EVM 状态
    const evmUserAddress = evmSigner.address;
    const evmBalance = await evmUsdc.balanceOf(evmUserAddress);
    const bridgeLockedBalance = await evmUsdc.balanceOf(evmBridge.target); // 桥接合约持有的 USDC
    const currentLockNonce = await evmBridge.lockNonce();

    console.log(colorize('\n🔷 EVM Chain (Hardhat)', 'blue'));
    console.log('─'.repeat(70));
    console.log(`📍 User: ${evmUserAddress}`);
    console.log(`   USDC Balance: ${colorize(ethers.formatUnits(evmBalance, 6) + ' USDC', 'green')}`);
    console.log(`📍 Bridge Contract: ${process.env.EVM_BRIDGE_ADDRESS}`);
    console.log(`   Locked USDC: ${colorize(ethers.formatUnits(bridgeLockedBalance, 6) + ' USDC', 'yellow')}`);
    console.log(`   Current Lock Nonce: ${currentLockNonce}`);

    // Solana 状态
    const testUserPubkey = SOLANA_TEST_KEYPAIR.publicKey;
    const solBalance = await solanaProvider.connection.getBalance(testUserPubkey);
    const userTokenAccount = await getAssociatedTokenAddress(solanaMint, testUserPubkey);
    
    let tokenBalance = 0;
    try {
      const accountInfo = await getAccount(solanaProvider.connection, userTokenAccount);
      tokenBalance = Number(accountInfo.amount);
    } catch (e) {
      // Token account doesn't exist
    }

    const mintInfo = await solanaProvider.connection.getAccountInfo(solanaMint);
    const mintData = mintInfo?.data;
    let totalSupply = 0;
    if (mintData && mintData.length >= 36) {
      totalSupply = Number(mintData.readBigUInt64LE(36)); // Supply at offset 36
    }

    console.log(colorize('\n🔶 Solana Chain (Local Validator)', 'blue'));
    console.log('─'.repeat(70));
    console.log(`📍 Test User: ${testUserPubkey.toBase58()}`);
    console.log(`   SOL Balance: ${colorize((solBalance / LAMPORTS_PER_SOL).toFixed(4) + ' SOL', 'green')}`);
    console.log(`   Token Balance: ${colorize((tokenBalance / 1_000_000).toFixed(2) + ' tokens', 'green')}`);
    console.log(`📍 SPL Mint: ${solanaMint.toBase58()}`);
    console.log(`   Total Supply: ${colorize((totalSupply / 1_000_000).toFixed(2) + ' tokens', 'yellow')}`);

    // 余额对比
    console.log(colorize('\n💰 Cross-Chain Balance', 'cyan'));
    console.log('─'.repeat(70));
    const evmLocked = Number(ethers.formatUnits(bridgeLockedBalance, 6));
    const solanaMinted = totalSupply / 1_000_000;
    
    // 假设初始资金池是 500,000 (可以从部署记录读取)
    const INITIAL_POOL = 500000;
    const userLocked = Math.max(0, evmLocked - INITIAL_POOL);
    const diff = Math.abs(userLocked - solanaMinted);
    
    console.log(`   Bridge Total:  ${evmLocked.toFixed(2)} USDC`);
    console.log(`   - Initial Pool: ${INITIAL_POOL.toFixed(2)} USDC`);
    console.log(`   = User Locked:  ${userLocked.toFixed(2)} USDC`);
    console.log(`   Solana Minted: ${solanaMinted.toFixed(2)} tokens`);
    
    if (diff < 0.01) {
      console.log(`   Status:        ${colorize('✅ Balanced', 'green')} (${userLocked.toFixed(2)} = ${solanaMinted.toFixed(2)})`);
    } else {
      console.log(`   Status:        ${colorize('⚠️  Imbalanced', 'yellow')} (差异: ${diff.toFixed(2)})`);
    }

    console.log('='.repeat(70));
  } catch (error: any) {
    console.error(colorize(`❌ Error: ${error.message}`, 'red'));
  }
}

// EVM → Solana 跨链
async function evmToSolana() {
  console.log(colorize('\n🔷 → 🔶 EVM to Solana Transfer', 'bright'));
  console.log('='.repeat(70));

  try {
    const amountStr = await question('Enter amount (USDC): ');
    const amount = parseFloat(amountStr);
    
    if (isNaN(amount) || amount <= 0) {
      console.log(colorize('❌ Invalid amount', 'red'));
      return;
    }

    const amountWei = ethers.parseUnits(amount.toString(), 6);

    // 检查余额
    const balance = await evmUsdc.balanceOf(evmSigner.address);
    if (balance < amountWei) {
      console.log(colorize(`❌ Insufficient balance. Have: ${ethers.formatUnits(balance, 6)} USDC`, 'red'));
      return;
    }

    // 检查授权
    const allowance = await evmUsdc.allowance(evmSigner.address, evmBridge.target);
    if (allowance < amountWei) {
      console.log('📝 Approving USDC...');
      const approveTx = await evmUsdc.approve(evmBridge.target, ethers.parseUnits('1000000', 6));
      await approveTx.wait();
      console.log(colorize('✅ Approved', 'green'));
    }

    // 准备 Solana 接收地址 (32 字节)
    const solanaRecipientPubkey = SOLANA_TEST_KEYPAIR.publicKey;
    const solanaAddressBytes = solanaRecipientPubkey.toBuffer();
    const solanaAddressHex = '0x' + solanaAddressBytes.toString('hex');

    console.log('\n📤 Locking USDC on EVM...');
    console.log(`   Amount: ${amount} USDC`);
    console.log(`   Solana Recipient: ${solanaRecipientPubkey.toBase58()}`);

    const tx = await evmBridge.lock(amountWei, solanaAddressHex);
    const receipt = await tx.wait();

    console.log(colorize(`✅ Transaction confirmed!`, 'green'));
    console.log(`   Tx Hash: ${receipt.hash}`);
    console.log(`   Block: ${receipt.blockNumber}`);

    // 解析事件
    const lockedEvent = receipt.logs
      .map((log: any) => {
        try {
          return evmBridge.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((event: any) => event?.name === 'Locked');

    if (lockedEvent) {
      console.log(`   Lock Nonce: ${lockedEvent.args.nonce}`);
    }

    console.log(colorize('\n⏳ Waiting for Relayer to process (5-10 seconds)...', 'yellow'));
    console.log('   Relayer will:');
    console.log('   1. Detect the Lock event');
    console.log('   2. Mint tokens on Solana');
    console.log('   3. Complete the lock transaction');

  } catch (error: any) {
    console.error(colorize(`❌ Error: ${error.message}`, 'red'));
  }
}

// Solana → EVM 跨链
async function solanaToEvm() {
  console.log(colorize('\n🔶 → 🔷 Solana to EVM Transfer', 'bright'));
  console.log('='.repeat(70));

  try {
    const amountStr = await question('Enter amount (tokens): ');
    const amount = parseFloat(amountStr);
    
    if (isNaN(amount) || amount <= 0) {
      console.log(colorize('❌ Invalid amount', 'red'));
      return;
    }

    const amountLamports = Math.floor(amount * 1_000_000);

    // 检查 SOL 余额
    const testUser = SOLANA_TEST_KEYPAIR;
    const solBalance = await solanaProvider.connection.getBalance(testUser.publicKey);
    
    if (solBalance < 0.1 * LAMPORTS_PER_SOL) {
      console.log('💰 Requesting SOL airdrop...');
      const airdropSig = await solanaProvider.connection.requestAirdrop(
        testUser.publicKey,
        2 * LAMPORTS_PER_SOL
      );
      await solanaProvider.connection.confirmTransaction(airdropSig);
      console.log(colorize('✅ Airdrop confirmed', 'green'));
    }

    // 检查代币余额
    const userTokenAccount = await getAssociatedTokenAddress(solanaMint, testUser.publicKey);
    let tokenBalance = 0;
    try {
      const accountInfo = await getAccount(solanaProvider.connection, userTokenAccount);
      tokenBalance = Number(accountInfo.amount);
    } catch (e) {
      console.log(colorize('❌ No token account found', 'red'));
      return;
    }

    if (tokenBalance < amountLamports) {
      console.log(colorize(`❌ Insufficient balance. Have: ${tokenBalance / 1_000_000} tokens`, 'red'));
      return;
    }

    // EVM 接收地址
    const evmRecipient = evmSigner.address;
    const evmRecipientBytes = Array.from(Buffer.from(evmRecipient.slice(2), 'hex'));

    console.log('\n🔥 Burning tokens on Solana...');
    console.log(`   Amount: ${amount} tokens`);
    console.log(`   EVM Recipient: ${evmRecipient}`);

    // 获取 burn transaction PDA
    const bridgeStateAccount: any = await (solanaProgram.account as any).bridgeState.fetch(solanaBridgeState);
    const burnNonce = bridgeStateAccount.burnNonce;

    const [burnTransaction] = PublicKey.findProgramAddressSync(
      [Buffer.from('burn_tx'), burnNonce.toArrayLike(Buffer, 'le', 8)],
      solanaProgram.programId
    );

    const tx = await (solanaProgram.methods as any)
      .burnTokens(new BN(amountLamports), evmRecipientBytes)
      .accounts({
        bridgeState: solanaBridgeState,
        burnTransaction,
        mint: solanaMint,
        userTokenAccount,
        user: testUser.publicKey,
      })
      .signers([testUser])
      .rpc();

    console.log(colorize(`✅ Transaction confirmed!`, 'green'));
    console.log(`   Signature: ${tx}`);
    console.log(`   Burn Nonce: ${burnNonce}`);

    console.log(colorize('\n⏳ Waiting for Relayer to process (5-10 seconds)...', 'yellow'));
    console.log('   Relayer will:');
    console.log('   1. Detect the Burn event');
    console.log('   2. Parse the event data');
    console.log('   3. Release USDC on EVM to your address');

  } catch (error: any) {
    console.error(colorize(`❌ Error: ${error.message}`, 'red'));
    if (error.logs) {
      console.error('Logs:', error.logs);
    }
  }
}

// 显示主菜单
async function showMenu() {
  console.log(colorize('\n╔════════════════════════════════════════════════════════════╗', 'cyan'));
  console.log(colorize('║        Cross-Chain Bridge Interactive Test Tool           ║', 'cyan'));
  console.log(colorize('╚════════════════════════════════════════════════════════════╝', 'cyan'));
  console.log('');
  console.log('  1. 🔷 → 🔶  EVM to Solana (Lock USDC → Mint tokens)');
  console.log('  2. 🔶 → 🔷  Solana to EVM (Burn tokens → Release USDC)');
  console.log('  3. 📊  Check Asset Status');
  console.log('  4. 🔄  Refresh Menu');
  console.log('  5. 🚪  Exit');
  console.log('');
}

// 主函数
async function main() {
  try {
    await initialize();

    // 首次显示资产状态
    await checkBalances();

    while (true) {
      await showMenu();
      const choice = await question(colorize('Select option (1-5): ', 'bright'));

      switch (choice.trim()) {
        case '1':
          await evmToSolana();
          console.log(colorize('\n💡 Tip: Wait 5-10 seconds, then check asset status (option 3)', 'cyan'));
          await question('\nPress Enter to continue...');
          break;

        case '2':
          await solanaToEvm();
          console.log(colorize('\n💡 Tip: Wait 5-10 seconds, then check asset status (option 3)', 'cyan'));
          await question('\nPress Enter to continue...');
          break;

        case '3':
          await checkBalances();
          await question('\nPress Enter to continue...');
          break;

        case '4':
          // Just refresh
          break;

        case '5':
          console.log(colorize('\n👋 Goodbye!\n', 'green'));
          rl.close();
          process.exit(0);

        default:
          console.log(colorize('\n❌ Invalid option. Please select 1-5.', 'red'));
          await question('Press Enter to continue...');
      }
    }
  } catch (error: any) {
    console.error(colorize(`\n❌ Fatal error: ${error.message}`, 'red'));
    rl.close();
    process.exit(1);
  }
}

// 运行
main();
