import { Connection } from '@solana/web3.js';

const conn = new Connection('http://localhost:8899');
const sig = '3CCqBg42XU1yV1NJ4snAzv4wnTan8vCAw7R9cdWDJGMVUzRVkxHZYeDmwtT6w4daYGZQMfFcLy8kBDJFoyaGHccP';

conn.getTransaction(sig, { 
  commitment: 'confirmed',
  maxSupportedTransactionVersion: 0 
}).then(tx => {
  if (tx?.meta?.logMessages) {
    console.log('=== Transaction Logs ===\n');
    tx.meta.logMessages.forEach((log, i) => console.log(`[${i}] ${log}`));
    
    const hasBurnEvent = tx.meta.logMessages.some(l => l.includes('Program data:'));
    console.log('\n Has Program data (event):', hasBurnEvent);
  } else {
    console.log('No transaction found');
  }
});
