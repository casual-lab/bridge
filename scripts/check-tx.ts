#!/usr/bin/env ts-node

import { Connection } from '@solana/web3.js';

async function main() {
  const connection = new Connection('http://localhost:8899', 'confirmed');
  
  const signatures = [
    '4m4bDfy4w18Q9PHhdGR7KVHvX1cjkR7UnPK1KbvmmNdKCaPPUi4XtqjzitjaewtAv2n1F2cWtxAZ7J3Y8t8Y5xzr',
    '3dd12cRTjDbLu14JUbX8GpegXAdcjbwdsmPhqNodMTNKaTVfBMQ3ipGGFM4Hnyp1RbM6MDZ1aHh4KNKF9u9JQz2U'
  ];
  
  for (const sig of signatures) {
    console.log(`\n=== Signature: ${sig.substring(0, 20)}... ===`);
    
    try {
      const tx = await connection.getTransaction(sig, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
      
      if (!tx || !tx.meta) {
        console.log('❌ Transaction not found or no metadata');
        continue;
      }
      
      console.log('\n📝 Logs:');
      const logs = tx.meta.logMessages || [];
      logs.forEach((log, i) => {
        console.log(`  [${i}] ${log}`);
      });
      
      // 检查指令类型
      const hasBurn = logs.some(log => log.includes('Instruction: BurnTokens'));
      const hasMint = logs.some(log => log.includes('Instruction: MintTokens'));
      
      if (hasBurn) {
        console.log('\n🔥 This is a BURN transaction');
      } else if (hasMint) {
        console.log('\n✨ This is a MINT transaction');
      } else {
        console.log('\n❓ Unknown instruction type');
      }
      
    } catch (error: any) {
      console.log('❌ Error:', error.message);
    }
  }
}

main();
