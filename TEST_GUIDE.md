# 跨链桥完整测试指南

## 🚀 快速开始（一键测试）

### 前置条件
```bash
# 确保已安装依赖
npm install
cd relayer && npm install && cd ..
```

### 完整测试流程

#### 1. 生成测试密钥
```bash
npm run generate-keys
```

#### 2. 启动服务并部署合约
```bash
# 在终端 1 中运行
npm run setup
```

这将自动完成：
- ✅ 启动 Hardhat 本地节点（端口 8545）
- ✅ 启动 Solana test validator（端口 8899）
- ✅ 编译所有合约
- ✅ 部署 EVM 合约（MockUSDC + EVMBridge）
- ✅ 部署 Solana 程序（local_bridge）
- ✅ 初始化跨链桥并创建 SPL Token

#### 3. 启动 Relayer
```bash
# 在终端 2 中运行
cd relayer && npm run dev
```

Relayer 会监听：
- EVM Lock 事件 → 触发 Solana Mint
- Solana Burn 事件 → 触发 EVM Release

#### 4. 测试 EVM → Solana 跨链
```bash
# 在终端 3 中运行
npm run demo:evm-to-solana
```

**预期结果：**
```
✅ 用户在 EVM 锁定 100 USDC
✅ Lock 事件发出
✅ Relayer 监听到事件
✅ Relayer 在 Solana 铸造代币
✅ Solana 用户收到 100 代币
```

#### 5. 测试 Solana → EVM 跨链
```bash
# 在终端 3 中运行
npm run demo:solana-to-evm
```

**预期结果：**
```
✅ 用户在 Solana 销毁代币
✅ Burn 事件发出
✅ Relayer 监听到事件
✅ Relayer 在 EVM 释放 USDC
✅ EVM 用户收到 USDC
```

#### 6. 停止所有服务
```bash
npm run stop
```

---

## 📋 分步测试（手动控制）

### Step 1: 启动本地网络

```bash
# 终端 1: Hardhat
npx hardhat node

# 终端 2: Solana
solana-test-validator --reset
```

### Step 2: 部署合约

```bash
# 部署 EVM 合约
npx hardhat run scripts/deploy-evm.js --network localhost

# 部署 Solana 程序
anchor build
anchor deploy
npx ts-node scripts/deploy-solana.ts
```

### Step 3: 启动 Relayer

```bash
cd relayer && npm run dev
```

### Step 4: 运行演示

```bash
# EVM → Solana
npm run demo:evm-to-solana

# Solana → EVM
npm run demo:solana-to-evm
```

---

## 🔍 验证测试结果

### 检查 EVM 余额
```bash
npx hardhat console --network localhost
```
```javascript
const usdc = await ethers.getContractAt("MockUSDC", "YOUR_USDC_ADDRESS");
const balance = await usdc.balanceOf("YOUR_ADDRESS");
console.log(ethers.formatUnits(balance, 6), "USDC");
```

### 检查 Solana 余额
```bash
spl-token accounts
```

### 查看 Relayer 日志
```bash
tail -f relayer/logs/combined.log
```

### 查看网络日志
```bash
# Hardhat
tail -f logs/hardhat.log

# Solana
tail -f logs/solana-validator.log
```

---

## 🐛 故障排查

### 问题：Relayer 没有处理事件

**检查：**
```bash
# 1. 确认服务运行
ps aux | grep -E "hardhat|solana-test-validator|node.*relayer"

# 2. 检查合约地址
cat .env | grep -E "BRIDGE_ADDRESS|MINT_ADDRESS"

# 3. 查看 Relayer 日志
tail -f relayer/logs/combined.log
```

### 问题：交易失败

**Solana 余额不足：**
```bash
solana airdrop 10
```

**EVM 余额不足：**
使用 Hardhat 默认账户（已预充值 10000 ETH）

### 问题：Nonce 错误

**解决方案：**
```bash
# 重启 Hardhat
npm run stop
npx hardhat node
npx hardhat run scripts/deploy-evm.js --network localhost
```

---

## 📊 测试场景

### 场景 1: 基本跨链（EVM → Solana）
```bash
npm run demo:evm-to-solana
```
- 锁定 100 USDC
- 验证 Solana 收到 100 代币

### 场景 2: 反向跨链（Solana → EVM）
```bash
npm run demo:solana-to-evm
```
- 销毁 50 代币
- 验证 EVM 收到 50 USDC

### 场景 3: 完整循环
```bash
# 1. EVM → Solana
npm run demo:evm-to-solana

# 2. 等待 Relayer 处理
sleep 5

# 3. Solana → EVM
npm run demo:solana-to-evm

# 4. 验证最终余额
```

---

## 🎯 性能测试

### 测试 Relayer 响应时间
```bash
# 运行演示并观察日志
npm run demo:evm-to-solana &
tail -f relayer/logs/combined.log
```

**关键指标：**
- Lock 事件到 Mint 确认：通常 < 5 秒
- Burn 事件到 Release 确认：通常 < 5 秒

---

## 📁 重要文件位置

- **部署信息**: `deployments/`
- **环境变量**: `.env`
- **合约地址**: `deployments/evm-deployment.json`, `deployments/solana-deployment.json`
- **日志文件**: `logs/`, `relayer/logs/`

---

## ✅ 测试检查清单

- [ ] 生成测试密钥
- [ ] 启动 Hardhat 节点
- [ ] 启动 Solana validator
- [ ] 部署 EVM 合约
- [ ] 部署 Solana 程序
- [ ] 启动 Relayer
- [ ] 测试 EVM → Solana
- [ ] 验证 Solana 余额增加
- [ ] 测试 Solana → EVM
- [ ] 验证 EVM 余额增加
- [ ] 检查所有日志无错误

---

## 🔄 重置环境

```bash
# 停止所有服务
npm run stop

# 清理缓存
rm -rf cache/ artifacts/ target/ test-ledger/ .anchor/

# 重新开始
npm run setup
```
