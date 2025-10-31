# 💰 跨链桥余额说明

## 📊 余额项解释

### 1. **User USDC Balance** (用户 USDC 余额)
- **含义**: 用户钱包中持有的 USDC 数量
- **查询**: `usdc.balanceOf(userAddress)`
- **初始值**: 1,000,000 USDC (部署时铸造)
- **变化**: 
  - Lock 时减少
  - Release 时增加

### 2. **Bridge Locked USDC** (桥接合约 USDC)
- **含义**: 桥接合约持有的**所有** USDC
- **查询**: `usdc.balanceOf(bridgeAddress)`
- **组成**:
  ```
  Bridge Total = Initial Pool + User Locked - Released
  ```
- **初始资金池**: 500,000 USDC (部署脚本转入)
- **用途**: 执行 `release()` 时支付给用户

### 3. **Solana Token Balance** (Solana 代币余额)
- **含义**: Solana 测试账户持有的 SPL token
- **查询**: 读取 Associated Token Account
- **变化**:
  - Mint 时增加 (EVM→Solana 后)
  - Burn 时减少 (Solana→EVM 前)

### 4. **Solana Total Supply** (总供应量)
- **含义**: 所有铸造的 SPL token 总量
- **查询**: Mint 账户的 supply 字段
- **关系**: 应等于所有 token 账户余额之和

---

## 🔄 完整资金流动

### **初始状态 (部署后)**
```
User:     1,000,000 USDC
Bridge:     500,000 USDC (初始资金池)
Solana:           0 tokens
```

### **场景 1: EVM → Solana (100 USDC)**
```
步骤:
1. User.lock(100 USDC)
   → User: -100 USDC
   → Bridge: +100 USDC
   
2. Relayer.mint(100 tokens)
   → Solana: +100 tokens

结果:
User:       999,900 USDC
Bridge:     500,100 USDC (500k池 + 100锁定)
Solana:         100 tokens
```

### **场景 2: Solana → EVM (50 tokens)**
```
步骤:
1. User.burn(50 tokens)
   → Solana: -50 tokens
   
2. Relayer.release(50 USDC)
   → Bridge: -50 USDC
   → User: +50 USDC

结果:
User:       999,950 USDC
Bridge:     500,050 USDC (500k池 + 50锁定)
Solana:          50 tokens
```

---

## ⚖️ 余额平衡判断

### **错误的判断方式** ❌
```typescript
// 直接比较 Bridge 总量和 Solana 总量
if (bridgeTotal === solanaMinted) {
  console.log('Balanced');
}
// 这是错的!因为 Bridge 包含初始资金池
```

### **正确的判断方式** ✅

#### **方法 A: 减去初始资金池**
```typescript
const INITIAL_POOL = 500000; // 从部署记录获取
const userLocked = bridgeTotal - INITIAL_POOL;

if (userLocked === solanaMinted) {
  console.log('Balanced');
}
```

#### **方法 B: 统计 Lock 事件**
```typescript
// 从 Locked 事件计算实际锁定量
const lockedEvents = await bridge.queryFilter('Locked');
const totalLocked = lockedEvents.reduce((sum, e) => sum + e.args.amount, 0);

// 从 Released 事件计算已释放量
const releasedEvents = await bridge.queryFilter('Released');
const totalReleased = releasedEvents.reduce((sum, e) => sum + e.args.amount, 0);

const netLocked = totalLocked - totalReleased;

if (netLocked === solanaMinted) {
  console.log('Balanced');
}
```

#### **方法 C: 使用合约状态**
```solidity
// 在合约中添加状态变量
uint256 public totalUserLocked;

function lock(...) {
    totalUserLocked += amount;
    // ...
}

function completeLock(...) {
    // 如果超时退款
    totalUserLocked -= amount;
}
```

---

## 📈 示例分析

### **案例: 当前测试状态**
```
User:       499,905 USDC
Bridge:     500,095 USDC
Solana:          95 tokens

分析:
Bridge Total = 500,095 USDC
Initial Pool = 500,000 USDC (部署时转入)
User Locked  = 500,095 - 500,000 = 95 USDC ✅
Solana Mint  = 95 tokens ✅

结论: ✅ 平衡! (95 = 95)
```

**为什么显示 Imbalanced?**
- 因为脚本直接比较 `500,095` 和 `95`
- 没有考虑初始资金池
- 这是**显示逻辑的问题**,不是实际失衡

---

## 🎯 最佳实践

### ✅ **推荐: 分别显示**
```
💰 Bridge Status
──────────────────────────────────────────────
   Initial Pool:  500,000.00 USDC (固定)
   User Locked:        95.00 USDC
   Released:            0.00 USDC
   Current Total:  500,095.00 USDC
   
   Solana Minted:      95.00 tokens
   Status: ✅ Balanced (95 locked = 95 minted)
```

### ❌ **避免: 混淆显示**
```
❌ EVM Locked: 500,095 USDC
❌ Solana Minted: 95 tokens
❌ Status: Imbalanced  (误导!)
```

---

## 🔧 修复建议

### **已修复: 移除自动充值逻辑**
```diff
- // 检查桥接合约余额,如果不足则转入一些
- const bridgeBalance = await evmUsdc.balanceOf(evmBridge.target);
- if (bridgeBalance < minBridgeBalance) {
-   await evmUsdc.transfer(evmBridge.target, 500000);
- }
```

**原因:**
- ❌ 测试脚本不应该管理资金池
- ❌ 破坏了余额统计的准确性
- ✅ 资金池管理应由部署脚本负责

### **改进: 更清晰的显示**
```diff
- console.log('EVM Locked:', bridgeTotal);
+ console.log('Bridge Total:', bridgeTotal, '(含初始资金池)');
+ console.log('Note: Bridge 包含初始资金池 (500k) + 用户锁定');
```

---

## 📝 总结

1. **Bridge USDC ≠ Locked USDC**
   - Bridge USDC = 资金池 + 用户锁定 - 已释放
   
2. **平衡的定义**
   - (用户锁定 - 已释放) = Solana 总供应量
   
3. **资金池的作用**
   - 确保有足够的 USDC 执行 release
   - 由部署脚本管理,不计入跨链余额
   
4. **测试脚本的职责**
   - ✅ 测试跨链功能
   - ❌ 管理资金池

---

**结论**: 当前的 "Imbalanced" 提示是**误报**,实际余额是平衡的!
