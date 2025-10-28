#!/usr/bin/env node

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

console.log('Generating test keypairs for bridge...\n');

// 1. 生成 EVM 测试私钥
const evmWallet = ethers.Wallet.createRandom();
console.log('✅ EVM Keypair Generated:');
console.log('   Address:', evmWallet.address);
console.log('   Private Key:', evmWallet.privateKey);
console.log('');

// 2. 生成 Solana 测试密钥对
const { Keypair } = require('@solana/web3.js');
const solanaKeypair = Keypair.generate();
console.log('✅ Solana Keypair Generated:');
console.log('   Public Key:', solanaKeypair.publicKey.toBase58());
console.log('   Secret Key (first 32 bytes):', `[${solanaKeypair.secretKey.slice(0, 32).join(', ')}...]`);
console.log('');

// 3. 保存 Solana 密钥到文件
const solanaKeyDir = path.join(process.env.HOME || '/root', '.config', 'solana');
const solanaKeyPath = path.join(solanaKeyDir, 'id.json');

// 确保目录存在
if (!fs.existsSync(solanaKeyDir)) {
  fs.mkdirSync(solanaKeyDir, { recursive: true });
}

// 保存为 JSON 数组格式
fs.writeFileSync(solanaKeyPath, JSON.stringify(Array.from(solanaKeypair.secretKey)));
console.log('✅ Solana keypair saved to:', solanaKeyPath);
console.log('');

// 4. 更新 .env 文件
const envPath = path.join(__dirname, '../.env');
const envExamplePath = path.join(__dirname, '../.env.example');

let envContent = '';

// 如果 .env 不存在，从 .env.example 复制
if (!fs.existsSync(envPath) && fs.existsSync(envExamplePath)) {
  envContent = fs.readFileSync(envExamplePath, 'utf-8');
  console.log('✅ Copied .env.example to .env');
} else if (fs.existsSync(envPath)) {
  envContent = fs.readFileSync(envPath, 'utf-8');
  console.log('✅ Updating existing .env');
} else {
  // 创建新的 .env 文件
  envContent = `# EVM Configuration
EVM_RPC_URL=http://localhost:8545
EVM_PRIVATE_KEY=

# Solana Configuration  
SOLANA_RPC_URL=http://localhost:8899
SOLANA_WALLET_PATH=~/.config/solana/id.json

# Relayer Configuration
RELAYER_EVM_PRIVATE_KEY=

# Contract Addresses (to be filled after deployment)
EVM_BRIDGE_ADDRESS=
MOCK_USDC_ADDRESS=
SOLANA_BRIDGE_PROGRAM_ID=
SOLANA_MINT_ADDRESS=
`;
  console.log('✅ Created new .env file');
}

// 更新环境变量
const updateEnv = (content, key, value) => {
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(content)) {
    return content.replace(regex, `${key}=${value}`);
  } else {
    return content + `\n${key}=${value}`;
  }
};

envContent = updateEnv(envContent, 'EVM_PRIVATE_KEY', evmWallet.privateKey);
envContent = updateEnv(envContent, 'RELAYER_EVM_PRIVATE_KEY', evmWallet.privateKey);
envContent = updateEnv(envContent, 'SOLANA_WALLET_PATH', solanaKeyPath);

// 保存 .env 文件
fs.writeFileSync(envPath, envContent);
console.log('✅ Updated .env file with new keypairs');
console.log('');

console.log('==========================================');
console.log('  Setup Complete!');
console.log('==========================================');
console.log('');
console.log('Next steps:');
console.log('1. Start Hardhat node: npx hardhat node');
console.log('2. Start Solana validator: solana-test-validator');
console.log('3. Deploy contracts: npm run deploy:all');
console.log('4. Start relayer: cd relayer && npm run dev');
console.log('');
console.log('⚠️  IMPORTANT: These are test keys only!');
console.log('   Never use these keys on mainnet or with real funds.');
console.log('');
