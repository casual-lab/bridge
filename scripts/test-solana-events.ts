#!/usr/bin/env ts-node

import { Connection, PublicKey } from '@solana/web3.js';
import * as dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log('\n=== Testing Solana Event Detection ===\n');

  const connection = new Connection('http://localhost:8899', 'confirmed');
  const programId = new PublicKey(process.env.SOLANA_BRIDGE_PROGRAM_ID!);

  console.log('Program ID:', programId.toBase58());

  // 获取当前 slot
  const currentSlot = await connection.getSlot();
  console.log('Current Slot:', currentSlot);

  // 获取最近的交易签名
  console.log('\nFetching recent signatures...');
  const signatures = await connection.getSignaturesForAddress(programId, {
    limit: 20,
  });

  console.log(`Found ${signatures.length} transactions\n`);

  for (let i = 0; i < signatures.length; i++) {
    const sig = signatures[i];
    console.log(`\n[${i + 1}] Transaction:`);
    console.log('  Signature:', sig.signature);
    console.log('  Slot:', sig.slot);
    console.log('  Block Time:', sig.blockTime ? new Date(sig.blockTime * 1000).toISOString() : 'N/A');
    console.log('  Status:', sig.err ? 'Failed' : 'Success');

    // 获取交易详情
    try {
      const tx = await connection.getTransaction(sig.signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });

      if (tx && tx.meta && tx.meta.logMessages) {
        const logs = tx.meta.logMessages;
        
        // 检查是否包含 BurnTokens 指令
        const hasBurn = logs.some(log => log.includes('Instruction: BurnTokens'));
        const hasMint = logs.some(log => log.includes('Instruction: MintTokens'));
        const hasInit = logs.some(log => log.includes('Instruction: Initialize'));
        
        if (hasBurn) {
          console.log('  🔥 Type: BURN TOKENS');
          // 查找事件数据
          const eventLogs = logs.filter(log => log.includes('Program data:'));
          if (eventLogs.length > 0) {
            console.log('  📝 Event Logs:');
            eventLogs.forEach(log => console.log('    ', log));
          }
        } else if (hasMint) {
          console.log('  ✨ Type: MINT TOKENS');
        } else if (hasInit) {
          console.log('  🔧 Type: INITIALIZE');
        } else {
          console.log('  ❓ Type: OTHER');
        }
      }
    } catch (error: any) {
      console.log('  ❌ Error fetching details:', error.message);
    }
  }

  console.log('\n=== End ===\n');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
