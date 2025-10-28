# Quick Reference Guide

## 常用命令

### 初始化设置
```bash
# 1. 安装依赖
npm install
cd relayer && npm install && cd ..

# 2. 生成测试密钥（必须！）
npm run generate-keys

# 3. 一键启动所有服务
npm run setup
```

### 启动服务
```bash
# 一键启动所有服务
npm run setup

# 手动启动 Hardhat
npm run node

# 手动启动 Solana validator
solana-test-validator --reset

# 启动 Relayer
cd relayer && npm run dev
```

### 编译和部署
```bash
# 编译所有合约
npm run compile:all

# 部署 EVM 合约
npm run deploy:evm

# 部署 Solana 程序
npm run deploy:solana

# 部署所有合约
npm run deploy:all
```

### 运行演示
```bash
# EVM → Solana 跨链演示
npm run demo:evm-to-solana

# Solana → EVM 跨链演示
npm run demo:solana-to-evm
```

### 停止服务
```bash
npm run stop
```

## 目录说明

- `contracts/evm/` - EVM 智能合约源码
- `programs/local-bridge/` - Solana Anchor 程序源码
- `relayer/` - Relayer 服务源码
- `scripts/` - 部署和演示脚本
- `deployments/` - 部署信息（自动生成）
- `logs/` - 服务日志（自动生成）

## 默认账户

### Hardhat 本地账户
```
Account #0: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Private Key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

### Solana 本地账户
```
使用 ~/.config/solana/id.json 中的密钥对
查看地址: solana address
```

## 重要端口

- **8545** - Hardhat 本地节点
- **8899** - Solana test validator
- **8900** - Solana WebSocket

## 故障排查

### 重置环境
```bash
# 停止所有服务
npm run stop

# 清理 Hardhat 缓存
rm -rf cache/ artifacts/

# 清理 Solana 缓存
rm -rf target/ test-ledger/

# 重新开始
npm run setup
```

### 查看日志
```bash
# Hardhat 日志
tail -f logs/hardhat.log

# Solana validator 日志
tail -f logs/solana-validator.log

# Relayer 日志
tail -f relayer/logs/combined.log
```

## 合约地址

部署后的合约地址会自动保存在：
- `.env` 文件
- `deployments/evm-deployment.json`
- `deployments/solana-deployment.json`

## 测试代币获取

### EVM 侧 Mock USDC
```javascript
// 使用水龙头功能
const usdc = await ethers.getContractAt("MockUSDC", USDC_ADDRESS);
await usdc.faucet(ethers.parseUnits("1000", 6)); // 领取 1000 USDC
```

### Solana 侧 Token
```bash
# 通过 Relayer 从 EVM 跨链获取
npm run demo:evm-to-solana
```
