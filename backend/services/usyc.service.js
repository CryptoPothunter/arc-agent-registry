/**
 * USYCService - manages idle fund deployment into Hashnote USYC (US Yield Coin).
 * Provides yield-bearing parking for escrowed USDC during task execution.
 * Integrates with Arc Testnet USYC contract at 0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C.
 */

const { ethers } = require('ethers');

const USYC_CONTRACT = process.env.USYC_CONTRACT || '0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C';
const USDC_CONTRACT = process.env.USDC_ADDRESS || process.env.USDC_CONTRACT || '0x3600000000000000000000000000000000000000';
const TELLER_CONTRACT = process.env.TELLER_ADDRESS || '0x9fdF14c5B14173D74C08Af27AebFf39240dC105A';
const ENTITLEMENTS_CONTRACT = process.env.ENTITLEMENTS_ADDRESS || '0xcc205224862c7641930c87679e98999d23c26113';
const RPC_URL = process.env.ARC_RPC_URL || process.env.RPC_URL || 'https://rpc.testnet.arc.network';

const ERC20_ABI = require('../abis/ERC20.json');

// Extended USYC ABI for deposit/redeem + balance queries
const USYC_ABI = [
  'function deposit(uint256 amount) external returns (uint256 shares)',
  'function redeem(uint256 shares) external returns (uint256 assets)',
  'function balanceOf(address account) external view returns (uint256)',
  'function totalSupply() external view returns (uint256)',
  'function convertToShares(uint256 assets) external view returns (uint256)',
  'function convertToAssets(uint256 shares) external view returns (uint256)',
  'function previewDeposit(uint256 assets) external view returns (uint256)',
  'function previewRedeem(uint256 shares) external view returns (uint256)',
];

// Teller ABI for deposits through the Teller contract
const TELLER_ABI = [
  'function deposit(address depositAsset, uint256 depositAmount, uint256 minimumMint) external returns (uint256 shares)',
  'function bulkDeposit(address depositAsset, uint256 depositAmount, uint256 minimumMint, address to) external returns (uint256 shares)',
];

class USYCService {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(RPC_URL);
    this.usycAddress = USYC_CONTRACT;
    this.usdcAddress = USDC_CONTRACT;
    this.tellerAddress = TELLER_CONTRACT;
  }

  /**
   * Deposit USDC into USYC to earn yield while funds are escrowed.
   * Uses the Teller contract on Arc Testnet for deposits.
   * @param {object} params
   * @param {string} params.amount - USDC amount (human-readable, 6 decimals).
   * @param {object} params.signer - ethers Signer instance.
   * @returns {Promise<object>} Deposit result with USYC shares received.
   */
  async depositToUSYC({ amount, signer }) {
    const amountWei = ethers.parseUnits(String(amount), 6);

    try {
      // Step 1: Approve Teller contract to spend USDC
      const usdc = new ethers.Contract(this.usdcAddress, ERC20_ABI, signer);
      console.log(`[USYC] Approving ${amount} USDC for Teller contract...`);
      const approveTx = await usdc.approve(this.tellerAddress, amountWei);
      await approveTx.wait();
      console.log(`[USYC] Approval confirmed`);

      // Step 2: Preview expected shares
      let expectedShares = amountWei; // default 1:1
      try {
        const usyc = new ethers.Contract(this.usycAddress, USYC_ABI, this.provider);
        expectedShares = await usyc.previewDeposit(amountWei);
        console.log(`[USYC] Expected shares: ${ethers.formatUnits(expectedShares, 6)}`);
      } catch (err) {
        console.warn(`[USYC] Preview failed, using 1:1 estimate:`, err.message);
      }

      // Step 3: Deposit via Teller with 1% slippage tolerance
      const minimumMint = expectedShares * 99n / 100n;
      const teller = new ethers.Contract(this.tellerAddress, TELLER_ABI, signer);
      console.log(`[USYC] Depositing ${amount} USDC via Teller...`);
      const depositTx = await teller.deposit(this.usdcAddress, amountWei, minimumMint);
      const receipt = await depositTx.wait();

      console.log(`[USYC] Deposit confirmed: tx ${receipt.hash}`);

      // Step 4: Check resulting USYC balance
      const signerAddress = await signer.getAddress();
      const usycBalance = await this.getUSYCBalance(signerAddress);

      return {
        deposited: true,
        txHash: receipt.hash,
        usdcAmount: amount,
        expectedShares: ethers.formatUnits(expectedShares, 6),
        usycBalance,
        gasUsed: receipt.gasUsed.toString(),
        explorerUrl: `https://testnet.arcscan.app/tx/${receipt.hash}`,
      };
    } catch (err) {
      console.error(`[USYC] Deposit failed:`, err.message);
      throw new Error(`USYC deposit failed: ${err.message}`);
    }
  }

  /**
   * Redeem USYC shares back to USDC.
   * @param {object} params
   * @param {string} params.shares - USYC shares to redeem (human-readable, 6 decimals).
   * @param {object} params.signer - ethers Signer instance.
   * @returns {Promise<object>} Redemption result with USDC received.
   */
  async redeemFromUSYC({ shares, signer }) {
    const sharesWei = ethers.parseUnits(String(shares), 6);

    try {
      // Preview expected USDC output
      let expectedAssets = sharesWei; // default 1:1
      try {
        const usyc = new ethers.Contract(this.usycAddress, USYC_ABI, this.provider);
        expectedAssets = await usyc.previewRedeem(sharesWei);
        console.log(`[USYC] Expected USDC from redeem: ${ethers.formatUnits(expectedAssets, 6)}`);
      } catch (err) {
        console.warn(`[USYC] Preview redeem failed, using 1:1 estimate:`, err.message);
      }

      const usyc = new ethers.Contract(this.usycAddress, USYC_ABI, signer);
      console.log(`[USYC] Redeeming ${shares} USYC shares...`);
      const redeemTx = await usyc.redeem(sharesWei);
      const receipt = await redeemTx.wait();

      console.log(`[USYC] Redeem confirmed: tx ${receipt.hash}`);

      // #24: Calculate yieldEarned = expectedUsdcReceived - shares (original deposit)
      const expectedUsdcStr = ethers.formatUnits(expectedAssets, 6);
      const sharesStr = String(shares);
      const yieldEarned = (parseFloat(expectedUsdcStr) - parseFloat(sharesStr)).toFixed(6);

      return {
        redeemed: true,
        txHash: receipt.hash,
        usycShares: shares,
        expectedUsdcReceived: expectedUsdcStr,
        yieldEarned,
        gasUsed: receipt.gasUsed.toString(),
        explorerUrl: `https://testnet.arcscan.app/tx/${receipt.hash}`,
      };
    } catch (err) {
      console.error(`[USYC] Redemption failed:`, err.message);
      throw new Error(`USYC redemption failed: ${err.message}`);
    }
  }

  /**
   * Get USYC token balance for an address.
   * @param {string} address - Wallet address.
   * @returns {Promise<string>} USYC balance (human-readable).
   */
  async getUSYCBalance(address) {
    try {
      const usyc = new ethers.Contract(this.usycAddress, USYC_ABI, this.provider);
      const balance = await usyc.balanceOf(address);
      return ethers.formatUnits(balance, 6);
    } catch (err) {
      console.warn(`[USYC] Balance check failed:`, err.message);
      return '0.00';
    }
  }

  /**
   * Get current USYC yield info (exchange rate).
   * @returns {Promise<object>} Yield information.
   */
  async getYieldInfo() {
    try {
      const usyc = new ethers.Contract(this.usycAddress, USYC_ABI, this.provider);
      const oneUnit = ethers.parseUnits('1', 6);

      const sharesToAssets = await usyc.convertToAssets(oneUnit);
      const assetsToShares = await usyc.convertToShares(oneUnit);

      return {
        exchangeRate: ethers.formatUnits(sharesToAssets, 6),
        inverseRate: ethers.formatUnits(assetsToShares, 6),
        usycContract: this.usycAddress,
        tellerContract: this.tellerAddress,
      };
    } catch (err) {
      return {
        exchangeRate: '1.000000',
        inverseRate: '1.000000',
        usycContract: this.usycAddress,
        tellerContract: this.tellerAddress,
        note: 'Yield info unavailable, showing default rates',
      };
    }
  }
}

module.exports = USYCService;
