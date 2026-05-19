/**
 * CircleWalletService - manages programmable wallets via Circle APIs.
 */

const CIRCLE_API_KEY = process.env.CIRCLE_API_KEY || '';
const CIRCLE_BASE_URL = process.env.CIRCLE_BASE_URL || 'https://api.circle.com/v1/w3s';

class CircleWalletService {
  constructor() {
    this.apiKey = CIRCLE_API_KEY;
    this.baseUrl = CIRCLE_BASE_URL;
  }

  /**
   * Create a new programmable wallet for an agent.
   * @param {string} agentId - Unique agent identifier.
   * @returns {Promise<object>} Wallet details including address and walletId.
   */
  async createAgentWallet(agentId) {
    if (!this.apiKey) {
      // Dev fallback: return a mock wallet
      const mockAddress = `0x${Buffer.from(agentId).toString('hex').padEnd(40, '0').slice(0, 40)}`;
      return {
        walletId: `wallet-${agentId}-${Date.now()}`,
        address: mockAddress,
        blockchain: 'ETH-SEPOLIA',
        agentId,
      };
    }

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
    };
  }

  /**
   * Get the USDC balance for an agent wallet.
   * @param {string} walletId - Circle wallet identifier.
   * @returns {Promise<string>} USDC balance as a string.
   */
  async getUSDCBalance(walletId) {
    if (!this.apiKey) {
      return '0.00';
    }

    const res = await fetch(`${this.baseUrl}/wallets/${walletId}/balances`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch balance for wallet ${walletId}`);
    }

    const data = await res.json();
    const usdcToken = data.data.tokenBalances?.find(
      (t) => t.token.symbol === 'USDC'
    );

    return usdcToken ? usdcToken.amount : '0.00';
  }
}

module.exports = CircleWalletService;
