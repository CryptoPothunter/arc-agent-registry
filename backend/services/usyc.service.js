/**
 * USYCService - manages idle fund deployment into Hashnote USYC (US Yield Coin).
 * Provides yield-bearing parking for escrowed USDC during task execution.
 */

const { ethers } = require('ethers');

const USYC_CONTRACT = process.env.USYC_CONTRACT || '';
const USDC_CONTRACT = process.env.USDC_CONTRACT || '';
const RPC_URL = process.env.RPC_URL || 'https://rpc.sepolia.org';

const ERC20_ABI = require('../abis/ERC20.json');

class USYCService {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(RPC_URL);
  }

  /**
   * Deposit USDC into USYC to earn yield while funds are escrowed.
   * @param {object} params
   * @param {string} params.amount - USDC amount (human-readable).
   * @param {object} params.signer - ethers Signer instance.
   * @returns {Promise<object>} Deposit result with USYC shares received.
   */
  async depositToUSYC({ amount, signer }) {
    if (!USYC_CONTRACT || !USDC_CONTRACT) {
      console.warn('[USYC] Contract addresses not configured, returning mock deposit');
      return {
        deposited: true,
        mock: true,
        usdcAmount: amount,
        usycShares: amount, // 1:1 approximation
        message: 'USYC deposit would occur in production',
      };
    }

    const amountWei = ethers.parseUnits(amount, 6);

    // Approve USYC contract to spend USDC
    const usdc = new ethers.Contract(USDC_CONTRACT, ERC20_ABI, signer);
    const approveTx = await usdc.approve(USYC_CONTRACT, amountWei);
    await approveTx.wait();

    // Deposit into USYC
    const usycAbi = [
      'function deposit(uint256 amount) external returns (uint256 shares)',
    ];
    const usyc = new ethers.Contract(USYC_CONTRACT, usycAbi, signer);
    const depositTx = await usyc.deposit(amountWei);
    const receipt = await depositTx.wait();

    return {
      deposited: true,
      txHash: receipt.hash,
      usdcAmount: amount,
      gasUsed: receipt.gasUsed.toString(),
    };
  }

  /**
   * Redeem USYC shares back to USDC.
   * @param {object} params
   * @param {string} params.shares - USYC shares to redeem.
   * @param {object} params.signer - ethers Signer instance.
   * @returns {Promise<object>} Redemption result with USDC received.
   */
  async redeemFromUSYC({ shares, signer }) {
    if (!USYC_CONTRACT) {
      console.warn('[USYC] Contract address not configured, returning mock redemption');
      return {
        redeemed: true,
        mock: true,
        usycShares: shares,
        usdcReceived: shares, // 1:1 approximation
        message: 'USYC redemption would occur in production',
      };
    }

    const sharesWei = ethers.parseUnits(shares, 6);

    const usycAbi = [
      'function redeem(uint256 shares) external returns (uint256 assets)',
    ];
    const usyc = new ethers.Contract(USYC_CONTRACT, usycAbi, signer);
    const redeemTx = await usyc.redeem(sharesWei);
    const receipt = await redeemTx.wait();

    return {
      redeemed: true,
      txHash: receipt.hash,
      usycShares: shares,
      gasUsed: receipt.gasUsed.toString(),
    };
  }
}

module.exports = USYCService;
