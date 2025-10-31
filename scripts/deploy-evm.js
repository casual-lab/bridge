const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("Starting EVM contracts deployment...");
  
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", (await hre.ethers.provider.getBalance(deployer.address)).toString());

  // 1. 部署 MockUSDC
  console.log("\n1. Deploying MockUSDC...");
  const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
  const mockUSDC = await MockUSDC.deploy("Mock USDC", "USDC", 6);
  await mockUSDC.waitForDeployment();
  const usdcAddress = await mockUSDC.getAddress();
  console.log("MockUSDC deployed to:", usdcAddress);

  // 2. 给部署者铸造一些 USDC 用于测试
  console.log("\n2. Minting USDC for testing...");
  const mintAmount = hre.ethers.parseUnits("1000000", 6); // 100万 USDC
  const mintTx = await mockUSDC.mint(deployer.address, mintAmount);
  await mintTx.wait();
  console.log("Minted", hre.ethers.formatUnits(mintAmount, 6), "USDC to", deployer.address);

  // 3. 部署 EVMBridge
  console.log("\n3. Deploying EVMBridge...");
  const relayerAddress = deployer.address; // 在测试环境中，使用同一个地址作为 relayer
  const EVMBridge = await hre.ethers.getContractFactory("EVMBridge");
  const evmBridge = await EVMBridge.deploy(usdcAddress, relayerAddress);
  await evmBridge.waitForDeployment();
  const bridgeAddress = await evmBridge.getAddress();
  console.log("EVMBridge deployed to:", bridgeAddress);
  console.log("Relayer address:", relayerAddress);

  // 4. 零资金池设计 - 不预存 USDC
  console.log("\n4. Bridge initialized with zero liquidity pool");
  console.log("   Note: Solana→EVM requires prior EVM→Solana locks");

  // 5. 保存部署信息到 .env 文件
  console.log("\n5. Saving deployment info...");
  const envPath = path.join(__dirname, "../.env");
  let envContent = "";
  
  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, "utf-8");
  }
  
  // 更新或添加合约地址
  const updateEnv = (content, key, value) => {
    const regex = new RegExp(`^${key}=.*$`, "m");
    if (regex.test(content)) {
      return content.replace(regex, `${key}=${value}`);
    } else {
      return content + `\n${key}=${value}`;
    }
  };
  
  envContent = updateEnv(envContent, "EVM_BRIDGE_ADDRESS", bridgeAddress);
  envContent = updateEnv(envContent, "MOCK_USDC_ADDRESS", usdcAddress);
  
  fs.writeFileSync(envPath, envContent);
  console.log("Deployment info saved to .env");

  // 6. 生成部署摘要
  const deploymentSummary = {
    network: hre.network.name,
    deployer: deployer.address,
    contracts: {
      mockUSDC: {
        address: usdcAddress,
        name: "Mock USDC",
        symbol: "USDC",
        decimals: 6,
      },
      evmBridge: {
        address: bridgeAddress,
        relayer: relayerAddress,
        timeout: 60,
      },
    },
    timestamp: new Date().toISOString(),
  };

  const summaryPath = path.join(__dirname, "../deployments/evm-deployment.json");
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  fs.writeFileSync(summaryPath, JSON.stringify(deploymentSummary, null, 2));
  console.log("\nDeployment summary saved to deployments/evm-deployment.json");

  console.log("\n============== Deployment Summary ==============");
  console.log("MockUSDC:", usdcAddress);
  console.log("EVMBridge:", bridgeAddress);
  console.log("Relayer:", relayerAddress);
  console.log("================================================\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
