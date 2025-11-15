// server.js - ArcPay Backend Server
import express from 'express';
import cors from 'cors';
import { ethers } from 'ethers';
import cron from 'node-cron';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import { createCircleUser, createUserWallet, getUserWallets, initializeUser } from './circle-service.js';

dotenv.config();

const app = express();
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:3002',
    'https://arcpay-dashboard-jzy1u1m23-jxs-projects-a427b0e8.vercel.app',
    'https://arcpay-admin-dashboard.vercel.app',
  ],
  credentials: true
}));
app.use(express.json());

// ============= CONFIGURATION =============
const PORT = process.env.PORT || 3001;
const RPC_URL = process.env.RPC_URL || 'https://rpc.testnet.arc.network';
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS || '0x352B36616Fd3c13f663d372762A4671179703cB4';

// ============= ABIs =============
const FACTORY_ABI = [
  {
    "inputs": [],
    "name": "getAllPayrolls",
    "outputs": [{
      "components": [
        {"internalType": "address", "name": "payrollContract", "type": "address"},
        {"internalType": "address", "name": "owner", "type": "address"},
        {"internalType": "uint256", "name": "createdAt", "type": "uint256"},
        {"internalType": "string", "name": "companyName", "type": "string"}
      ],
      "internalType": "struct PayrollFactoryV4.PayrollInfo[]",
      "name": "",
      "type": "tuple[]"
    }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "address", "name": "user", "type": "address"}],
    "name": "getUserPayrollsInfo",
    "outputs": [{
      "components": [
        {"internalType": "address", "name": "payrollContract", "type": "address"},
        {"internalType": "address", "name": "owner", "type": "address"},
        {"internalType": "uint256", "name": "createdAt", "type": "uint256"},
        {"internalType": "string", "name": "companyName", "type": "string"}
      ],
      "internalType": "struct PayrollFactoryV4.PayrollInfo[]",
      "name": "",
      "type": "tuple[]"
    }],
    "stateMutability": "view",
    "type": "function"
  }
];

const PAYROLL_ABI = [
  {
    "inputs": [],
    "name": "getDuePayments",
    "outputs": [{"internalType": "address[]", "name": "", "type": "address[]"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "processDuePayments",
    "outputs": [{"internalType": "uint256", "name": "processed", "type": "uint256"}],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "viewEmployees",
    "outputs": [{"internalType": "address[]", "name": "", "type": "address[]"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"internalType": "address", "name": "emp", "type": "address"}],
    "name": "getEmployee",
    "outputs": [
      {"internalType": "uint256", "name": "salary", "type": "uint256"},
      {"internalType": "string", "name": "name", "type": "string"},
      {"internalType": "string", "name": "role", "type": "string"},
      {"internalType": "bool", "name": "isActive", "type": "bool"},
      {"internalType": "bool", "name": "hasOptedIn", "type": "bool"},
      {"internalType": "uint256", "name": "hireDate", "type": "uint256"},
      {"internalType": "uint256", "name": "totalPaid", "type": "uint256"}
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getContractBalance",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "owner",
    "outputs": [{"internalType": "address", "name": "", "type": "address"}],
    "stateMutability": "view",
    "type": "function"
  }
];

// ============= WEB3 SETUP =============
const provider = new ethers.JsonRpcProvider(RPC_URL);
let wallet;
let factoryContract;

if (PRIVATE_KEY) {
  wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  factoryContract = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, wallet);
  console.log('✅ Bot wallet initialized:', wallet.address);
} else {
  console.warn('⚠️  No PRIVATE_KEY found. Automated payments disabled.');
}

// ============= IN-MEMORY STORAGE =============
const paymentLogs = [];
const processedPayments = new Set();

// ============= HELPER FUNCTIONS =============
function formatUnits(value, decimals = 6) {
  return ethers.formatUnits(value, decimals);
}

function logPayment(payrollAddress, status, message, txHash = null) {
  const log = {
    timestamp: new Date().toISOString(),
    payrollAddress,
    status,
    message,
    txHash
  };
  paymentLogs.push(log);
  console.log(`[${log.timestamp}] ${status}: ${message}`);
  
  // Keep only last 1000 logs
  if (paymentLogs.length > 1000) {
    paymentLogs.shift();
  }
}

async function getAllPayrolls() {
  try {
    const factoryReadOnly = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);
    
    try {
      const allPayrollsInfo = await factoryReadOnly.getAllPayrolls();
      
      // Extract just the payroll contract addresses from the PayrollInfo structs
      const payrollAddresses = allPayrollsInfo.map(info => info.payrollContract);
      
      console.log(`Found ${payrollAddresses.length} payroll contracts`);
      return payrollAddresses;
    } catch (error) {
      console.log('getAllPayrolls error:', error.message);
      return [];
    }
  } catch (error) {
    console.error('Error fetching payrolls:', error.message);
    return [];
  }
}

async function checkAndProcessPayroll(payrollAddress) {
  try {
    const payrollContract = new ethers.Contract(payrollAddress, PAYROLL_ABI, wallet);
    
    // Check for due payments
    const duePayments = await payrollContract.getDuePayments();
    
    if (duePayments.length === 0) {
      return { processed: 0, dueCount: 0 };
    }

    // Check contract balance
    const balance = await payrollContract.getContractBalance();
    
    if (balance === 0n) {
      logPayment(payrollAddress, 'SKIPPED', `No balance (${duePayments.length} due payments)`);
      return { processed: 0, dueCount: duePayments.length, reason: 'insufficient_balance' };
    }

    // Get payroll owner
    const owner = await payrollContract.owner();

    // Create unique payment ID to prevent duplicates
    const paymentId = `${payrollAddress}-${Date.now()}`;
    
    if (processedPayments.has(paymentId)) {
      return { processed: 0, dueCount: duePayments.length, reason: 'already_processed' };
    }

    logPayment(payrollAddress, 'PROCESSING', `${duePayments.length} due payments found`);

    // Process due payments
    const tx = await payrollContract.processDuePayments({
      gasLimit: 500000 * duePayments.length // Dynamic gas limit
    });
    
    const receipt = await tx.wait();
    
    processedPayments.add(paymentId);
    
    logPayment(
      payrollAddress, 
      'SUCCESS', 
      `Processed ${duePayments.length} payments for owner ${owner}`,
      receipt.hash
    );

    // Clean up old processed payments (keep last 1000)
    if (processedPayments.size > 1000) {
      const toDelete = Array.from(processedPayments).slice(0, processedPayments.size - 1000);
      toDelete.forEach(id => processedPayments.delete(id));
    }

    return { 
      processed: duePayments.length, 
      dueCount: duePayments.length,
      txHash: receipt.hash,
      owner 
    };

  } catch (error) {
    logPayment(payrollAddress, 'ERROR', error.message);
    return { processed: 0, dueCount: 0, error: error.message };
  }
}

async function processAllPayrolls() {
  if (!wallet) {
    console.log('⚠️  Automated payments disabled (no wallet configured)');
    return { totalProcessed: 0, totalDue: 0, payrolls: [] };
  }

  console.log('\n🔄 Starting automated payment check...');
  
  const payrolls = await getAllPayrolls();
  
  if (payrolls.length === 0) {
    console.log('No payrolls found');
    return { totalProcessed: 0, totalDue: 0, payrolls: [] };
  }

  console.log(`Found ${payrolls.length} payrolls to check`);

  const results = [];
  let totalProcessed = 0;
  let totalDue = 0;

  for (const payrollAddress of payrolls) {
    const result = await checkAndProcessPayroll(payrollAddress);
    results.push({
      address: payrollAddress,
      ...result
    });
    totalProcessed += result.processed;
    totalDue += result.dueCount;
    
    // Small delay between processing to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`✅ Completed: ${totalProcessed}/${totalDue} payments processed\n`);

  return { totalProcessed, totalDue, payrolls: results };
}

// ============= CRON JOBS =============
// Run every hour
cron.schedule('0 * * * *', async () => {
  console.log('⏰ Hourly payment check triggered');
  await processAllPayrolls();
});

// Run every day at 9 AM
cron.schedule('0 9 * * *', async () => {
  console.log('⏰ Daily payment check triggered (9 AM)');
  await processAllPayrolls();
});

// Run every Monday at 8 AM
cron.schedule('0 8 * * 1', async () => {
  console.log('⏰ Weekly payment check triggered (Monday 8 AM)');
  await processAllPayrolls();
});

// ============= API ROUTES =============

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    botWallet: wallet ? wallet.address : 'Not configured',
    automatedPayments: !!wallet
  });
});

// Get bot wallet info
app.get('/api/bot/info', async (req, res) => {
  try {
    if (!wallet) {
      return res.status(503).json({ error: 'Bot wallet not configured' });
    }

    const balance = await provider.getBalance(wallet.address);
    
    res.json({
      address: wallet.address,
      balance: ethers.formatEther(balance),
      network: 'Arc Testnet'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all payrolls
app.get('/api/payrolls', async (req, res) => {
  try {
    const payrolls = await getAllPayrolls();
    
    const payrollDetails = await Promise.all(
      payrolls.map(async (address) => {
        try {
          const contract = new ethers.Contract(address, PAYROLL_ABI, provider);
          const [balance, owner, duePayments] = await Promise.all([
            contract.getContractBalance(),
            contract.owner(),
            contract.getDuePayments()
          ]);

          return {
            address,
            owner,
            balance: formatUnits(balance),
            duePaymentsCount: duePayments.length
          };
        } catch (error) {
          return {
            address,
            error: error.message
          };
        }
      })
    );

    res.json({
      count: payrolls.length,
      payrolls: payrollDetails
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get specific payroll details
app.get('/api/payroll/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const contract = new ethers.Contract(address, PAYROLL_ABI, provider);

    const [balance, owner, employees, duePayments] = await Promise.all([
      contract.getContractBalance(),
      contract.owner(),
      contract.viewEmployees(),
      contract.getDuePayments()
    ]);

    const employeeDetails = await Promise.all(
      employees.map(async (empAddress) => {
        const empData = await contract.getEmployee(empAddress);
        return {
          address: empAddress,
          name: empData[1],
          role: empData[2],
          salary: formatUnits(empData[0]),
          isActive: empData[3],
          totalPaid: formatUnits(empData[6])
        };
      })
    );

    res.json({
      address,
      owner,
      balance: formatUnits(balance),
      employees: employeeDetails,
      duePayments: duePayments.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Manual trigger for payment processing
app.post('/api/process/all', async (req, res) => {
  try {
    if (!wallet) {
      return res.status(503).json({ error: 'Automated payments not configured' });
    }

    const result = await processAllPayrolls();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Process specific payroll
app.post('/api/process/:address', async (req, res) => {
  try {
    if (!wallet) {
      return res.status(503).json({ error: 'Automated payments not configured' });
    }

    const { address } = req.params;
    const result = await checkAndProcessPayroll(address);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get payment logs
app.get('/api/logs', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const logs = paymentLogs.slice(-limit).reverse();
  res.json({ logs, count: logs.length });
});

// Get statistics
app.get('/api/stats', (req, res) => {
  const successCount = paymentLogs.filter(log => log.status === 'SUCCESS').length;
  const errorCount = paymentLogs.filter(log => log.status === 'ERROR').length;
  const skippedCount = paymentLogs.filter(log => log.status === 'SKIPPED').length;

  res.json({
    totalLogs: paymentLogs.length,
    successful: successCount,
    errors: errorCount,
    skipped: skippedCount,
    lastCheck: paymentLogs.length > 0 ? paymentLogs[paymentLogs.length - 1].timestamp : null
  });
});

// ============= CIRCLE WALLET ROUTES =============

app.post('/api/circle/create-user', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email required' });
    }

    const userData = await createCircleUser(email);
    
    res.json({
      success: true,
      userId: userData.circleUserId,
      userToken: userData.token,
      internalUserId: userData.internalUserId,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/circle/create-wallet', async (req, res) => {
  try {
    const { userId, blockchain } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    const walletData = await createUserWallet(userId, blockchain);
    
    res.json({
      success: true,
      challengeId: walletData.challengeId,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/circle/wallets/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const wallets = await getUserWallets(userId);
    
    res.json({
      success: true,
      wallets,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// Initialize user (set PIN) - ADD THIS ROUTE
app.post('/api/circle/initialize-user', async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    // Import this function from circle-service.js
    const { initializeUser } = await import('./circle-service.js');
    const initData = await initializeUser(userId);
    
    res.json({
      success: true,
      challengeId: initData.challengeId,
    });
  } catch (error) {
    console.error('Initialize user error:', error);
    res.status(500).json({ error: error.message });
  }
});
// ============= START SERVER =============
app.listen(PORT, () => {
  console.log(`\n🚀 ArcPay Backend Server running on port ${PORT}`);
  console.log(`📡 RPC: ${RPC_URL}`);
  console.log(`🏭 Factory: ${FACTORY_ADDRESS}`);
  console.log(`\nEndpoints:`);
  console.log(`  GET  /health`);
  console.log(`  GET  /api/bot/info`);
  console.log(`  GET  /api/payrolls`);
  console.log(`  GET  /api/payroll/:address`);
  console.log(`  POST /api/process/all`);
  console.log(`  POST /api/process/:address`);
  console.log(`  GET  /api/logs`);
  console.log(`  GET  /api/stats`);
  console.log(`\n⏰ Automated payments scheduled:`);
  console.log(`  - Every hour (0 * * * *)`);
  console.log(`  - Daily at 9 AM (0 9 * * *)`);
  console.log(`  - Weekly Monday 8 AM (0 8 * * 1)`);
  console.log(`\n`);
});
