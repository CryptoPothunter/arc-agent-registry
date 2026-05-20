const hre = require("hardhat");
async function main() {
  const [deployer] = await hre.ethers.getSigners();
  
  const addresses = {
    ReputationOracle: "0xF4809D66cE01BFe3147f4B294Aa6ED29355D8359",
    AgentRegistry: "0xE466F7721ed4966d7c594ED49Be867F7c597275F",
    TaskEscrow: "0xB39d4d0f9812A8F183085e31bb13D2Bc5568d253",
    AgentReputationMarket: "0x64FfE155fa71669cFFE5C5a9faB3Ad67480f0b74",
    AgentPipeline: "0xf691f616BF097DA02B9D64d5C94Fda0ea0DAD7A7",
    AgentFund: "0x4fde8BEb805588ae337DeD160559850757Eca737"
  };
  
  // Setup remaining trust relationships
  const repOracle = await hre.ethers.getContractAt("ReputationOracle", addresses.ReputationOracle);
  let tx = await repOracle.setTrusted(deployer.address, true);
  await tx.wait();
  console.log("ReputationOracle: Deployer set as trusted");
  
  tx = await repOracle.setTrusted(addresses.TaskEscrow, true);
  await tx.wait();
  console.log("ReputationOracle: TaskEscrow set as trusted");
  
  const repMarket = await hre.ethers.getContractAt("AgentReputationMarket", addresses.AgentReputationMarket);
  tx = await repMarket.setEscrow(addresses.TaskEscrow);
  await tx.wait();
  console.log("AgentReputationMarket: TaskEscrow set as escrow");
  
  const agentFund = await hre.ethers.getContractAt("AgentFund", addresses.AgentFund);
  tx = await agentFund.setEscrow(addresses.TaskEscrow);
  await tx.wait();
  console.log("AgentFund: TaskEscrow set as escrow");
  
  // Write deployed-addresses.json
  const fs = require("fs");
  const path = require("path");
  const data = {
    network: "arc-testnet",
    chainId: 5042002,
    deployer: deployer.address,
    contracts: {
      USDC: "0x3600000000000000000000000000000000000000",
      ...addresses
    },
    arcNativeContracts: {
      ERC8004_IdentityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
      ERC8004_ReputationRegistry: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
      ERC8004_ValidationRegistry: "0x8004Cb1BF31DAf7788923b405b754f57acEB4272",
      ERC8183_AgenticCommerce: "0x0747EEf0706327138c69792bF28Cd525089e4583",
    },
    arcTestnetInfo: {
      rpc: "https://rpc.testnet.arc.network",
      wss: "wss://rpc.testnet.arc.network",
      explorer: "https://testnet.arcscan.app",
      faucet: "https://faucet.circle.com",
      currencySymbol: "USDC",
    },
    deployedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(__dirname, "..", "deployed-addresses.json"), JSON.stringify(data, null, 2));
  
  // Update .env
  const envPath = path.join(__dirname, "..", ".env");
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
  console.log("\nAll trust relationships set. Addresses saved.");
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
