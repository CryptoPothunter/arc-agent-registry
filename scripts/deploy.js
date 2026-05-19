const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance));

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

  // 3. Deploy MockUSDC (for testnet) or use existing USDC address
  console.log("\n--- Deploying MockUSDC ---");
  const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
  const mockUsdc = await MockUSDC.deploy();
  await mockUsdc.waitForDeployment();
  const mockUsdcAddress = await mockUsdc.getAddress();
  console.log("MockUSDC deployed to:", mockUsdcAddress);

  // 4. Deploy TaskEscrow
  console.log("\n--- Deploying TaskEscrow ---");
  const TaskEscrow = await hre.ethers.getContractFactory("TaskEscrow");
  const taskEscrow = await TaskEscrow.deploy(mockUsdcAddress, agentRegistryAddress, deployer.address);
  await taskEscrow.waitForDeployment();
  const taskEscrowAddress = await taskEscrow.getAddress();
  console.log("TaskEscrow deployed to:", taskEscrowAddress);

  // 5. Set trust relationships
  console.log("\n--- Setting trust relationships ---");

  // TaskEscrow is trusted by AgentRegistry (to call updateReputation)
  const tx1 = await agentRegistry.setTrustedContract(taskEscrowAddress, true);
  await tx1.wait();
  console.log("AgentRegistry: TaskEscrow set as trusted contract");

  // Deployer is trusted by ReputationOracle (to call submitRating)
  const tx2 = await reputationOracle.setTrustedCaller(deployer.address, true);
  await tx2.wait();
  console.log("ReputationOracle: Deployer set as trusted caller");

  // TaskEscrow is trusted by ReputationOracle
  const tx3 = await reputationOracle.setTrustedCaller(taskEscrowAddress, true);
  await tx3.wait();
  console.log("ReputationOracle: TaskEscrow set as trusted caller");

  // 6. Write deployed addresses to JSON
  const addresses = {
    network: hre.network.name,
    deployer: deployer.address,
    contracts: {
      ReputationOracle: reputationOracleAddress,
      AgentRegistry: agentRegistryAddress,
      MockUSDC: mockUsdcAddress,
      TaskEscrow: taskEscrowAddress,
    },
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
