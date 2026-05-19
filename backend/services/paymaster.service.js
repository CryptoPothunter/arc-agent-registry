/**
 * PaymasterService - sponsors gas fees for agent transactions.
 * Enables gasless UX by covering transaction costs via a paymaster contract.
 */

const { ethers } = require('ethers');

const PAYMASTER_ADDRESS = process.env.PAYMASTER_ADDRESS || '';
const PAYMASTER_PRIVATE_KEY = process.env.PAYMASTER_PRIVATE_KEY || '';
const RPC_URL = process.env.RPC_URL || 'https://rpc.sepolia.org';

class PaymasterService {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(RPC_URL);
    this.signer = PAYMASTER_PRIVATE_KEY
      ? new ethers.Wallet(PAYMASTER_PRIVATE_KEY, this.provider)
      : null;
  }

  /**
   * Sponsor a transaction by wrapping it in a paymaster UserOperation.
   * For ERC-4337 compatible wallets, the paymaster covers gas costs.
   *
   * @param {object} params
   * @param {string} params.target - The target contract address.
   * @param {string} params.calldata - Encoded function call data.
   * @param {string} params.sender - The sender's smart account address.
   * @returns {Promise<object>} Sponsored transaction result.
   */
  async sponsorTransaction({ target, calldata, sender }) {
    if (!this.signer) {
      console.warn('[Paymaster] No private key configured, returning mock sponsorship');
      return {
        sponsored: true,
        mock: true,
        sender,
        target,
        message: 'Transaction would be sponsored in production',
      };
    }

    try {
      // In production, this builds a UserOperation and submits to a bundler
      // with the paymaster's signature covering gas costs.
      // Simplified: relay the transaction directly from the paymaster wallet.

      const tx = await this.signer.sendTransaction({
        to: target,
        data: calldata,
        gasLimit: 500_000,
      });

      const receipt = await tx.wait();

      return {
        sponsored: true,
        txHash: receipt.hash,
        gasUsed: receipt.gasUsed.toString(),
        sender,
        target,
      };
    } catch (error) {
      throw new Error(`Paymaster sponsorship failed: ${error.message}`);
    }
  }
}

module.exports = PaymasterService;
