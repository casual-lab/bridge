# � 完整测试清单

## 测试前准备

### ✅ 检查环境
```bash
# 1. 检查 Node.js 版本
node --version  # >= 18

# 2. 检查 Solana CLI
solana --version  # >= 1.17

# 3. 检查 Anchor CLI
anchor --version  # >= 0.30

# 4. 检查 Rust
rustc --version  # >= 1.70
```

---

## 📝 完整测试步骤（按顺序执行）

### 步骤 1: 安装依赖
```bash
npm install
cd relayer && npm install && cd ..
```
 **验证**: `node_modules` 目

---

### 步骤 2: 生成测试密钥
```bash
npm run generate-keys
```
 **验证**: `.env` 文件中有 `EVM_PRIVATE_KEY` 和测试密钥

---

### 步骤 3: 启动 Hardhat 节点（终端 1）
```bash
npx hardhat node
```
 **验证**: 看到 "Started HTTP and WebSocket JSON-RPC server at http://127.0.0.1:8545"

**保持此终端运行** ✋

---

### 步骤 4: 启动  2）
```bash
solana-test-validator --reset
```
 **验证**: 看到 "Ledger location: test-ledger"

**保持此终端** ✋

---

### 步骤 5: 部署 EVM 合约（终端 3）
```bash
npx hardhat run scripts/deploy-evm.js --network localhost
```
 **验证**: 
- 看到 "MockUSDC deployed to: 0x..."
- 看到 "EVMBridge deployed to: 0x..."
- `.env` --------有 `EVM_BRIDGE_ADDRESS` 和 `MOCK_USDC_ADDRESS`

---

### 步骤 6: 构建 Solana 程序
```bash
anchor build
```
 **验证**: `target/deploy/local_bridge.so` 文件存在

---

### 步骤 7: 复制程序文件
```bash
mkdir -p target/deploy
cp programs/local-bridge/target/deploy/local_bridge* target/deploy/
```
 **验证**: `target/deploy/local_bridge.so` 存在

---

### 步骤 8: 空投 SOL
```bash
solana airdrop 10
```
 **验证**: 
```bash
solana balance  # 应该显示 > 0 SOL
```

---

### 步骤 9: 部署 Solana 程序
```bash
anchor deploy
```
 **验证**: 
- 看到 "Deploy success"
- 看到程序 ID: `4zNJzVfMcFQsYWR62i6akHQXKB1t1YatSJtcJVHdbLt2`

---

### 步骤 10: 初始化 Solana 程
```bash
npx ts-node scripts/deploy-solana.ts
```
 **验证**: 
- 看到 "SPL Token Mint created:"
- 看到 "Bridge initialized successfully"
- `.env` 中有 `SOLANA_MINT_ADDRESS`

---

### 步骤 11: 启动 Relayer（终端 4）
```bash
cd relayer && npm run dev
```
 **验证**: 
- 看到 "Relayer Service Started"
- 看到 "Listening for EVM Lock events..."
- 看到 "Listening for Solana Burn events..."

**保持此终端运行** ✋

---

### 步骤 12: 测试 EVM → Solana（终端 5）
```bash
npm run demo:evm-to-solana
```

 **预期结果**:
```
 Approved
 Transaction confirmed in block: X
 Locked Event
  - Amount: 100.0 USDC
  - Status: Pending
```

 **检查 Relayer 日志**（终端 4）:
```
Detected EVM Lock event: nonce 0
Executing Solana mint...
 Solana mint successful
```

---

### 步骤 13: 验证 Solana 余额
```bash
# 查看 SPL Token 账户
spl-token accounts
```
 **验证**: 应该看到新创建的 token 账户和余额 100

---

### 步骤 14: 测试 Solana → EVM（终端 5）
```bash
npm run demo:solana-to-evm
```

 **预期**:
```
 Burned
  - Amount: 50.0
  - Status: Pending
```

 **检查 Relayer 日志**（终端 4）:
```
Detected Solana Burn event: nonce 0
Executing EVM release...
 EVM release successful
```

---

### 步骤 15: 验 EVM 余额
```bash
npx hardhat console --network localhost
```
```javascript
const usdc = await ethers.getContractAt("MockUSDC", process.env.MOCK_USDC_ADDRESS);
const balance = await usdc.balanceOf("YOUR_ADDRESS");
console.log(ethers.formatUnits(balance, 6), "USDC");
```
 **验证**: 余额应该增加了 50 USDC

---

## 🎉 测试完成检查清单

- [ ] Hardhat 节点运行中
- [ ] Solana validator 运行中
- [ ] EVM 合约部署成功
- [ ] Solana 程序部署成
- [ ] Relayer 服务运行中
- [ ] EVM → Solana 跨链成功
- [ ] Solana → EVM 跨链成功
- [ ] 所有余额验证正确
- [ ] 无错误日志

---

## 🛑 停止所有服务

```bash
# 方法 1: 使用脚本
npm run stop

# 方法 2: 手动停止
# 在每个终端按 Ctrl+C
# 或者：
pkill -f "hardhat node"
pkill -f "solana-test-validator"
pkill -f "relayer"
```

---

## 🔄 重新测试

```bash
# 1. 停止
npm run stop

# 2. 清理环境
rm -rf cache/ artifacts/ target/ test-ledger/ .anchor/

# 3. 重新开始
# 从步骤 3 开始执行
```

---

## 📊 预期时间

| 步骤 | 预计时间 |
|------|---------|
| 安装依赖 | 2-3 分钟 |
| 生成密钥 | 5 秒 |
| 启动 | 10 秒 |
| 部署合约 | 30 秒 |
| 测试跨链 | 10 秒/次 |
| **'EOF'** | **约 5 分钟** |

---

## 🐛 常见问题

### Q: "Nonce too low" 错误
**A**: 重启 Hardhat 节点并重新部署 EVM 合约

### Q: "Insufficient funds" 错误
**A**: 运行 `solana airdrop 10` 补充 SOL

### Q: Relayer 没有反应
**A**: 检查 `.env` 中的合约地址是否正确

### Q: 找不到 SPL Token 账户
**A**: 确保 Relayer 已处理 Lock 事件，检查 Relayer 日志
