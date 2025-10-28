import { ethers } from 'ethers';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger, format, transports } from 'winston';
import * as dotenv from 'dotenv';

// 加载父目录的 .env 文件
dotenv.config({ path: path.join(__dirname, '../../.env') });

// ============== Logger ==============
const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    format.splat(),
    format.json()
  ),
  defaultMeta: { service: 'relayer' },
  transports: [
    new transports.File({ filename: 'logs/error.log', level: 'error' }),
    new transports.File({ filename: 'logs/combined.log' }),
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.printf(({ timestamp, level, message, ...meta }) => {
          return `${timestamp} [${level}]: ${message} ${Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''}`;
        })
      )
    })
  ]
});

// ============== Configuration ==============
interface RelayerConfig {
  evm: {
    rpcUrl: string;
    bridgeAddress: string;
    usdcAddress: string;
    privateKey: string;
  };
  solana: {
    rpcUrl: string;
    programId: string;
    mintAddress: string;
    walletPath: string;
  };
  pollInterval: number; // 轮询间隔（毫秒）
}

const config: RelayerConfig = {
  evm: {
    rpcUrl: process.env.EVM_RPC_URL || 'http://localhost:8545',
    bridgeAddress: process.env.EVM_BRIDGE_ADDRESS || '',
    usdcAddress: process.env.MOCK_USDC_ADDRESS || '',
    privateKey: process.env.RELAYER_EVM_PRIVATE_KEY || '',
  },
  solana: {
    rpcUrl: process.env.SOLANA_RPC_URL || 'http://localhost:8899',
    programId: process.env.SOLANA_BRIDGE_PROGRAM_ID || '',
    mintAddress: process.env.SOLANA_MINT_ADDRESS || '',
    walletPath: process.env.SOLANA_WALLET_PATH || path.join(process.env.HOME || '', '.config/solana/id.json'),
  },
  pollInterval: 5000, // 5秒
};

// ============== EVM Bridge ABI ==============
const EVMBridgeABI = [
  "event Locked(uint256 indexed nonce, address indexed user, bytes32 solanaAddress, uint256 amount, uint256 timestamp)",
  "event Released(uint256 indexed nonce, address indexed user, uint256 amount, uint256 timestamp)",
  "event Refunded(uint256 indexed nonce, address indexed user, uint256 amount, uint256 timestamp)",
  "function release(uint256 nonce, address user, uint256 amount) external",
  "function completeLock(uint256 nonce) external",
  "function getLockTransactionStatus(uint256 nonce) external view returns (uint8)",
];

// ============== Relayer Service ==============
class RelayerService {
  private evmProvider: ethers.Provider;
  private evmWallet: ethers.Wallet;
  private evmBridge: ethers.Contract;
  
  private solanaConnection: Connection;
  private solanaWallet: Wallet;
  private solanaProgram: Program | null = null;
  
  private lastProcessedEvmBlock: number = 0;
  private lastProcessedSolanaSlot: number = 0;
  
  constructor() {
    // 初始化 EVM 连接
    this.evmProvider = new ethers.JsonRpcProvider(config.evm.rpcUrl);
    this.evmWallet = new ethers.Wallet(config.evm.privateKey, this.evmProvider);
    this.evmBridge = new ethers.Contract(config.evm.bridgeAddress, EVMBridgeABI, this.evmWallet);
    
    // 初始化 Solana 连接
    this.solanaConnection = new Connection(config.solana.rpcUrl, 'confirmed');
    const keypairData = JSON.parse(fs.readFileSync(config.solana.walletPath, 'utf-8'));
    const keypair = Keypair.fromSecretKey(new Uint8Array(keypairData));
    this.solanaWallet = new Wallet(keypair);
    
    logger.info('Relayer initialized', {
      evmBridge: config.evm.bridgeAddress,
      solanaProgram: config.solana.programId,
      relayerEVM: this.evmWallet.address,
      relayerSolana: this.solanaWallet.publicKey.toBase58(),
    });
  }
  
  async initializeSolanaProgram() {
    try {
      const provider = new AnchorProvider(
        this.solanaConnection,
        this.solanaWallet,
        { commitment: 'confirmed' }
      );
      
      // 加载 IDL
      const idlPath = path.join(__dirname, '../../target/idl/local_bridge.json');
      const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));
      
      // 创建 Program 实例（programId 从 IDL 中获取，或者手动指定）
      const programId = new PublicKey(config.solana.programId);
      this.solanaProgram = new Program(idl, provider);
      
      // 如果需要覆盖 programId，使用 programId 参数
      // this.solanaProgram = new Program(idl, programId, provider);
      
      logger.info('Solana program initialized', { programId: programId.toBase58() });
    } catch (error) {
      logger.error('Failed to initialize Solana program', { error });
      throw error;
    }
  }
  
  // ============== EVM -> Solana (Lock -> Mint) ==============
  async listenEvmLockEvents() {
    try {
      const currentBlock = await this.evmProvider.getBlockNumber();
      
      if (this.lastProcessedEvmBlock === 0) {
        this.lastProcessedEvmBlock = currentBlock - 1;
      }
      
      const filter = this.evmBridge.filters.Locked();
      const events = await this.evmBridge.queryFilter(
        filter,
        this.lastProcessedEvmBlock + 1,
        currentBlock
      );
      
      for (const event of events) {
        await this.handleEvmLockEvent(event);
      }
      
      this.lastProcessedEvmBlock = currentBlock;
    } catch (error) {
      logger.error('Error listening to EVM lock events', { error });
    }
  }
  
  async handleEvmLockEvent(event: any) {
    try {
      const { nonce, user, solanaAddress, amount, timestamp } = event.args;
      
      logger.info('Detected EVM Lock event', {
        nonce: nonce.toString(),
        user,
        solanaAddress,
        amount: amount.toString(),
        timestamp: timestamp.toString(),
        txHash: event.transactionHash,
      });
      
      // 检查交易状态
      const status = await this.evmBridge.getLockTransactionStatus(nonce);
      if (status !== 0) { // 0 = Pending
        logger.warn('Lock transaction not pending, skipping', { nonce: nonce.toString(), status });
        return;
      }
      
      // 在 Solana 上执行 mint
      await this.executeSolanaMint(
        Number(nonce),
        solanaAddress,
        this.evmAddressToBytes(user),
        BigInt(amount.toString())
      );
      
      // 标记 EVM lock 为已完成
      const tx = await this.evmBridge.completeLock(nonce);
      await tx.wait();
      
      logger.info('Completed EVM lock transaction', {
        nonce: nonce.toString(),
        completeTxHash: tx.hash,
      });
    } catch (error) {
      logger.error('Error handling EVM lock event', { error, event });
    }
  }
  
  async executeSolanaMint(evmLockNonce: number, solanaAddressBytes: string, evmUserAddress: number[], amount: bigint) {
    try {
      if (!this.solanaProgram) {
        throw new Error('Solana program not initialized');
      }
      
      // 转换 Solana 地址
      const solanaUser = new PublicKey(Buffer.from(solanaAddressBytes.slice(2), 'hex'));
      
      // 获取或创建用户 token 账户
      const { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } = await import('@solana/spl-token');
      const mint = new PublicKey(config.solana.mintAddress);
      const userTokenAccount = await getAssociatedTokenAddress(mint, solanaUser);
      
      // 检查账户是否存在
      const accountInfo = await this.solanaConnection.getAccountInfo(userTokenAccount);
      const instructions = [];
      
      if (!accountInfo) {
        // 创建关联代币账户
        instructions.push(
          createAssociatedTokenAccountInstruction(
            this.solanaWallet.publicKey,
            userTokenAccount,
            solanaUser,
            mint
          )
        );
      }
      
      // 获取 bridge state PDA
      const [bridgeState] = PublicKey.findProgramAddressSync(
        [Buffer.from('bridge_state')],
        this.solanaProgram.programId
      );
      
      // 调用 mint_tokens
      const tx = await this.solanaProgram.methods
        .mintTokens(
          BigInt(evmLockNonce),
          evmUserAddress,
          amount
        )
        .accounts({
          bridgeState,
          mint,
          userTokenAccount,
          user: solanaUser,
          relayer: this.solanaWallet.publicKey,
        })
        .preInstructions(instructions)
        .rpc();
      
      logger.info('Minted tokens on Solana', {
        evmLockNonce,
        solanaUser: solanaUser.toBase58(),
        amount: amount.toString(),
        txSignature: tx,
      });
    } catch (error) {
      logger.error('Error executing Solana mint', { error, evmLockNonce });
      throw error;
    }
  }
  
  // ============== Solana -> EVM (Burn -> Release) ==============
  async listenSolanaBurnEvents() {
    try {
      if (!this.solanaProgram) {
        return;
      }
      
      // 获取最新的 slot
      const currentSlot = await this.solanaConnection.getSlot();
      
      if (this.lastProcessedSolanaSlot === 0) {
        this.lastProcessedSolanaSlot = currentSlot - 100; // 往前查100个slot
      }
      
      // 监听 BurnedEvent
      const signatures = await this.solanaConnection.getSignaturesForAddress(
        this.solanaProgram.programId,
        { before: undefined, limit: 10 }
      );
      
      for (const sig of signatures) {
        if (sig.slot <= this.lastProcessedSolanaSlot) continue;
        
        await this.handleSolanaTransaction(sig.signature);
        this.lastProcessedSolanaSlot = Math.max(this.lastProcessedSolanaSlot, sig.slot);
      }
    } catch (error) {
      logger.error('Error listening to Solana burn events', { error });
    }
  }
  
  async handleSolanaTransaction(signature: string) {
    try {
      if (!this.solanaProgram) return;
      
      const tx = await this.solanaConnection.getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
      
      if (!tx || !tx.meta) return;
      
      // 解析事件日志
      const events = [];
      for (const log of tx.meta.logMessages || []) {
        if (log.includes('Program data:')) {
          // 简化处理：实际应该解析 Anchor 事件
          if (log.includes('BurnedEvent')) {
            events.push({ type: 'Burned', log });
          }
        }
      }
      
      for (const event of events) {
        if (event.type === 'Burned') {
          // 这里需要解析实际的事件数据
          // 简化版本：从日志中提取信息
          logger.info('Detected Solana Burn event', { signature, event });
          
          // TODO: 解析事件，提取 nonce, user, evmRecipient, amount
          // 然后调用 executeEvmRelease
        }
      }
    } catch (error) {
      logger.error('Error handling Solana transaction', { error, signature });
    }
  }
  
  async executeEvmRelease(nonce: number, user: string, amount: bigint) {
    try {
      // 检查是否已处理
      const processed = await this.evmBridge.isReleaseProcessed(nonce);
      if (processed) {
        logger.warn('Release already processed', { nonce });
        return;
      }
      
      const tx = await this.evmBridge.release(nonce, user, amount);
      const receipt = await tx.wait();
      
      logger.info('Released tokens on EVM', {
        nonce,
        user,
        amount: amount.toString(),
        txHash: receipt.hash,
      });
    } catch (error) {
      logger.error('Error executing EVM release', { error, nonce });
      throw error;
    }
  }
  
  // ============== Helper Functions ==============
  evmAddressToBytes(address: string): number[] {
    const bytes = ethers.getBytes(address);
    return Array.from(bytes);
  }
  
  // ============== Main Loop ==============
  async start() {
    logger.info('Starting Relayer Service...');
    
    await this.initializeSolanaProgram();
    
    // 轮询监听事件
    setInterval(async () => {
      await this.listenEvmLockEvents();
    }, config.pollInterval);
    
    setInterval(async () => {
      await this.listenSolanaBurnEvents();
    }, config.pollInterval);
    
    logger.info('Relayer Service is running');
  }
}

// ============== Entry Point ==============
const relayer = new RelayerService();
relayer.start().catch((error) => {
  logger.error('Fatal error', { error });
  process.exit(1);
});

// 优雅关闭
process.on('SIGINT', () => {
  logger.info('Shutting down Relayer Service...');
  process.exit(0);
});
