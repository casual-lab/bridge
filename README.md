# EVM ↔ Solana 跨链桥

 Hardhat 和 Anchor 的本地测试跨链桥，支持 EVM 链与 Solana 链之间的资产跨链转移。

## 🚀 快速开始

### 1. 安装依赖
```bash
npm install
cd relayer && npm install && cd ..
```

### 2. 生成测试密钥
```bash
npm run generate-keys
```

### 3. 一键启动（推荐）
```bash
npm run setup
```

### 4. 启动 Relayer
```bash
# 在新终端中运行
cd relayer && npm run dev
```

### 5. 运行演示
```bash
# EVM → Solana 跨链
npm run demo:evm-to-solana

# Solana → EVM 跨链
npm run demo:solana-to-evm
```

## 📚 详细文档

- **[完整测试指南](./TEST_GUIDE.md)** - 详细的测试流程和故障排查
- **[快速参考](./QUICKSTART.md)** - 常用命令速查
- **[设计文档](./docs/1跨链桥服务设计.md)** - 跨链桥架构设计
- **[工作流程](./docs/WORKFLOW.md)** - 跨链流程说明

## 🏗️ 架构概览

```
         ┌─────────────┐         ┌─────────────┐
  EVM Chain  │ ◄─────► │   Relayer   │ ◄─────► │   Solana    │
             │         │   Service   │         │             │
  EVMBridge  │         │             │         │ local_bridge│
  MockUSDC   │         │ Event Loop  │         │  SPL Token  │
         └─────────────┘         └─────────────┘
```

**Lock-Mint-Burn-Release 机制：**
- EVM → Solana: Lock USDC → Mint SPL Token
- Solana → EVM: Burn SPL Token → Release USDC

## 📁 项目结构

```
 contracts/evm/          # EVM 智能合约 (Solidity)
   ├── EVMBridge.sol       # 桥接合约
   └── MockUSDC.sol        # 测试 USDC
 programs/local-bridge/  # Solana 程序 (Anchor/Rust)
   └── src/lib.rs          # 桥接程序
 relayer/                # Relayer 服务 (TypeScript)
   └── src/index.ts        # 事件监听和交易执行
 scripts/                # 部署和演示脚本
   ├── deploy-evm.js       # EVM 部署
   ├── deploy-solana.ts    # Solana 部署
   ├── demo-evm-to-solana.ts
   └── demo-solana-to-evm.ts
.dockerignore .env .env.example .gitignore .hardhat-node.pid .pids .relayer.pid .solana-validator.pid Anchor.toml DOCKER_QUICKSTART.md Dockerfile QUICKSTART.md README.md TEST_GUIDE.md artifacts cache contracts deployments docker-compose.yml docs hardhat.config.js logs node_modules package-lock.json package.json programs relayer scripts test-ledger  
```

## 🔧 可用命令

### 服务管理
```bash
npm run setup              # 一键启动所有服务
npm run stop               # 停止所有服务
npm run node               # 仅启动 Hardhat
```

### 合约部署
```bash
npm run compile:all        # 编译所有合约
npm run deploy:evm         # 部署 EVM 合约
npm run deploy:solana      # 部署 Solana 程序
npm run deploy:all         # 部署所有合约
```

### 测试演示
```bash
anchor
npm run demo:solana-to-evm    # Solana → EVM 演示
```

### 工具命令
```bash
npm run generate-keys      # 生成测试密钥
```

## 🌐 默认配置

### 网络端口
- **Hardhat**: http://localhost:8545
- **Solana**: http://localhost:8899

### 测试账户
- **EVM**: `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` (Hardhat 账户 #0)
- **Solana**: `~/.config/solana/id.json`

## 🐛 故障排查

### 重置
```bash
npm run stop
rm -rf cache/ artifacts/ target/ test-ledger/
npm run setup
```

### 查看日志
```bash
tail -f logs/hardhat.log              # Hardhat 日志
tail -f logs/solana-validator.log     # Solana 日志
tail -f relayer/logs/combined.log     # Relayer 日志
```

### 空投测试代币
```bash
# Solana SOL
solana airdrop 10

# EVM USDC (通过合约)
# 在 Hardhat console 中：
const usdc = await ethers.getContractAt("MockUSDC", "USDC_ADDRESS");
await usdc.faucet(ethers.parseUnits("1000", 6));
```

## 📊 技术栈

- **EVM 侧**: Hardhat, Solidity 0.8.20, ethers.js v6
- **Solana 侧**: Anchor 0.30.0, Rust, @solana/web3.js
- **Relayer**: TypeScript, Node.js, Winston

## 🔐 安全说明

 **本项目仅用于本地测试和学习目的**

- 使用测试网络和测试密钥
- 不要在主网使用
- 生产环境需要额外的安全措施

## 📄 许可证

MIT
