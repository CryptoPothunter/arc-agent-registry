const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatUnits(balance, 6), "USDC (gas)");

  const networkName = hre.network.name;
  console.log("Network:", networkName);

  // Determine USDC address based on network
  let usdcAddress;
  if (networkName === "arcTestnet") {
    // Arc Testnet uses native USDC at this pre-deployed address
    usdcAddress = process.env.USDC_ADDRESS || "0x3600000000000000000000000000000000000000";
    console.log("\n--- Using Arc Testnet USDC ---");
    console.log("USDC address:", usdcAddress);
  } else {
    // Local / Hardhat: deploy MockUSDC
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

  // 4. Set trust relationships
  console.log("\n--- Setting trust relationships ---");

  const tx1 = await agentRegistry.setTrustedContract(taskEscrowAddress, true);
  await tx1.wait();
  console.log("AgentRegistry: TaskEscrow set as trusted contract");

  const tx2 = await reputationOracle.setTrustedCaller(deployer.address, true);
  await tx2.wait();
  console.log("ReputationOracle: Deployer set as trusted caller");

  const tx3 = await reputationOracle.setTrustedCaller(taskEscrowAddress, true);
  await tx3.wait();
  console.log("ReputationOracle: TaskEscrow set as trusted caller");

  // 5. Write deployed addresses to JSON
  const addresses = {
    network: networkName,
    chainId: networkName === "arcTestnet" ? 5042002 : 31337,
    deployer: deployer.address,
    contracts: {
      ReputationOracle: reputationOracleAddress,
      AgentRegistry: agentRegistryAddress,
      USDC: usdcAddress,
      TaskEscrow: taskEscrowAddress,
    },
    arcTestnetInfo: networkName === "arcTestnet" ? {
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
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
