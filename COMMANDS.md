# ⚡ 快速命令参考

## 🚀 一键启动（最快方式）

```bash
# 1. 生成密钥
npm run generate-keys

# 2. 一键启动所有服务（Hardhat + Solana + 部署）
npm run setup

# 3. 启动 Relayer（新终端）
cd relayer && npm run dev

# 4. 运行测试
npm run demo:evm-to-solana
```

---

## 📦 安装命令

```bash
# 安装项目依赖
npm install

## 'EOF' 
 Relayer 依赖
cd relayer && npm install && cd ..

# 安装所有依赖（一条命令）
npm install && cd relayer && npm install && cd ..
```

---

## 🔑 密钥管理

```bash

npm run generate-keys

# 查看 Solana 地址
solana address

# 查看 EVM 地址（在 .env 中）
grep EVM_PRIVATE_KEY .env
```

---

## 🌐 启动服务

```bash
# 一键启动所有（推荐）
npm run setup

# 手动启动 Hardhat
npx hardhat node

# 手动启动 Solana
solana-test-validator --reset

# 启动 Relayer
cd relayer && npm run dev
```

---



```bash
# 编译所有
npm run compile:all

# 仅编译 EVM
npx hardhat compile

# 仅编译 Solana
anchor build
```

---

## 📤 部署合约

```bash
# 部署所有
npm run deploy:all

# 仅部署 EVM
npm run deploy:evm
# 或
npx hardhat run scripts/deploy-evm.js --network localhost

#   Solana
npm run deploy:solana
# 或
anchor build && anchor deploy && npx ts-node scripts/deploy-solana.ts
```

---

## 🧪 运行测试

```bash
# EVM → Solana 跨链
npm run demo:evm-to-solana

# Solana → EVM 跨链
npm run demo:solana-to-evm

# 运行两个测试（依次执行）
npm run demo:evm-to-solana && npm run demo:solana-to-evm
```

---

## 💰 余额查询

### EVM USDC 余额
```bash
npx hardhat console --network localhost
```
```javascript
const usdc = await ethers.getContractAt("MockUSDC", process.env.MOCK_USDC_ADDRESS);
const balance = await usdc.balanceOf("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
console.log(ethers.formatUnits(balance, 6), "USDC");
```

### Solana Token 余额
```bash
spl-token accounts
```

### Solana SOL 余额
```bash
solana balance
```

---

## 💸 获取测试代币

### 空投 SOL
```bash
solana airdrop 10
```

### 铸造 USDC
```bash
npx hardhat console --network localhost
```
```javascript
const usdc = await ethers.getContractAt("MockUSDC", process.env.MOCK_USDC_ADDRESS);
await usdc.faucet(ethers.parseUnits("1000", 6));
```

---

## 📋 查看日志

```bash
# Hardhat 日志
tail -f logs/hardhat.log

# Solana 日志
tail -f logs/solana-validator.log

# Relayer 日志
tail -f relayer/logs/combined.log

# 实时监控所有日志（需要安装 multitail）
multitail logs/hardhat.log logs/solana-validator.log relayer/logs/combined.log
```

---

## 🔍 检查状态

### 检查运
```bash
ps aux | grep -E "hardhat|solana-test-validator|relayer"
```

### 检查端口占用
```bash
lsof -i :8545  # Hardhat
lsof -i :8899  # Solana
```

### 检查合约地址
```bash
cat .env | grep -E "BRIDGE_ADDRESS|MINT_ADDRESS"
```

### 检查部署信息
```bash
cat deployments/evm-deployment.json
cat deployments/solana-deployment.json
```

---

## 🛑 停止服务

```bash
# 使用脚
npm run stop

# 手动停止 Hardhat
pkill -f "hardhat node"

# 手动停止 Solana
pkill -f "solana-test-validator"

# 手动停止 Relayer
pkill -f "relayer"

anchor 
pkill -f "hardhat|solana-test-validator|relayer"
```

---

## 🧹 清理环境

```bash
# 清理编译产物
rm -rf cache/ artifacts/ target/

# 清理测试账本
rm -rf test-ledger/

# 清理 Anchor 缓存
rm -rf .anchor/

# 清理所有日志
rm -rf logs/*.log relayer/logs/*.log

# 完全清理（保留代码）
rm -rf cache/ artifacts/ target/ test-ledger/ .anchor/ logs/*.log relayer/logs/*.log node_modules/ relayer/node_modules/

# 重新开始
npm install && cd relayer && npm install && cd .. && npm run setup
```

---

## 🔧 Solana CLI 常用命令

```bash
# 查看配置
solana config get

# 设置 RPC URL
solana config set --url http://localhost:8899

# 查看账户信息
solana account <ADDRESS>

# 查看程序账户
solana program show 4zNJzVfMcFQsYWR62i6akHQXKB1t1YatSJtcJVHdbLt2

# 查看所有 token 账户
spl-token accounts

# 查看特定 token 余额
spl-token balance <MINT_ADDRESS>
```

---

## 🔧 Hardhat 常用命令

```bash
# 进入 console
npx hardhat console --network localhost

# 运行脚本
npx hardhat run scripts/FILE.js --network localhost

# 清理缓存
npx hardhat clean


npx hardhat accounts
```

---

## 🐛 故障排查命令

### Nonce 错误
```bash
npm run stop
npx hardhat node
npx hardhat run scripts/deploy-evm.js --network localhost
```

### 余额不足
```bash
solana airdrop 10
solana balance
```

### 端口占用
```bash
# 查找占用端口的进程
lsof -i :8545
lsof -i :8899

# 杀死进程
kill -9 <PID>
```

### 查看详细错误
```bash
# Hardhat 详细日志
npx hardhat node --verbose

# Solana 详细日志
solana-test-validator --log
```

---

## 📊 性能监控

```bash
# 实时监控 Relayer
tail -f relayer/logs/combined.log | grep -E "Detected|successful|Error"

# 监控交易
tail -f logs/hardhat.log | grep "eth_sendRawTransaction"

# 监控 Solana 
solana logs
```

---

## 🎯 快速测试流程（复制粘贴）

```bash
# 终端 1: 一键启动
npm run generate-keys && npm run setup

# 终端 2: 启动 Relayer
cd relayer && npm run dev

# 终端 3: 运行测试
npm run demo:evm-to-solana && sleep 3 && npm run demo:solana-to-evm
```

---

## 📝 环

```bash
# 查看所有环境变量
cat .env

# 更新环境变量
nano .env

# 验证环境变量
echo $EVM_BRIDGE_ADDRESS
```
