// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title EVMBridge
 * @dev EVM 侧跨链桥合约，支持锁定、释放和退款功能
 */
contract EVMBridge is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // 交易状态枚举
    enum TransactionStatus {
        Pending,     // 待处理
        Completed,   // 已完成
        Refunded     // 已退款
    }

    // 锁定交易结构
    struct LockTransaction {
        address user;           // 用户 EVM 地址
        bytes32 solanaAddress;  // Solana 接收地址（32字节）
        uint256 amount;         // 锁定金额
        uint256 timestamp;      // 锁定时间
        TransactionStatus status; // 交易状态
    }

    // USDC 代币合约地址
    IERC20 public usdcToken;
    
    // Relayer 地址
    address public relayer;
    
    // 超时时间（默认 60 秒）
    uint256 public timeoutDuration = 60;
    
    // 锁定交易 nonce 计数器
    uint256 public lockNonce;
    
    // 释放交易 nonce 映射（记录已处理的 Solana burn nonce）
    mapping(uint256 => bool) public processedReleaseNonces;
    
    // 锁定交易映射
    mapping(uint256 => LockTransaction) public lockTransactions;

    // 事件定义
    event Locked(
        uint256 indexed nonce,
        address indexed user,
        bytes32 solanaAddress,
        uint256 amount,
        uint256 timestamp
    );

    event Released(
        uint256 indexed nonce,
        address indexed user,
        uint256 amount,
        uint256 timestamp
    );

    event Refunded(
        uint256 indexed nonce,
        address indexed user,
        uint256 amount,
        uint256 timestamp
    );

    event RelayerUpdated(address indexed oldRelayer, address indexed newRelayer);
    event TimeoutUpdated(uint256 oldTimeout, uint256 newTimeout);

    /**
     * @dev 构造函数
     * @param _usdcToken USDC 代币合约地址
     * @param _relayer Relayer 地址
     */
    constructor(address _usdcToken, address _relayer) Ownable(msg.sender) {
        require(_usdcToken != address(0), "Invalid USDC address");
        require(_relayer != address(0), "Invalid relayer address");
        
        usdcToken = IERC20(_usdcToken);
        relayer = _relayer;
    }

    /**
     * @dev 锁定 USDC 代币，触发跨链转账到 Solana
     * @param amount 锁定金额
     * @param solanaAddress Solana 接收地址（32字节公钥）
     */
    function lock(uint256 amount, bytes32 solanaAddress) external nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        require(solanaAddress != bytes32(0), "Invalid Solana address");

        // 转移代币到合约
        usdcToken.safeTransferFrom(msg.sender, address(this), amount);

        // 记录锁定交易
        uint256 nonce = lockNonce++;
        lockTransactions[nonce] = LockTransaction({
            user: msg.sender,
            solanaAddress: solanaAddress,
            amount: amount,
            timestamp: block.timestamp,
            status: TransactionStatus.Pending
        });

        emit Locked(nonce, msg.sender, solanaAddress, amount, block.timestamp);
    }

    /**
     * @dev 释放 USDC 代币给用户（由 Relayer 调用，响应 Solana 的 burn 操作）
     * @param nonce Solana burn 交易的 nonce
     * @param user 接收用户地址
     * @param amount 释放金额
     */
    function release(
        uint256 nonce,
        address user,
        uint256 amount
    ) external nonReentrant {
        require(msg.sender == relayer, "Only relayer can release");
        require(user != address(0), "Invalid user address");
        require(amount > 0, "Amount must be greater than 0");
        require(!processedReleaseNonces[nonce], "Nonce already processed");

        // 标记 nonce 已处理
        processedReleaseNonces[nonce] = true;

        // 释放代币给用户
        usdcToken.safeTransfer(user, amount);

        emit Released(nonce, user, amount, block.timestamp);
    }

    /**
     * @dev 用户退款（当 lock 操作超时后，用户可以取回锁定的代币）
     * @param nonce 锁定交易的 nonce
     */
    function refund(uint256 nonce) external nonReentrant {
        LockTransaction storage txn = lockTransactions[nonce];
        
        require(txn.user == msg.sender, "Not transaction owner");
        require(txn.status == TransactionStatus.Pending, "Transaction not pending");
        require(
            block.timestamp >= txn.timestamp + timeoutDuration,
            "Timeout not reached"
        );

        // 更新状态为已退款
        txn.status = TransactionStatus.Refunded;

        // 退还代币给用户
        usdcToken.safeTransfer(msg.sender, txn.amount);

        emit Refunded(nonce, msg.sender, txn.amount, block.timestamp);
    }

    /**
     * @dev Relayer 标记 lock 交易已完成（mint 成功后调用）
     * @param nonce 锁定交易的 nonce
     */
    function completeLock(uint256 nonce) external {
        require(msg.sender == relayer, "Only relayer can complete");
        
        LockTransaction storage txn = lockTransactions[nonce];
        require(txn.status == TransactionStatus.Pending, "Transaction not pending");
        
        txn.status = TransactionStatus.Completed;
    }

    /**
     * @dev 查询锁定交易状态
     * @param nonce 交易 nonce
     */
    function getLockTransactionStatus(uint256 nonce) external view returns (TransactionStatus) {
        return lockTransactions[nonce].status;
    }

    /**
     * @dev 查询释放交易是否已处理
     * @param nonce 交易 nonce
     */
    function isReleaseProcessed(uint256 nonce) external view returns (bool) {
        return processedReleaseNonces[nonce];
    }

    /**
     * @dev 更新 Relayer 地址（仅 Owner）
     */
    function updateRelayer(address newRelayer) external onlyOwner {
        require(newRelayer != address(0), "Invalid relayer address");
        address oldRelayer = relayer;
        relayer = newRelayer;
        emit RelayerUpdated(oldRelayer, newRelayer);
    }

    /**
     * @dev 更新超时时间（仅 Owner）
     */
    function updateTimeout(uint256 newTimeout) external onlyOwner {
        require(newTimeout > 0, "Timeout must be greater than 0");
        uint256 oldTimeout = timeoutDuration;
        timeoutDuration = newTimeout;
        emit TimeoutUpdated(oldTimeout, newTimeout);
    }

    /**
     * @dev 获取合约中锁定的总代币数量
     */
    function getTotalLocked() external view returns (uint256) {
        return usdcToken.balanceOf(address(this));
    }
}
