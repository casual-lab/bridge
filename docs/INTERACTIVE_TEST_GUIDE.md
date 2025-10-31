# 🌉 跨链桥交互式测试工具使用指南

## 📋 概述

这个交互式测试工具提供了一个简单的命令行界面,用于测试 EVM ↔ Solana 跨链桥的完整功能。

## 🚀 快速开始

### 前提条件

确保以下服务正在运行:

1. **Solana Test Validator**
   ```bash
   solana-test-validator --reset
   ```

2. **Hardhat 本地节点**
   ```bash
   npm exec hardhat node
   ```

3. **Relayer 服务**
   ```bash
   cd relayer
   npm run dev
   ```

4. **已部署合约**
   ```bash
   npm run deploy:evm
   npm run deploy:solana
   ```

### 启动交互式工具

```bash
npm run test:interactive
```

## 🎮 功能说明

启动后,你会看到以下菜单:

```
╔════════════════════════════════════════════════════════════╗
║        Cross-Chain Bridge Interactive Test Tool           ║
╚════════════════════════════════════════════════════════════╝

  1. 🔷 → 🔶  EVM to Solana (Lock USDC → Mint tokens)
  2. 🔶 → 🔷  Solana to EVM (Burn tokens → Release USDC)
  3. 📊  Check Asset Status
  4. 🔄  Refresh Menu
  5. 🚪  Exit
```

### 选项 1: EVM → Solana

**功能**: 在 EVM 上锁定 USDC,在 Solana 上铸造等量代币

**步骤**:
1. 选择选项 `1`
2. 输入要转账的 USDC 数量(例如: `100`)
3. 脚本会自动:
   - 检查余额
   - 授权 USDC (如需要)
   - 锁定 USDC
   - 显示交易哈希和 Lock Nonce

**等待**: 5-10 秒后,Relayer 会:
- 检测 Lock 事件
- 在 Solana 上铸造代币
- 调用 completeLock 完成交易

### 选项 2: Solana → EVM

**功能**: 在 Solana 上销毁代币,在 EVM 上释放等量 USDC

**步骤**:
1. 选择选项 `2`
2. 输入要转账的代币数量(例如: `50`)
3. 脚本会自动:
   - 检查 SOL 余额(不足时自动 airdrop)
   - 检查代币余额
   - 销毁代币
   - 显示交易签名和 Burn Nonce

**等待**: 5-10 秒后,Relayer 会:
- 检测 Burn 事件
- 解析真实的 EVM 接收地址
- 在 EVM 上释放 USDC 到你的地址

### 选项 3: 查看资产状态

**显示内容**:

#### 🔷 EVM Chain
- 用户地址和 USDC 余额
- 桥接合约锁定的 USDC 总量
- 当前 Lock Nonce

#### 🔶 Solana Chain  
- 测试用户地址
- SOL 余额
- SPL Token 余额
- Mint 总供应量

#### 💰 Cross-Chain Balance
- EVM 锁定的 USDC 总量
- Solana 铸造的代币总量
- 两者的差异
- 平衡状态 (✅ Balanced / ⚠️ Imbalanced)

**提示**: 如果显示不平衡,可能有未完成的跨链交易正在处理中。

### 选项 4: 刷新菜单

重新显示主菜单,不执行任何操作。

### 选项 5: 退出

安全退出程序。

## 💡 使用技巧

### 1. 完整的跨链循环测试

```
EVM → Solana:
1. 选择选项 1,输入 100
2. 等待 10 秒
3. 选择选项 3 查看余额 (应该看到 +100 tokens)

Solana → EVM:
4. 选择选项 2,输入 50
5. 等待 10 秒
6. 选择选项 3 查看余额 (应该看到 +50 USDC)
```

### 2. 监控 Relayer

在另一个终端查看 Relayer 日志:
```bash
tail -f /tmp/relayer.log
```

### 3. 检查交易

**EVM 交易**:
```bash
# Hardhat 控制台会显示所有交易
```

**Solana 交易**:
```bash
solana confirm <SIGNATURE>
```

## 🔧 故障排查

### "Insufficient balance"

**原因**: 余额不足

**解决**:
- EVM: 先运行一次 Solana → EVM 来获取 USDC
- Solana: 脚本会自动 airdrop SOL

### "No token account found"

**原因**: 测试账户没有 SPL Token Account

**解决**: 先运行一次 EVM → Solana,Relayer 会自动创建

### Relayer 没有反应

**检查**:
```bash
# 1. 确认 Relayer 在运行
ps aux | grep relayer

# 2. 查看日志
tail -f /tmp/relayer.log

# 3. 重启 Relayer
cd relayer && npm run dev
```

### 余额不平衡

**原因**: 
- 有未完成的交易
- Relayer 处理延迟

**解决**: 等待 10-15 秒后再次检查

## 📊 示例会话

```
Select option (1-5): 1
Enter amount (USDC): 100

📤 Locking USDC on EVM...
   Amount: 100 USDC
   Solana Recipient: AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9
✅ Transaction confirmed!
   Tx Hash: 0xef2d4...
   Block: 7
   Lock Nonce: 0

⏳ Waiting for Relayer to process (5-10 seconds)...
   Relayer will:
   1. Detect the Lock event
   2. Mint tokens on Solana
   3. Complete the lock transaction

💡 Tip: Wait 5-10 seconds, then check asset status (option 3)

Press Enter to continue...

Select option (1-5): 3

📊 资产分布状态
======================================================================

🔷 EVM Chain (Hardhat)
──────────────────────────────────────────────────────────────────
📍 User: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
   USDC Balance: 499900.0 USDC
📍 Bridge Contract: 0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
   Locked USDC: 500100.0 USDC
   Current Lock Nonce: 1

🔶 Solana Chain (Local Validator)
──────────────────────────────────────────────────────────────────
📍 Test User: AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9
   SOL Balance: 1.9970 SOL
   Token Balance: 100.00 tokens
📍 SPL Mint: Hv5L1ne4vponGvK72Pz8DKnRfo1Q6rVv1Lt8u1hc9tje
   Total Supply: 100.00 tokens

💰 Cross-Chain Balance
──────────────────────────────────────────────────────────────────
   EVM Locked:    500100.00 USDC
   Solana Minted: 100.00 tokens
   Difference:    500000.00
   Status:        ⚠️  Imbalanced (may have pending txs)
======================================================================
```

## 🎯 测试场景

### 基础测试
1. EVM → Solana (100 USDC)
2. 验证余额变化
3. Solana → EVM (50 tokens)
4. 验证余额变化

### 压力测试
1. 连续执行多次 EVM → Solana
2. 检查 Relayer 是否正常处理所有交易
3. 验证最终余额正确

### 边界测试
1. 转账小额 (1 USDC)
2. 转账大额 (10000 USDC)
3. 转账所有余额

## 📚 相关命令

```bash
# 查看余额 (独立脚本)
npm run check:balances

# EVM → Solana 演示
npm run demo:evm-to-solana

# Solana → EVM 演示
npm run demo:solana-to-evm

# 重新部署
npm run deploy:all
```

## 🆘 获取帮助

查看完整文档:
```bash
cat docs/IMPLEMENTATION_SUMMARY.md
```

---

**祝测试顺利! 🎉**
