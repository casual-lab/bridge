#!/bin/bash

echo "Stopping bridge services..."

# 停止 Hardhat
if [ -f ".pids/hardhat.pid" ]; then
  HARDHAT_PID=$(cat .pids/hardhat.pid)
  if ps -p $HARDHAT_PID > /dev/null; then
    kill $HARDHAT_PID
    echo "✓ Stopped Hardhat (PID: $HARDHAT_PID)"
  fi
  rm .pids/hardhat.pid
fi

# 停止 Solana validator
if [ -f ".pids/solana.pid" ]; then
  SOLANA_PID=$(cat .pids/solana.pid)
  if ps -p $SOLANA_PID > /dev/null; then
    kill $SOLANA_PID
    echo "✓ Stopped Solana validator (PID: $SOLANA_PID)"
  fi
  rm .pids/solana.pid
fi

# 也可以通过端口杀死进程
echo "Checking for remaining processes..."
lsof -ti:8545 | xargs kill -9 2>/dev/null && echo "✓ Killed process on port 8545"
lsof -ti:8899 | xargs kill -9 2>/dev/null && echo "✓ Killed process on port 8899"

echo "All services stopped"
