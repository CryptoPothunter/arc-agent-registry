const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);

  // Arc native balance uses 18 decimals, ERC-20 USDC uses 6
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatUnits(balance, 18), "USDC (native gas)");

  const networkName = hre.network.name;
  console.log("Network:", networkName);

  // Determine USDC address based on network
  let usdcAddress;
  if (networkName === "arc-testnet") {
    usdcAddress = process.env.USDC_ADDRESS || "0x3600000000000000000000000000000000000000";
    console.log("\n--- Using Arc Testnet USDC ---");
    console.log("USDC address:", usdcAddress);
  } else {
    console.log("\n--- Deploying MockUSDC (local network) ---");
    const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
    const mockUsdc = await MockUSDC.deploy();
    await mockUsdc.waitForDeployment();
    usdcAddress = await mockUsdc.getAddress();
    console.log("MockUSDC deployed to:", usdcAddress);
  }

  // 1. Deploy ReputationOracle
  console.log("\n--- Deploying ReputationOracle ---");
  const ReputationOracle = await hre.ethers.getContractFactory("ReputationOracle");
  const reputationOracle = await ReputationOracle.deploy();
  await reputationOracle.waitForDeployment();
  const reputationOracleAddress = await reputationOracle.getAddress();
  console.log("ReputationOracle deployed to:", reputationOracleAddress);

  // 2. Deploy AgentRegistry
  console.log("\n--- Deploying AgentRegistry ---");
  const AgentRegistry = await hre.ethers.getContractFactory("AgentRegistry");
  const agentRegistry = await AgentRegistry.deploy();
  await agentRegistry.waitForDeployment();
  const agentRegistryAddress = await agentRegistry.getAddress();
  console.log("AgentRegistry deployed to:", agentRegistryAddress);

  // 3. Deploy TaskEscrow
  console.log("\n--- Deploying TaskEscrow ---");
  const TaskEscrow = await hre.ethers.getContractFactory("TaskEscrow");
  const taskEscrow = await TaskEscrow.deploy(usdcAddress, agentRegistryAddress, deployer.address);
  await taskEscrow.waitForDeployment();
  const taskEscrowAddress = await taskEscrow.getAddress();
  console.log("TaskEscrow deployed to:", taskEscrowAddress);

  // 4. Deploy AgentReputationMarket
  console.log("\n--- Deploying AgentReputationMarket ---");
  const AgentReputationMarket = await hre.ethers.getContractFactory("AgentReputationMarket");
  const reputationMarket = await AgentReputationMarket.deploy(usdcAddress, agentRegistryAddress);
  await reputationMarket.waitForDeployment();
  const reputationMarketAddress = await reputationMarket.getAddress();
  console.log("AgentReputationMarket deployed to:", reputationMarketAddress);

  // 5. Deploy AgentPipeline
  console.log("\n--- Deploying AgentPipeline ---");
  const AgentPipeline = await hre.ethers.getContractFactory("AgentPipeline");
  const agentPipeline = await AgentPipeline.deploy(usdcAddress, agentRegistryAddress);
  await agentPipeline.waitForDeployment();
  const agentPipelineAddress = await agentPipeline.getAddress();
  console.log("AgentPipeline deployed to:", agentPipelineAddress);

  // 6. Deploy AgentFund
  console.log("\n--- Deploying AgentFund ---");
  const AgentFund = await hre.ethers.getContractFactory("AgentFund");
  const agentFund = await AgentFund.deploy(usdcAddress, agentRegistryAddress);
  await agentFund.waitForDeployment();
  const agentFundAddress = await agentFund.getAddress();
  console.log("AgentFund deployed to:", agentFundAddress);

  // 7. Set trust relationships
  console.log("\n--- Setting trust relationships ---");

  const tx1 = await agentRegistry.setTrustedContract(taskEscrowAddress, true);
  await tx1.wait();
  console.log("AgentRegistry: TaskEscrow set as trusted contract");

  const tx2 = await reputationOracle.setTrusted(deployer.address, true);
  await tx2.wait();
  console.log("ReputationOracle: Deployer set as trusted");

  const tx3 = await reputationOracle.setTrusted(taskEscrowAddress, true);
  await tx3.wait();
  console.log("ReputationOracle: TaskEscrow set as trusted");

  // Set escrow on reputation market
  const tx4 = await reputationMarket.setEscrow(taskEscrowAddress);
  await tx4.wait();
  console.log("AgentReputationMarket: TaskEscrow set as escrow");

  // Set escrow on agent fund
  const tx5 = await agentFund.setEscrow(taskEscrowAddress);
  await tx5.wait();
  console.log("AgentFund: TaskEscrow set as escrow");

  // 8. Write deployed addresses to JSON
  const addresses = {
    network: networkName,
    chainId: networkName === "arc-testnet" ? 5042002 : 31337,
    deployer: deployer.address,
    contracts: {
      USDC: usdcAddress,
      ReputationOracle: reputationOracleAddress,
      AgentRegistry: agentRegistryAddress,
      TaskEscrow: taskEscrowAddress,
      AgentReputationMarket: reputationMarketAddress,
      AgentPipeline: agentPipelineAddress,
      AgentFund: agentFundAddress,
    },
    arcNativeContracts: {
      ERC8004_IdentityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
      ERC8004_ReputationRegistry: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
      ERC8004_ValidationRegistry: "0x8004Cb1BF31DAf7788923b405b754f57acEB4272",
      ERC8183_AgenticCommerce: "0x0747EEf0706327138c69792bF28Cd525089e4583",
    },
    arcTestnetInfo: networkName === "arc-testnet" ? {
      rpc: "https://rpc.testnet.arc.network",
      wss: "wss://rpc.testnet.arc.network",
      explorer: "https://testnet.arcscan.app",
      faucet: "https://faucet.circle.com",
      currencySymbol: "USDC",
    } : undefined,
    deployedAt: new Date().toISOString(),
  };

  const outputPath = path.join(__dirname, "..", "deployed-addresses.json");
  fs.writeFileSync(outputPath, JSON.stringify(addresses, null, 2));
  console.log("\nDeployed addresses written to:", outputPath);
  console.log(JSON.stringify(addresses, null, 2));

  // Update .env file with new contract addresses
  const envPath = path.join(__dirname, "..", ".env");
  if (fs.existsSync(envPath)) {
    let envContent = fs.readFileSync(envPath, "utf8");
    const replacements = {
      REGISTRY_CONTRACT: agentRegistryAddress,
      ESCROW_CONTRACT: taskEscrowAddress,
      REPUTATION_CONTRACT: reputationOracleAddress,
      REPUTATION_MARKET_CONTRACT: reputationMarketAddress,
      PIPELINE_CONTRACT: agentPipelineAddress,
      AGENT_FUND_CONTRACT: agentFundAddress,
    };
    for (const [key, value] of Object.entries(replacements)) {
      const regex = new RegExp(`^${key}=.*$`, "m");
      if (envContent.match(regex)) {
        envContent = envContent.replace(regex, `${key}=${value}`);
      } else {
        envContent += `\n${key}=${value}`;
      }
    }
    fs.writeFileSync(envPath, envContent);
    console.log("\n.env updated with deployed contract addresses");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
