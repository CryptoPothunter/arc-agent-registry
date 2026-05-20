/**
 * GatewayService - unified cross-chain balance and transfer operations.
 * Abstracts multi-chain wallet interactions behind a single interface.
 * Supports Arc Testnet as primary chain with CCTP cross-chain transfers.
 */

const { ethers } = require('ethers');

const SUPPORTED_CHAINS = {
  'ARC-TESTNET': {
    rpcUrl: process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network',
    chainId: 5042002,
    usdc: process.env.USDC_ADDRESS || '0x3600000000000000000000000000000000000000',
    eurc: process.env.EURC_ADDRESS || '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
    explorer: 'https://testnet.arcscan.app',
    cctpDomain: 26, // Arc Testnet CCTP domain
    tokenMessenger: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
    messageTransmitter: '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275',
    tokenMinter: '0xb43db544E2c27092c107639Ad201b3dEfAbcF192',
    gatewayWallet: process.env.GATEWAY_WALLET || '0x0077777d7EBA4688BDeF3E311b846F25870A19B9',
    gatewayMinter: process.env.GATEWAY_MINTER || '0x0022222ABE238Cc2C7Bb1f21003F0a260052475B',
  },
  'ETH-SEPOLIA': {
    rpcUrl: process.env.ETH_SEPOLIA_RPC || 'https://rpc.sepolia.org',
    chainId: 11155111,
    usdc: process.env.USDC_SEPOLIA || '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    explorer: 'https://sepolia.etherscan.io',
    cctpDomain: 0,
  },
  'AVAX-FUJI': {
    rpcUrl: process.env.AVAX_FUJI_RPC || 'https://api.avax-test.network/ext/bc/C/rpc',
    chainId: 43113,
    usdc: process.env.USDC_FUJI || '0x5425890298aed601595a70AB815c96711a31Bc65',
    explorer: 'https://testnet.snowtrace.io',
    cctpDomain: 1,
  },
  'ARB-SEPOLIA': {
    rpcUrl: process.env.ARB_SEPOLIA_RPC || 'https://sepolia-rollup.arbitrum.io/rpc',
    chainId: 421614,
    usdc: process.env.USDC_ARB_SEPOLIA || '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    explorer: 'https://sepolia.arbiscan.io',
    cctpDomain: 3,
  },
};

const ERC20_ABI = require('../abis/ERC20.json');

// CCTP MessageTransmitter ABI (subset for burn/depositForBurn)
const CCTP_TOKEN_MESSENGER_ABI = [
  'function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken) external returns (uint64 nonce)',
  'event DepositForBurn(uint64 indexed nonce, address indexed burnToken, uint256 amount, address indexed depositor, bytes32 mintRecipient, uint32 destinationDomain, bytes32 destinationTokenMessenger, bytes32 destinationCaller)',
];

// CCTP MessageTransmitter ABI for receiving messages on destination chain
const CCTP_MESSAGE_TRANSMITTER_ABI = [
  'function receiveMessage(bytes message, bytes attestation) external returns (bool success)',
  'event MessageReceived(address indexed caller, uint32 sourceDomain, uint64 indexed nonce, bytes32 sender, bytes messageBody)',
];

// Circle Attestation API
const CIRCLE_ATTESTATION_API = 'https://iris-api-sandbox.circle.com/v1/attestations';

class GatewayService {
  constructor() {
    this.providers = {};
    for (const [chain, config] of Object.entries(SUPPORTED_CHAINS)) {
      try {
        this.providers[chain] = new ethers.JsonRpcProvider(config.rpcUrl);
      } catch (err) {
        console.warn(`[Gateway] Failed to create provider for ${chain}:`, err.message);
      }
    }
  }

  /**
   * Get unified USDC balance across all supported chains for a given address.
   * @param {string} walletAddress - The wallet address to query.
   * @returns {Promise<object>} Balance breakdown by chain and total.
   */
  async getUnifiedBalance(walletAddress) {
    const balances = {};
    let total = 0n;

    const results = await Promise.allSettled(
      Object.entries(SUPPORTED_CHAINS).map(async ([chain, config]) => {
        const provider = this.providers[chain];
        if (!provider) return { chain, balance: 0n };
        const usdc = new ethers.Contract(config.usdc, ERC20_ABI, provider);
        const balance = await usdc.balanceOf(walletAddress);
        return { chain, balance };
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { chain, balance } = result.value;
        balances[chain] = ethers.formatUnits(balance, 6);
        total += balance;
      } else {
        console.warn(`[Gateway] Failed to fetch balance:`, result.reason?.message);
      }
    }

    return {
      address: walletAddress,
      balances,
      totalUSDC: ethers.formatUnits(total, 6),
    };
  }

  /**
   * Get USDC + EURC balance on Arc Testnet specifically.
   * @param {string} walletAddress
   * @returns {Promise<object>} Arc Testnet balances.
   */
  async getArcBalance(walletAddress) {
    const config = SUPPORTED_CHAINS['ARC-TESTNET'];
    const provider = this.providers['ARC-TESTNET'];
    if (!provider) throw new Error('Arc Testnet provider not available');

    const usdc = new ethers.Contract(config.usdc, ERC20_ABI, provider);
    const usdcBalance = await usdc.balanceOf(walletAddress);

    let eurcBalance = 0n;
    if (config.eurc) {
      try {
        const eurc = new ethers.Contract(config.eurc, ERC20_ABI, provider);
        eurcBalance = await eurc.balanceOf(walletAddress);
      } catch (err) {
        console.warn('[Gateway] Failed to fetch EURC balance:', err.message);
      }
    }

    return {
      address: walletAddress,
      chain: 'ARC-TESTNET',
      usdc: ethers.formatUnits(usdcBalance, 6),
      eurc: ethers.formatUnits(eurcBalance, 6),
    };
  }

  /**
   * Initiate a cross-chain USDC transfer using Circle CCTP.
   * On Arc Testnet, uses the TokenMessenger contract to burn USDC
   * and enables minting on the destination chain.
   *
   * @param {object} params - Transfer parameters.
   * @param {string} params.from - Source wallet address.
   * @param {string} params.to - Destination wallet address.
   * @param {string} params.amount - Amount in USDC (human-readable).
   * @param {string} params.sourceChain - Source chain identifier.
   * @param {string} params.destChain - Destination chain identifier.
   * @param {object} params.signer - ethers Signer instance.
   * @returns {Promise<object>} Transfer receipt.
   */
  async crossChainTransfer({ from, to, amount, sourceChain, destChain, signer }) {
    if (!SUPPORTED_CHAINS[sourceChain] || !SUPPORTED_CHAINS[destChain]) {
      throw new Error(`Unsupported chain pair: ${sourceChain} -> ${destChain}`);
    }

    if (sourceChain === destChain) {
      return this._sameChainTransfer({ from, to, amount, chain: sourceChain, signer });
    }

    return this._cctpTransfer({ from, to, amount, sourceChain, destChain, signer });
  }

  /**
   * Same-chain USDC transfer via ERC-20 transfer.
   * @private
   */
  async _sameChainTransfer({ from, to, amount, chain, signer }) {
    const config = SUPPORTED_CHAINS[chain];
    const usdc = new ethers.Contract(config.usdc, ERC20_ABI, signer);
    const amountWei = ethers.parseUnits(amount, 6);

    const tx = await usdc.transfer(to, amountWei);
    const receipt = await tx.wait();

    return {
      type: 'same-chain',
      status: 'completed',
      txHash: receipt.hash,
      from,
      to,
      amount,
      chain,
      explorerUrl: `${config.explorer}/tx/${receipt.hash}`,
    };
  }

  /**
   * Cross-chain USDC transfer via Circle CCTP (burn & mint).
   * Burns USDC on source chain; destination chain minting requires
   * attestation from Circle's attestation service.
   * @private
   */
  async _cctpTransfer({ from, to, amount, sourceChain, destChain, signer }) {
    const sourceConfig = SUPPORTED_CHAINS[sourceChain];
    const destConfig = SUPPORTED_CHAINS[destChain];
    const amountWei = ethers.parseUnits(amount, 6);

    // Convert destination address to bytes32 format for CCTP
    const mintRecipient = ethers.zeroPadValue(to, 32);

    // Step 1: Approve TokenMessenger to spend USDC
    const usdc = new ethers.Contract(sourceConfig.usdc, ERC20_ABI, signer);
    const tokenMessengerAddress = process.env.CCTP_TOKEN_MESSENGER || sourceConfig.tokenMessenger || ethers.ZeroAddress;

    if (tokenMessengerAddress === ethers.ZeroAddress) {
      // No CCTP TokenMessenger configured - simulate the transfer
      console.log(`[Gateway] CCTP TokenMessenger not configured. Simulating cross-chain transfer.`);
      console.log(`[Gateway] ${amount} USDC from ${sourceChain} (${from}) -> ${destChain} (${to})`);

      return {
        type: 'cross-chain',
        status: 'simulated',
        from,
        to,
        amount,
        sourceChain,
        destChain,
        destinationDomain: destConfig.cctpDomain,
        message: `CCTP transfer simulated. Configure CCTP_TOKEN_MESSENGER for live transfers.`,
        estimatedTime: '10-15 minutes',
      };
    }

    const approveTx = await usdc.approve(tokenMessengerAddress, amountWei);
    await approveTx.wait();

    // Step 2: Call depositForBurn on TokenMessenger
    const tokenMessenger = new ethers.Contract(
      tokenMessengerAddress,
      CCTP_TOKEN_MESSENGER_ABI,
      signer
    );

    const burnTx = await tokenMessenger.depositForBurn(
      amountWei,
      destConfig.cctpDomain,
      mintRecipient,
      sourceConfig.usdc
    );
    const burnReceipt = await burnTx.wait();

    // Extract nonce from DepositForBurn event
    const iface = new ethers.Interface(CCTP_TOKEN_MESSENGER_ABI);
    let burnNonce = null;
    for (const log of burnReceipt.logs) {
      try {
        const parsed = iface.parseLog({ topics: log.topics, data: log.data });
        if (parsed?.name === 'DepositForBurn') {
          burnNonce = parsed.args.nonce.toString();
          break;
        }
      } catch {
        // skip non-matching logs
      }
    }

    return {
      type: 'cross-chain',
      status: 'burned',
      burnTxHash: burnReceipt.hash,
      burnNonce,
      from,
      to,
      amount,
      sourceChain,
      destChain,
      destinationDomain: destConfig.cctpDomain,
      explorerUrl: `${sourceConfig.explorer}/tx/${burnReceipt.hash}`,
      message: 'USDC burned on source chain. Awaiting Circle attestation for destination mint.',
      estimatedTime: '10-15 minutes',
      nextStep: 'Poll Circle attestation API, then call receiveMessage on destination MessageTransmitter.',
    };
  }

  /**
   * Get supported chains list.
   * @returns {object} Map of supported chain configs (without sensitive data).
   */
  getSupportedChains() {
    const chains = {};
    for (const [name, config] of Object.entries(SUPPORTED_CHAINS)) {
      chains[name] = {
        chainId: config.chainId,
        explorer: config.explorer,
        cctpDomain: config.cctpDomain,
        hasGateway: !!(config.gatewayWallet && config.gatewayMinter),
      };
    }
    return chains;
  }

  /**
   * Poll Circle Attestation API for a burn message hash.
   * After depositForBurn, the message hash is used to retrieve the attestation
   * needed to call receiveMessage on the destination chain.
   *
   * @param {string} messageHash - The keccak256 hash of the CCTP message bytes.
   * @param {number} [maxRetries=30] - Maximum polling attempts.
   * @param {number} [intervalMs=10000] - Polling interval in milliseconds.
   * @returns {Promise<object>} Attestation response with message and attestation bytes.
   */
  async pollAttestation(messageHash, maxRetries = 30, intervalMs = 10000) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetch(`${CIRCLE_ATTESTATION_API}/${messageHash}`);
        const data = await response.json();

        if (data.status === 'complete' && data.attestation) {
          return {
            status: 'complete',
            attestation: data.attestation,
            messageHash,
          };
        }

        console.log(`[Gateway] Attestation pending (attempt ${i + 1}/${maxRetries})...`);
      } catch (err) {
        console.warn(`[Gateway] Attestation poll error:`, err.message);
      }

      if (i < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }

    return { status: 'pending', messageHash, message: 'Attestation not yet available. Continue polling.' };
  }

  /**
   * Complete a cross-chain transfer by calling receiveMessage on the destination
   * MessageTransmitter with the Circle attestation.
   *
   * @param {object} params
   * @param {string} params.destChain - Destination chain identifier.
   * @param {string} params.messageBytes - The original CCTP message bytes.
   * @param {string} params.attestation - The Circle attestation signature.
   * @param {object} params.signer - ethers Signer instance on the destination chain.
   * @returns {Promise<object>} Receive result.
   */
  async receiveMessage({ destChain, messageBytes, attestation, signer }) {
    const destConfig = SUPPORTED_CHAINS[destChain];
    if (!destConfig) throw new Error(`Unsupported destination chain: ${destChain}`);

    const messageTransmitterAddr = process.env.CCTP_MESSAGE_TRANSMITTER || destConfig.messageTransmitter;
    if (!messageTransmitterAddr) {
      return {
        status: 'simulated',
        destChain,
        message: 'MessageTransmitter not configured for destination chain.',
      };
    }

    const messageTransmitter = new ethers.Contract(
      messageTransmitterAddr,
      CCTP_MESSAGE_TRANSMITTER_ABI,
      signer
    );

    const tx = await messageTransmitter.receiveMessage(messageBytes, attestation);
    const receipt = await tx.wait();

    return {
      status: 'completed',
      txHash: receipt.hash,
      destChain,
      explorerUrl: `${destConfig.explorer}/tx/${receipt.hash}`,
    };
  }

  /**
   * Get Gateway wallet and minter info for Arc Testnet.
   * Used for unified balance operations.
   *
   * @returns {object} Gateway configuration.
   */
  getGatewayConfig() {
    const arcConfig = SUPPORTED_CHAINS['ARC-TESTNET'];
    return {
      gatewayWallet: arcConfig.gatewayWallet,
      gatewayMinter: arcConfig.gatewayMinter,
      tokenMessenger: arcConfig.tokenMessenger,
      messageTransmitter: arcConfig.messageTransmitter,
      tokenMinter: arcConfig.tokenMinter,
      chain: 'ARC-TESTNET',
      chainId: arcConfig.chainId,
    };
  }
}

module.exports = GatewayService;
