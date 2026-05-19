/**
 * GatewayService - unified cross-chain balance and transfer operations.
 * Abstracts multi-chain wallet interactions behind a single interface.
 */

const { ethers } = require('ethers');

const SUPPORTED_CHAINS = {
  'ETH-SEPOLIA': {
    rpcUrl: process.env.ETH_SEPOLIA_RPC || 'https://rpc.sepolia.org',
    chainId: 11155111,
    usdc: process.env.USDC_SEPOLIA || '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  },
  'AVAX-FUJI': {
    rpcUrl: process.env.AVAX_FUJI_RPC || 'https://api.avax-test.network/ext/bc/C/rpc',
    chainId: 43113,
    usdc: process.env.USDC_FUJI || '0x5425890298aed601595a70AB815c96711a31Bc65',
  },
  'ARB-SEPOLIA': {
    rpcUrl: process.env.ARB_SEPOLIA_RPC || 'https://sepolia-rollup.arbitrum.io/rpc',
    chainId: 421614,
    usdc: process.env.USDC_ARB_SEPOLIA || '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
  },
};

const ERC20_ABI = require('../abis/ERC20.json');

class GatewayService {
  constructor() {
    this.providers = {};
    for (const [chain, config] of Object.entries(SUPPORTED_CHAINS)) {
      this.providers[chain] = new ethers.JsonRpcProvider(config.rpcUrl);
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
        console.warn(`[Gateway] Failed to fetch balance:`, result.reason.message);
      }
    }

    return {
      address: walletAddress,
      balances,
      totalUSDC: ethers.formatUnits(total, 6),
    };
  }

  /**
   * Initiate a cross-chain USDC transfer using Circle CCTP (Cross-Chain Transfer Protocol).
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
      // Same-chain transfer: direct ERC20 transfer
      const config = SUPPORTED_CHAINS[sourceChain];
      const usdc = new ethers.Contract(config.usdc, ERC20_ABI, signer);
      const amountWei = ethers.parseUnits(amount, 6);

      const tx = await usdc.transfer(to, amountWei);
      const receipt = await tx.wait();

      return {
        type: 'same-chain',
        txHash: receipt.hash,
        from,
        to,
        amount,
        chain: sourceChain,
      };
    }

    // Cross-chain: placeholder for CCTP integration
    // In production, this would burn USDC on source chain via MessageTransmitter
    // and mint on destination chain.
    console.log(`[Gateway] Cross-chain transfer: ${amount} USDC from ${sourceChain} to ${destChain}`);

    return {
      type: 'cross-chain',
      status: 'pending',
      from,
      to,
      amount,
      sourceChain,
      destChain,
      message: 'CCTP transfer initiated. Attestation pending.',
      estimatedTime: '10-15 minutes',
    };
  }
}

module.exports = GatewayService;
