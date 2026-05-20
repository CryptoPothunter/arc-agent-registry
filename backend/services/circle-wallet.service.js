/**
 * CircleWalletService - manages programmable wallets via Circle APIs.
 * Supports Arc Testnet with USDC balance queries.
 */

const { ethers } = require('ethers');
const ERC20_ABI = require('../abis/ERC20.json');

const CIRCLE_API_KEY = process.env.CIRCLE_API_KEY || '';
const CIRCLE_BASE_URL = process.env.CIRCLE_BASE_URL || 'https://api.circle.com/v1/w3s';
const RPC_URL = process.env.RPC_URL || 'https://rpc.testnet.arc.network';
const USDC_ADDRESS = process.env.USDC_ADDRESS || '0x3600000000000000000000000000000000000000';
const EURC_ADDRESS = process.env.EURC_ADDRESS || '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a';

class CircleWalletService {
  constructor() {
    this.apiKey = CIRCLE_API_KEY;
    this.baseUrl = CIRCLE_BASE_URL;
    this.provider = new ethers.JsonRpcProvider(RPC_URL);
  }

  /**
   * Create a new programmable wallet for an agent.
   * Uses Circle API when configured, otherwise generates a local wallet.
   * @param {string} agentId - Unique agent identifier.
   * @returns {Promise<object>} Wallet details including address and walletId.
   */
  async createAgentWallet(agentId) {
    if (!this.apiKey) {
      // Dev mode: create a real local wallet (not a mock address)
      const wallet = ethers.Wallet.createRandom();
      console.log(`[CircleWallet] Dev mode - created local wallet for agent ${agentId}: ${wallet.address}`);
      return {
        walletId: `local-wallet-${agentId}-${Date.now()}`,
        address: wallet.address,
        privateKey: wallet.privateKey, // Only returned in dev mode
        blockchain: 'ARC-TESTNET',
        agentId,
        mode: 'local',
      };
    }

    // Production: use Circle Programmable Wallets API
    const walletSetRes = await fetch(`${this.baseUrl}/developer/walletSets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        idempotencyKey: `agent-walletset-${agentId}`,
        name: `Agent-${agentId}-WalletSet`,
      }),
    });

    if (!walletSetRes.ok) {
      const err = await walletSetRes.text();
      throw new Error(`Circle walletSet creation failed: ${err}`);
    }

    const walletSetData = await walletSetRes.json();
    const walletSetId = walletSetData.data.walletSet.id;

    const walletRes = await fetch(`${this.baseUrl}/developer/wallets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        idempotencyKey: `agent-wallet-${agentId}`,
        walletSetId,
        blockchains: ['ETH-SEPOLIA'],
        count: 1,
        accountType: 'SCA',
      }),
    });

    if (!walletRes.ok) {
      const err = await walletRes.text();
      throw new Error(`Circle wallet creation failed: ${err}`);
    }

    const walletData = await walletRes.json();
    const wallet = walletData.data.wallets[0];

    return {
      walletId: wallet.id,
      address: wallet.address,
      blockchain: wallet.blockchain,
      agentId,
      mode: 'circle',
    };
  }

  /**
   * Get the USDC balance for a wallet address on Arc Testnet.
   * Queries the on-chain USDC contract directly.
   * @param {string} addressOrWalletId - Wallet address (0x...) or Circle walletId.
   * @returns {Promise<object>} Balance details.
   */
  async getUSDCBalance(addressOrWalletId) {
    // If it looks like an address, query on-chain directly
    if (addressOrWalletId.startsWith('0x')) {
      return this._getOnChainBalance(addressOrWalletId);
    }

    // Otherwise use Circle API
    if (!this.apiKey) {
      return { usdc: '0.00', eurc: '0.00', source: 'unavailable' };
    }

    const res = await fetch(`${this.baseUrl}/wallets/${addressOrWalletId}/balances`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch balance for wallet ${addressOrWalletId}`);
    }

    const data = await res.json();
    const usdcToken = data.data.tokenBalances?.find(
      (t) => t.token.symbol === 'USDC'
    );

    return {
      usdc: usdcToken ? usdcToken.amount : '0.00',
      source: 'circle',
    };
  }

  /**
   * Query on-chain USDC and EURC balances on Arc Testnet.
   * @param {string} address - Wallet address.
   * @returns {Promise<object>} Balance details.
   * @private
   */
  async _getOnChainBalance(address) {
    const result = { address, source: 'on-chain', chain: 'ARC-TESTNET' };

    try {
      const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, this.provider);
      const usdcBalance = await usdc.balanceOf(address);
      result.usdc = ethers.formatUnits(usdcBalance, 6);
    } catch (err) {
      console.warn(`[CircleWallet] USDC balance query failed:`, err.message);
      result.usdc = '0.00';
    }

    try {
      const eurc = new ethers.Contract(EURC_ADDRESS, ERC20_ABI, this.provider);
      const eurcBalance = await eurc.balanceOf(address);
      result.eurc = ethers.formatUnits(eurcBalance, 6);
    } catch (err) {
      console.warn(`[CircleWallet] EURC balance query failed:`, err.message);
      result.eurc = '0.00';
    }

    return result;
  }

  /**
   * Transfer USDC between wallets on Arc Testnet.
   * @param {object} params
   * @param {string} params.from - Sender address.
   * @param {string} params.to - Recipient address.
   * @param {string} params.amount - USDC amount (human-readable).
   * @param {object} params.signer - ethers Signer instance.
   * @returns {Promise<object>} Transfer result.
   */
  async transferUSDC({ from, to, amount, signer }) {
    const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, signer);
    const amountWei = ethers.parseUnits(amount, 6);

    const tx = await usdc.transfer(to, amountWei);
    const receipt = await tx.wait();

    return {
      success: true,
      txHash: receipt.hash,
      from,
      to,
      amount,
      gasUsed: receipt.gasUsed.toString(),
      explorerUrl: `https://testnet.arcscan.app/tx/${receipt.hash}`,
    };
  }
}

module.exports = CircleWalletService;
