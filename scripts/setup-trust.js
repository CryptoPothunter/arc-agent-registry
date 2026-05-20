require("dotenv").config();
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  // Read addresses from deployed-addresses.json or environment variables
  const addrPath = path.join(__dirname, "..", "deployed-addresses.json");
  let addresses;

  if (fs.existsSync(addrPath)) {
    const data = JSON.parse(fs.readFileSync(addrPath, "utf8"));
    addresses = {
      ReputationOracle: data.contracts.ReputationOracle,
      AgentRegistry: data.contracts.AgentRegistry,
      TaskEscrow: data.contracts.TaskEscrow,
      AgentReputationMarket: data.contracts.AgentReputationMarket,
      AgentPipeline: data.contracts.AgentPipeline,
      AgentFund: data.contracts.AgentFund,
    };
    console.log("Loaded addresses from deployed-addresses.json");
  } else {
    // Fallback to environment variables
    addresses = {
      ReputationOracle: process.env.REPUTATION_CONTRACT,
      AgentRegistry: process.env.REGISTRY_CONTRACT,
      TaskEscrow: process.env.ESCROW_CONTRACT,
      AgentReputationMarket: process.env.REPUTATION_MARKET_CONTRACT,
      AgentPipeline: process.env.PIPELINE_CONTRACT,
      AgentFund: process.env.AGENT_FUND_CONTRACT,
    };
    console.log("Loaded addresses from environment variables");
  }

  // Validate all addresses are present
  for (const [name, addr] of Object.entries(addresses)) {
    if (!addr) {
      throw new Error(`Missing address for ${name}. Deploy contracts first or set env vars.`);
    }
  }

  console.log(`\nSetting up trust relationships on ${hre.network.name}...`);
  console.log(`Deployer: ${deployer.address}\n`);

  // 1. AgentRegistry: trust TaskEscrow
  const registry = await hre.ethers.getContractAt("AgentRegistry", addresses.AgentRegistry);
  let tx = await registry.setTrustedContract(addresses.TaskEscrow, true);
  await tx.wait();
  console.log("AgentRegistry: TaskEscrow set as trusted");

  // 2. ReputationOracle: trust Deployer and TaskEscrow
  const repOracle = await hre.ethers.getContractAt("ReputationOracle", addresses.ReputationOracle);
  tx = await repOracle.setTrusted(deployer.address, true);
  await tx.wait();
  console.log("ReputationOracle: Deployer set as trusted");

  tx = await repOracle.setTrusted(addresses.TaskEscrow, true);
  await tx.wait();
  console.log("ReputationOracle: TaskEscrow set as trusted");

  // 3. AgentReputationMarket: set TaskEscrow as escrow
  const repMarket = await hre.ethers.getContractAt("AgentReputationMarket", addresses.AgentReputationMarket);
  tx = await repMarket.setEscrow(addresses.TaskEscrow);
  await tx.wait();
  console.log("AgentReputationMarket: TaskEscrow set as escrow");

  // 4. AgentFund: set TaskEscrow as escrow
  const agentFund = await hre.ethers.getContractAt("AgentFund", addresses.AgentFund);
  tx = await agentFund.setEscrow(addresses.TaskEscrow);
  await tx.wait();
  console.log("AgentFund: TaskEscrow set as escrow");

  // Update deployed-addresses.json with metadata
  const data = {
    network: hre.network.name,
    chainId: (await hre.ethers.provider.getNetwork()).chainId.toString(),
    deployer: deployer.address,
    contracts: {
      USDC: process.env.USDC_ADDRESS || "0x3600000000000000000000000000000000000000",
      ...addresses,
    },
    arcNativeContracts: {
      ERC8004_IdentityRegistry: process.env.ERC8004_IDENTITY_REGISTRY || "0x8004A818BFB912233c491871b3d84c89A494BD9e",
      ERC8004_ReputationRegistry: process.env.ERC8004_REPUTATION_REGISTRY || "0x8004B663056A597Dffe9eCcC1965A193B7388713",
      ERC8004_ValidationRegistry: process.env.ERC8004_VALIDATION_REGISTRY || "0x8004Cb1BF31DAf7788923b405b754f57acEB4272",
      ERC8183_AgenticCommerce: process.env.ERC8183_AGENTIC_COMMERCE || "0x0747EEf0706327138c69792bF28Cd525089e4583",
    },
    arcTestnetInfo: {
      rpc: process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network",
      wss: process.env.ARC_WSS_URL || "wss://rpc.testnet.arc.network",
      explorer: "https://testnet.arcscan.app",
      faucet: "https://faucet.circle.com",
      currencySymbol: "USDC",
    },
    deployedAt: new Date().toISOString(),
  };
  fs.writeFileSync(addrPath, JSON.stringify(data, null, 2));

  // Update .env if it exists
  const envPath = path.join(__dirname, "..", ".env");
  if (fs.existsSync(envPath)) {
    let envContent = fs.readFileSync(envPath, "utf8");
    const replacements = {
      REGISTRY_CONTRACT: addresses.AgentRegistry,
      ESCROW_CONTRACT: addresses.TaskEscrow,
      REPUTATION_CONTRACT: addresses.ReputationOracle,
      REPUTATION_MARKET_CONTRACT: addresses.AgentReputationMarket,
      PIPELINE_CONTRACT: addresses.AgentPipeline,
      AGENT_FUND_CONTRACT: addresses.AgentFund,
    };
    for (const [key, value] of Object.entries(replacements)) {
      const regex = new RegExp(`^${key}=.*$`, "m");
      if (envContent.match(regex)) {
        envContent = envContent.replace(regex, `${key}=${value}`);
      }
    }
    fs.writeFileSync(envPath, envContent);
    console.log("\n.env updated with contract addresses.");
  }

  console.log("\nAll trust relationships configured successfully.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
