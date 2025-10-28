# 跨链桥工作流程图

## 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         用户                                     │
└────────────┬───────────────────────────────────┬─────────────────┘
             │                                   │
             │ EVM → Solana                      │ Solana → EVM
             │                                   │
┌────────────▼────────────┐         ┌───────────▼──────────────┐
│   EVM Chain (Hardhat)   │         │  Solana Chain (Local)    │
│  ┌──────────────────┐   │         │  ┌───────────────────┐   │
│  │  EVMBridge.sol   │   │         │  │  local_bridge     │   │
│  │  - lock()        │   │         │  │  - burn_tokens()  │   │
│  │  - release()     │   │         │  │  - mint_tokens()  │   │
│  │  - refund()      │   │         │  │  - refund_burn()  │   │
│  └──────────────────┘   │         │  └───────────────────┘   │
│  ┌──────────────────┐   │         │  ┌───────────────────┐   │
│  │  MockUSDC.sol    │   │         │  │  SPL Token        │   │
│  │  (ERC20)         │   │         │  │  (6 decimals)     │   │
│  └──────────────────┘   │         │  └───────────────────┘   │
└────────────┬────────────┘         └───────────┬──────────────┘
             │                                   │
             │ Events                            │ Events
             │ (Locked, Released)                │ (Burned, Minted)
             │                                   │
             └────────────┬──────────────────────┘
                          │
                ┌─────────▼──────────┐
                │   Relayer Service  │
                │  - Event Listener  │
                │  - TX Executor     │
                │  - Nonce Manager   │
                │  - Logger          │
                └────────────────────┘
```

## Lock → Mint 流程 (EVM → Solana)

```
User                 EVM Bridge           Relayer              Solana Bridge
 │                       │                    │                      │
 │  1. approve(USDC)    │                    │                      │
 ├──────────────────────>│                    │                      │
 │                       │                    │                      │
 │  2. lock(amount, addr)│                   │                      │
 ├──────────────────────>│                    │                      │
 │                       │                    │                      │
 │                       │  3. emit Locked    │                      │
 │                       │         event      │                      │
 │                       ├───────────────────>│                      │
 │                       │                    │                      │
 │                       │                    │  4. mint_tokens()    │
 │                       │                    ├─────────────────────>│
 │                       │                    │                      │
 │                       │                    │  5. emit Minted      │
 │                       │                    │         event        │
 │                       │                    │<─────────────────────┤
 │                       │                    │                      │
 │                       │  6. completeLock() │                      │
 │                       │<───────────────────┤                      │
 │                       │                    │                      │
 │  7. Check balance     │                    │                      │
 ├────────────────────────────────────────────┼─────────────────────>│
 │       (increased)     │                    │                      │
 │<─────────────────────────────────────────────────────────────────┤
```

## Burn → Release 流程 (Solana → EVM)

```
User              Solana Bridge         Relayer              EVM Bridge
 │                      │                    │                   │
 │  1. burn_tokens()   │                    │                   │
 ├─────────────────────>│                    │                   │
 │                      │                    │                   │
 │                      │  2. emit Burned    │                   │
 │                      │       event        │                   │
 │                      ├───────────────────>│                   │
 │                      │                    │                   │
 │                      │                    │  3. release()     │
 │                      │                    ├──────────────────>│
 │                      │                    │                   │
 │                      │                    │  4. emit Released │
 │                      │                    │       event       │
 │                      │                    │<──────────────────┤
 │                      │                    │                   │
 │                      │  5. complete_burn()│                   │
 │                      │<───────────────────┤                   │
 │                      │                    │                   │
 │  6. Check balance    │                    │                   │
 ├──────────────────────┼────────────────────┼──────────────────>│
 │    (decreased)       │                    │                   │
 │<──────────────────────────────────────────────────────────────┤
```

## 超时回滚流程 (Lock Refund)

```
User              EVM Bridge            Relayer
 │                    │                     │
 │  1. lock()         │                     │
 ├───────────────────>│                     │
 │                    │                     │
 │                    │  2. emit Locked     │
 │                    ├────────────────────>│
 │                    │                     │
 │                    │    ⏰ Timeout        │
 │                    │    (60 seconds)     │
 │                    │                     │
 │                    │  3. No mint         │
 │                    │     executed        │
 │                    │                     X
 │                    │                     
 │  4. refund()       │                     
 │  (after timeout)   │                     
 ├───────────────────>│                     
 │                    │                     
 │                    │  5. Transfer back   
 │                    │     USDC            
 │<───────────────────┤                     
 │                    │                     
 │                    │  6. emit Refunded   
 │                    │                     
```

## Nonce 管理机制

```
EVM Bridge State:
┌─────────────────────────────────┐
│ lockNonce: 0 → 1 → 2 → 3 ...   │  (递增计数器)
│                                 │
│ Lock Transactions:              │
│  [0]: {Pending}                 │
│  [1]: {Completed}               │
│  [2]: {Refunded}                │
│                                 │
│ processedReleaseNonces:         │
│  {5: true, 7: true, ...}        │  (映射表)
└─────────────────────────────────┘

Solana Bridge State:
┌─────────────────────────────────┐
│ mint_nonce: 0 → 1 → 2 ...       │
│ burn_nonce: 0 → 1 → 2 ...       │
│                                 │
│ processed_evm_nonces:           │
│  [0, 1, 2, ...]                 │  (数组)
│                                 │
│ Burn Transactions:              │
│  [0]: {Pending}                 │
│  [1]: {Completed}               │
└─────────────────────────────────┘
```

## 状态转换图

```
Lock Transaction States (EVM):
                                    
    ┌─────────┐                     
    │ Pending │                     
    └────┬────┘                     
         │                          
         │  Relayer completes mint  
         │  OR timeout expires      
         │                          
    ┌────▼─────────┬───────────┐    
    │  Completed   │  Refunded │    
    └──────────────┴───────────┘    
         (final)      (final)       

Burn Transaction States (Solana):
                                    
    ┌─────────┐                     
    │ Pending │                     
    └────┬────┘                     
         │                          
         │  Relayer completes release
         │  OR timeout expires      
         │                          
    ┌────▼─────────┬───────────┐    
    │  Completed   │  Refunded │    
    └──────────────┴───────────┘    
         (final)      (final)       
```

## 事件流图

```
EVM Events:
┌──────────────────────────────────────────────────────────┐
│ Locked(nonce, user, solanaAddr, amount, timestamp)      │
│   → Triggers: Relayer → Solana mint                     │
├──────────────────────────────────────────────────────────┤
│ Released(nonce, user, amount, timestamp)                │
│   → Confirms: Solana burn → EVM release completed       │
├──────────────────────────────────────────────────────────┤
│ Refunded(nonce, user, amount, timestamp)                │
│   → Confirms: Lock timeout refund executed              │
└──────────────────────────────────────────────────────────┘

Solana Events:
┌──────────────────────────────────────────────────────────┐
│ MintedEvent(evmNonce, solanaUser, evmUser, amount, ts)  │
│   → Confirms: EVM lock → Solana mint completed          │
├──────────────────────────────────────────────────────────┤
│ BurnedEvent(nonce, solanaUser, evmRecipient, amount, ts)│
│   → Triggers: Relayer → EVM release                     │
├──────────────────────────────────────────────────────────┤
│ RefundedEvent(nonce, user, amount, timestamp)           │
│   → Confirms: Burn timeout refund executed              │
└──────────────────────────────────────────────────────────┘
```

## 部署流程

```
┌────────────────────────────────────────────────────┐
│                  npm run setup                      │
└────────────┬───────────────────────────────────────┘
             │
    ┌────────▼────────┐
    │ Check deps:     │
    │ - Node.js       │
    │ - Solana CLI    │
    │ - Anchor CLI    │
    └────────┬────────┘
             │
    ┌────────▼────────┐
    │ Install deps:   │
    │ - npm install   │
    │ - relayer deps  │
    └────────┬────────┘
             │
    ┌────────▼────────┐
    │ Compile:        │
    │ - Hardhat       │
    │ - Anchor build  │
    └────────┬────────┘
             │
    ┌────────▼────────────┐
    │ Start networks:     │
    │ - Hardhat node      │
    │ - Solana validator  │
    └────────┬────────────┘
             │
    ┌────────▼────────┐
    │ Deploy EVM:     │
    │ - MockUSDC      │
    │ - EVMBridge     │
    └────────┬────────┘
             │
    ┌────────▼────────┐
    │ Deploy Solana:  │
    │ - Anchor deploy │
    │ - Create token  │
    │ - Initialize    │
    └────────┬────────┘
             │
    ┌────────▼────────┐
    │ Update .env     │
    │ - Addresses     │
    │ - Config        │
    └────────┬────────┘
             │
    ┌────────▼────────┐
    │ ✅ Ready!       │
    └─────────────────┘
```

## 系统组件交互图

```
┌──────────────────────────────────────────────────────────────────┐
│                        Development Environment                    │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────────┐         ┌─────────────────┐                │
│  │  Hardhat Node   │         │ Solana Validator│                │
│  │  :8545          │         │ :8899           │                │
│  └────────┬────────┘         └────────┬────────┘                │
│           │                           │                          │
│           │    ┌──────────────────────┤                          │
│           │    │                      │                          │
│  ┌────────▼────▼─────┐       ┌───────▼──────────┐               │
│  │   EVMBridge       │       │  local_bridge    │               │
│  │   MockUSDC        │       │  SPL Token       │               │
│  └────────┬──────────┘       └───────┬──────────┘               │
│           │                           │                          │
│           └───────────┬───────────────┘                          │
│                       │                                          │
│              ┌────────▼─────────┐                                │
│              │  Relayer Service │                                │
│              │  - Ethers.js     │                                │
│              │  - Solana web3   │                                │
│              │  - Winston log   │                                │
│              └──────────────────┘                                │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

---

**说明**:
- `│`: 垂直线
- `─`: 水平线
- `┌┐└┘├┤┬┴┼`: 边框连接
- `>`: 箭头方向
- `⏰`: 时间/超时
- `✅`: 完成标记
