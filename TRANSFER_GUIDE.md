# 🌉 跨链转账使用指南

## 快速开始

### 📋 前提条件

确保所有服务正在运行:

```bash
# Terminal 1: Solana 验证器
solana-test-validator --reset

# Terminal 2: Hardhat 节点
npm exec hardhat node

# Terminal 3: Relayer 服务
cd relayer && npm run dev
```

---

## 🔷 → 🔶 EVM 到 Solana

### 基础用法

```bash
# 默认转账 100 USDC
npm run demo:evm-to-solana

# 自定义金额
npm run demo:evm-to-solana 50    # 转账 50 USDC
npm run demo:evm-to-solana 1     # 转账 1 USDC
npm run demo:evm-to-solana 0.5   # 转账 0.5 USDC
```

### 工作流程

1. **Lock USDC** - 在 EVM 链上锁定 USDC
2. **Relayer 检测** - Relayer 监听到 `Locked` 事件 (~5秒)
3. **Mint Tokens** - 在 Solana 链上铸造等量代币 (~1秒)
4. **Complete Lock** - Relayer 调用 EVM 合约确认完成

**总时间**: 约 10-15 秒

### 示例输出

```
============== EVM to Solana Bridge Demo ==============

📦 Transfer Amount: 1 USDC

1. Checking initial balances...
   EVM USDC Balance: 499850.0 USDC

2. Approving bridge to spend USDC...
   ✓ Approved

3. Locking 1.0 USDC...
   ✓ Transaction confirmed in block: 18
   ✓ Locked Event:
     - Nonce: 2
     - Amount: 1.0 USDC

4. Checking final balances...
   EVM USDC Balance: 499849.0 USDC
   Locked: 1.0 USDC

✅ Success! Wait ~10 seconds for Relayer to mint tokens on Solana
```

---

## 🔶 → 🔷 Solana 到 EVM

### 基础用法

```bash
# 默认转账 50 tokens
npm run demo:solana-to-evm

# 自定义金额
npm run demo:solana-to-evm 25    # 转账 25 tokens
npm run demo:solana-to-evm 10    # 转账 10 tokens
npm run demo:solana-to-evm 1     # 转账 1 token
```

### 工作流程

1. **Burn Tokens** - 在 Solana 链上销毁代币
2. **Relayer 检测** - Relayer 扫描交易历史 (~5秒)
3. **Release USDC** - 在 EVM 链上释放等量 USDC

**总时间**: 约 8-12 秒

### 自动余额检查

如果 Solana 余额不足,脚本会**自动**先执行 EVM → Solana 转账:

```bash
# 尝试转账 50 tokens,但只有 1 token
npm run demo:solana-to-evm 50

# 输出:
# ⚠️ Insufficient balance! Need 50 tokens, have 1
# → Running EVM→Solana mint to top up balance (minting 50 USDC)...
# ✓ Top-up completed! Waiting 10 seconds for Relayer...
# → New balance: 51 tokens
# 2. Burning 50.0 tokens...
```

### 示例输出

```
============== Solana to EVM Bridge Demo ==============

📦 Transfer Amount: 50 tokens

1. Checking initial token balance...
   Solana Token Balance: 100 tokens

2. Burning 50.0 tokens...
   ✓ Transaction confirmed
   ✓ Burned Event:
     - Nonce: 3
     - Amount: 50.0 tokens
     - EVM Recipient: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

3. Checking final balances...
   Solana Token Balance: 50.0 tokens
   Burned: 50.0 tokens

✅ Success! Wait ~10 seconds for Relayer to release USDC on EVM
```

---

## 📊 查看资产状态

### 实时余额查询

```bash
npm run check:balances
```

### 示例输出

```
🔷 EVM Chain
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📍 User Address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
   USDC Balance: 499,849.0 USDC

📍 Bridge Contract: 0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
   Locked USDC: 500,001.0 USDC


🔶 Solana Chain
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📍 Test User: AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9
   Balance: 1.0 tokens


╔════════════════════════════════════════════════════════════════╗
║                          Summary                               ║
╚════════════════════════════════════════════════════════════════╝

📊 Cross-Chain Balance:
   EVM Locked:     500,001.00 USDC
   Solana Minted:  1.00 tokens
   Difference:     500,000.00
   Status:         ⚠️  Imbalanced (check for pending transactions)
```

---

## 🎯 完整测试场景

### 场景 1: 双向往返测试

```bash
# 1. 查看初始状态
npm run check:balances

# 2. EVM → Solana (转 100 USDC)
npm run demo:evm-to-solana 100

# 3. 等待 10 秒
sleep 10

# 4. 查看中间状态
npm run check:balances
# 应该看到: Solana +100 tokens

# 5. Solana → EVM (转回 50 tokens)
npm run demo:solana-to-evm 50

# 6. 等待 10 秒
sleep 10

# 7. 查看最终状态
npm run check:balances
# 应该看到: User +50 USDC, Solana -50 tokens
```

### 场景 2: 小额多次转账

```bash
# 连续转账 5 次,每次 1 USDC
for i in {1..5}; do
  npm run demo:evm-to-solana 1
  sleep 12  # 等待 Relayer 处理
done

# 查看累积结果
npm run check:balances
# 应该看到: Solana +5 tokens
```

### 场景 3: 压力测试

```bash
# 快速连续转账(不等待)
npm run demo:evm-to-solana 10
npm run demo:evm-to-solana 20
npm run demo:evm-to-solana 30

# 等待一段时间让 Relayer 处理所有交易
sleep 30

# 检查是否全部处理完成
npm run check:balances
# 应该看到: Solana +60 tokens (10+20+30)
```

---

## ⚠️ 注意事项

### 时间延迟

- **EVM → Solana**: 等待约 10-15 秒
- **Solana → EVM**: 等待约 8-12 秒
- Relayer 轮询间隔: 5 秒

### 余额要求

**EVM 侧:**
- 需要足够的 USDC (检查 `npm run check:balances`)
- 需要 ETH 用于 gas (Hardhat 自动提供)

**Solana 侧:**
- 需要 SOL 用于交易费 (脚本自动 airdrop)
- 需要代币才能 burn (脚本自动检查并充值)

### 常见问题

**Q: 转账后余额没变化?**
- A: 等待 10-15 秒,Relayer 需要时间处理

**Q: Solana → EVM 提示余额不足?**
- A: 脚本会自动先执行 EVM → Solana 充值

**Q: 如何重置测试环境?**
```bash
npm run stop
rm -rf cache/ artifacts/ target/ test-ledger/
npm run setup
```

---

## 📈 监控和调试

### 查看 Relayer 日志

```bash
# 实时查看日志
tail -f relayer/logs/combined.log

# 搜索特定事件
grep "Locked event detected" relayer/logs/combined.log
grep "Burn event detected" relayer/logs/combined.log
```

### Hardhat 日志

```bash
tail -f logs/hardhat.log
```

### Solana 日志

```bash
tail -f logs/solana-validator.log
```

---

## 🎓 最佳实践

1. **始终等待**: 转账后等待 10-15 秒再检查余额
2. **检查服务**: 确保 Hardhat、Solana、Relayer 都在运行
3. **查看日志**: 出问题时检查 Relayer 日志
4. **小额测试**: 先用小金额测试(如 1 USDC)
5. **定期检查**: 使用 `npm run check:balances` 验证状态

---

## 🚀 快捷命令总结

```bash
# 基础转账
npm run demo:evm-to-solana              # EVM → Solana (100 USDC)
npm run demo:solana-to-evm              # Solana → EVM (50 tokens)

# 自定义金额
npm run demo:evm-to-solana 25           # 25 USDC
npm run demo:solana-to-evm 10           # 10 tokens

# 查看状态
npm run check:balances                  # 资产分布

# 服务管理
npm run setup                           # 启动所有服务
npm run stop                            # 停止所有服务

# 查看日志
tail -f relayer/logs/combined.log       # Relayer 日志
```

---

**享受你的跨链转账! 🎉**
