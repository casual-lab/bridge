import { ethers } from 'ethers';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet, BN, EventParser, BorshCoder } from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger, format, transports } from 'winston';
import * as dotenv from 'dotenv';

// 加载父目录的 .env 文件
dotenv.config({ path: path.join(__dirname, '../../.env') });

// ============== Logger ==============
const logger = createLogger({
  level: 'debug', // 改为 debug 级别以查看详细日志
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
          // BigInt 序列化处理
          const stringifyWithBigInt = (obj: any) => {
            return JSON.stringify(obj, (key, value) => 
              typeof value === 'bigint' ? value.toString() : value
            , 2);
          };
          return `${timestamp} [${level}]: ${message} ${Object.keys(meta).length ? stringifyWithBigInt(meta) : ''}`;
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
  "function isReleaseProcessed(uint256 nonce) external view returns (bool)",
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
      const statusNum = Number(status);
      if (statusNum !== 0) { // 0 = Pending
        logger.warn('Lock transaction not pending, skipping', { nonce: nonce.toString(), status: statusNum });
        return;
      }
      
      // 在 Solana 上执行 mint
      await this.executeSolanaMint(
        Number(nonce),
        solanaAddress,
        this.evmAddressToBytes(user),
        Number(amount) // 转换为 Number，因为 USDC 金额不会超过 Number.MAX_SAFE_INTEGER
      );
      
      // 标记 EVM lock 为已完成
      const tx = await this.evmBridge.completeLock(nonce);
      await tx.wait();
      
      logger.info('Completed EVM lock transaction', {
        nonce: nonce.toString(),
        completeTxHash: tx.hash,
      });
    } catch (error) {
      logger.error('Error handling EVM lock event', { 
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
        event 
      });
    }
  }
  
  async executeSolanaMint(evmLockNonce: number, solanaAddressBytes: string, evmUserAddress: number[], amount: number) {
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
      
      // 调用 mint_tokens (使用 BN 类型，而不是 BigInt)
      const tx = await this.solanaProgram.methods
        .mintTokens(
          new BN(evmLockNonce),
          evmUserAddress,
          new BN(amount)
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
      logger.error('Error executing Solana mint', { 
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
        evmLockNonce 
      });
      throw error;
    }
  }
  
  // ============== Solana -> EVM (Burn -> Release) ==============
  async listenSolanaBurnEvents() {
    try {
      if (!this.solanaProgram) {
        return;
      }
      
      // 监听 BurnedEvent - 获取最近的交易
      const signatures = await this.solanaConnection.getSignaturesForAddress(
        this.solanaProgram.programId,
        { before: undefined, limit: 20 } // 增加到 20 个
      );
      
      logger.debug('Fetched Solana signatures', { 
        count: signatures.length,
        lastProcessedSlot: this.lastProcessedSolanaSlot 
      });
      
      // 如果是首次运行，处理所有找到的交易
      if (this.lastProcessedSolanaSlot === 0 && signatures.length > 0) {
        // 从最旧的交易开始（倒序）
        const oldestSlot = signatures[signatures.length - 1].slot;
        this.lastProcessedSolanaSlot = oldestSlot - 1;
        logger.info('Initialized Solana slot checkpoint from history', { 
          oldestSlot,
          lastProcessedSlot: this.lastProcessedSolanaSlot,
          totalSignatures: signatures.length
        });
      }
      
      for (const sig of signatures) {
        if (sig.slot <= this.lastProcessedSolanaSlot) {
          logger.debug('Skipping already processed transaction', { 
            slot: sig.slot, 
            lastProcessed: this.lastProcessedSolanaSlot,
            signature: sig.signature 
          });
          continue;
        }
        
        logger.info('Processing Solana transaction', { 
          slot: sig.slot, 
          signature: sig.signature 
        });
        
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
      
      if (!tx || !tx.meta) {
        logger.debug('Transaction not found or no metadata', { signature });
        return;
      }
      
      const logs = tx.meta.logMessages || [];
      
      // 检查是否是 Burn 交易
      const isBurnTx = logs.some(log => log.includes('Instruction: BurnTokens'));
      
      if (!isBurnTx) {
        logger.debug('Not a burn transaction', { signature });
        return;
      }
      
      logger.info('Found Burn transaction', { signature });
      
      // 查找事件数据 - Anchor 事件格式: "Program data: <base64>"
      const eventDataLog = logs.find(log => log.includes('Program data:'));
      
      if (!eventDataLog) {
        logger.warn('Burn transaction has no event data', { signature });
        return;
      }
      
      // 解析 base64 编码的事件数据
      // 格式: "Program data: <base64_encoded_data>"
      const base64Data = eventDataLog.split('Program data: ')[1];
      if (!base64Data) {
        logger.warn('Could not extract base64 data', { eventDataLog });
        return;
      }
      
      const eventBuffer = Buffer.from(base64Data, 'base64');
      
      // Anchor 事件格式:
      // - 前8字节: 事件标识符 (discriminator)
      // - 之后是事件数据的 Borsh 序列化
      // BurnedEvent 结构:
      //   - nonce: u64 (8 bytes)
      //   - solana_user: Pubkey (32 bytes)
      //   - evm_recipient: [u8; 20] (20 bytes)
      //   - amount: u64 (8 bytes)
      //   - timestamp: i64 (8 bytes)
      
      if (eventBuffer.length < 8 + 8 + 32 + 20 + 8 + 8) {
        logger.warn('Event buffer too short', { 
          bufferLength: eventBuffer.length,
          expected: 8 + 8 + 32 + 20 + 8 + 8 
        });
        return;
      }
      
      let offset = 8; // 跳过 discriminator
      
      // 读取 nonce (u64, little-endian)
      const nonce = Number(eventBuffer.readBigUInt64LE(offset));
      offset += 8;
      
      // 读取 solana_user (Pubkey, 32 bytes)
      const solanaUser = new PublicKey(eventBuffer.slice(offset, offset + 32));
      offset += 32;
      
      // 读取 evm_recipient ([u8; 20])
      const evmRecipientBytes = eventBuffer.slice(offset, offset + 20);
      const evmRecipient = '0x' + evmRecipientBytes.toString('hex');
      offset += 20;
      
      // 读取 amount (u64, little-endian)
      const amount = Number(eventBuffer.readBigUInt64LE(offset));
      offset += 8;
      
      // 读取 timestamp (i64, little-endian)
      const timestamp = Number(eventBuffer.readBigInt64LE(offset));
      
      logger.info('Parsed Burn event from Program data', {
        signature,
        nonce,
        solanaUser: solanaUser.toBase58(),
        evmRecipient,
        amount,
        timestamp,
      });
      
      await this.handleSolanaBurnEvent({
        solanaBurnNonce: new BN(nonce),
        solanaUser,
        amount: new BN(amount),
        evmRecipient: Array.from(evmRecipientBytes),
        timestamp: new BN(timestamp),
      }, signature);
      
    } catch (error) {
      logger.error('Error handling Solana transaction', { error, signature });
    }
  }
  
  async handleSolanaBurnEvent(eventData: any, signature: string) {
    try {
      const { solanaBurnNonce, solanaUser, evmRecipient, amount, timestamp } = eventData;
      
      // 将 EVM 接收地址从 bytes 转换为地址字符串
      const evmRecipientAddress = '0x' + Buffer.from(evmRecipient).toString('hex');
      
      logger.info('Detected Solana Burn event', {
        nonce: solanaBurnNonce.toString(),
        solanaUser: solanaUser?.toBase58?.() ?? 'N/A',
        evmRecipient: evmRecipientAddress,
        amount: amount.toString(),
        timestamp: timestamp?.toString() ?? 'N/A',
        txSignature: signature,
      });
      
      // 在 EVM 上执行 release
      await this.executeEvmRelease(
        Number(solanaBurnNonce),
        evmRecipientAddress,
        Number(amount)
      );
    } catch (error) {
      logger.error('Error handling Solana burn event', { 
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
        eventData 
      });
    }
  }
  
  async executeEvmRelease(nonce: number, user: string, amount: number) {
    try {
      // 检查是否已处理
      const processed = await this.evmBridge.isReleaseProcessed(nonce);
      if (processed) {
        logger.warn('Release already processed, skipping', { nonce });
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
      logger.error('Error executing EVM release', { 
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
        nonce 
      });
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
