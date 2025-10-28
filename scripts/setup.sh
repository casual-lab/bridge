#!/bin/bash

echo "======================================"
echo "  Cross-Chain Bridge Setup Script"
echo "======================================"
echo ""

# 检查依赖
check_dependencies() {
  echo "Checking dependencies..."
  
  if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed"
    exit 1
  fi
  
  if ! command -v solana &> /dev/null; then
    echo "Error: Solana CLI is not installed"
    exit 1
  fi
  
  if ! command -v anchor &> /dev/null; then
    echo "Error: Anchor CLI is not installed"
    exit 1
  fi
  
  echo "✓ All dependencies found"
  echo ""
}

# 启动 Hardhat 本地节点
start_hardhat() {
  echo "Starting Hardhat local node..."
  
  # 检查是否已经在运行
  if lsof -Pi :8545 -sTCP:LISTEN -t >/dev/null ; then
    echo "✓ Hardhat node already running on port 8545"
  else
    echo "Starting new Hardhat node..."
    npx hardhat node > logs/hardhat.log 2>&1 &
    HARDHAT_PID=$!
    echo $HARDHAT_PID > .pids/hardhat.pid
    sleep 3
    echo "✓ Hardhat node started (PID: $HARDHAT_PID)"
  fi
  echo ""
}

# 启动 Solana test validator
start_solana_validator() {
  echo "Starting Solana test validator..."
  
  # 检查是否已经在运行
  if solana-test-validator --version &> /dev/null && lsof -Pi :8899 -sTCP:LISTEN -t >/dev/null ; then
    echo "✓ Solana validator already running on port 8899"
  else
    echo "Starting new Solana validator..."
    solana-test-validator --reset > logs/solana-validator.log 2>&1 &
    SOLANA_PID=$!
    echo $SOLANA_PID > .pids/solana.pid
    sleep 5
    echo "✓ Solana validator started (PID: $SOLANA_PID)"
  fi
  
  # 配置 Solana CLI
  solana config set --url http://localhost:8899
  echo ""
}

# 安装依赖
install_dependencies() {
  echo "Installing Node.js dependencies..."
  
  if [ ! -d "node_modules" ]; then
    npm install
  fi
  
  if [ ! -d "relayer/node_modules" ]; then
    cd relayer && npm install && cd ..
  fi
  
  echo "✓ Dependencies installed"
  echo ""
}

# 编译合约
compile_contracts() {
  echo "Compiling contracts..."
  
  # 编译 EVM 合约
  echo "Compiling EVM contracts..."
  npx hardhat compile
  
  # 编译 Solana 程序
  echo "Compiling Solana program..."
  anchor build
  
  echo "✓ Contracts compiled"
  echo ""
}

# 部署合约
deploy_contracts() {
  echo "Deploying contracts..."
  
  # 部署 EVM 合约
  echo "Deploying EVM contracts..."
  npx hardhat run scripts/deploy-evm.js --network localhost
  
  # 部署 Solana 程序
  echo "Deploying Solana program..."
  anchor deploy
  
  # 初始化 Solana 程序
  echo "Initializing Solana program..."
  npx ts-node scripts/deploy-solana.ts
  
  echo "✓ Contracts deployed"
  echo ""
}

# 创建必要的目录
create_directories() {
  mkdir -p logs
  mkdir -p .pids
  mkdir -p deployments
}

# 主流程
main() {
  create_directories
  check_dependencies
  install_dependencies
  compile_contracts
  start_hardhat
  start_solana_validator
  deploy_contracts
  
  echo "======================================"
  echo "  Setup Complete!"
  echo "======================================"
  echo ""
  echo "Next steps:"
  echo "1. Start the relayer: cd relayer && npm run dev"
  echo "2. Run demo: npm run demo:evm-to-solana"
  echo ""
  echo "To stop services:"
  echo "  ./scripts/stop-services.sh"
  echo ""
}

main
