require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

/**
 * #36: Network name changed from arcTestnet to arc-testnet (kebab-case per doc spec).
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    "arc-testnet": {
      url: process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network",
      chainId: 5042002,
      accounts:
        process.env.DEPLOYER_PRIVATE_KEY !== undefined
          ? [process.env.DEPLOYER_PRIVATE_KEY]
          : [],
      gasPrice: "auto",
    },
  },
  etherscan: {
    apiKey: {
      "arc-testnet": process.env.ARCSCAN_API_KEY || "placeholder",
    },
    customChains: [
      {
        network: "arc-testnet",
        chainNetwork: "arc-testnet",
        urls: {
          apiURL: "https://testnet.arcscan.app/api",
          browserURL: "https://testnet.arcscan.app",
        },
      },
    ],
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};
