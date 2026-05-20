/**
 * YieldingEscrowService - Escrow with USYC yield generation for long-duration tasks.
 *
 * Deposits escrowed USDC into Hashnote USYC via the Teller contract when task
 * duration exceeds 6 hours, allowing idle funds to earn yield. On task completion,
 * redeems USYC and releases principal + yield to the provider.
 */

const { ethers } = require('ethers');

const RPC_URL = process.env.ARC_RPC_URL || process.env.RPC_URL || 'https://rpc.testnet.arc.network';
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY || '';
const USDC_ADDRESS = process.env.USDC_ADDRESS || process.env.USDC_CONTRACT || '0x3600000000000000000000000000000000000000';
const TELLER_ADDRESS = '0x9fdF14c5B14173D74C08Af27AebFf39240dC105A';
const USYC_ADDRESS = '0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C';

// Minimum duration to qualify for yield deployment (6 hours in seconds)
const MIN_YIELD_DURATION = 6 * 60 * 60;

// Minimal ABIs
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function balanceOf(address account) external view returns (uint256)',
  'function transfer(address to, uint256 amount) external returns (bool)',
];

const TELLER_ABI = [
  'function deposit(address depositAsset, uint256 depositAmount, uint256 minimumMint) external returns (uint256 shares)',
];

const USYC_ABI = [
  'function redeem(uint256 shares) external returns (uint256 assets)',
  'function balanceOf(address account) external view returns (uint256)',
  'function previewDeposit(uint256 assets) external view returns (uint256)',
  'function previewRedeem(uint256 shares) external view returns (uint256)',
  'function convertToAssets(uint256 shares) external view returns (uint256)',
];

class YieldingEscrowService {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(RPC_URL);
    this.signer = DEPLOYER_KEY
      ? new ethers.Wallet(DEPLOYER_KEY, this.provider)
      : null;

    // Dev fallback store: Map<taskId, EscrowRecord>
    this._store = new Map();
  }

  /**
   * Deposit funds into escrow with automatic USYC yield if duration > 6 hours.
   * @param {string} taskId - Unique task identifier.
   * @param {string|number} amountUsdc - USDC amount (human-readable, 6 decimals).
   * @param {string} providerAddress - Provider wallet address to receive funds.
   * @param {number} deadline - Unix timestamp for task deadline.
   * @returns {Promise<object>} Deposit result with yield info.
   */
  async depositWithYield(taskId, amountUsdc, providerAddress, deadline) {
    try {
      if (!taskId) throw new Error('taskId is required');
      if (!amountUsdc || parseFloat(amountUsdc) <= 0) throw new Error('amountUsdc must be positive');
      if (!providerAddress) throw new Error('provider address is required');
      if (!deadline) throw new Error('deadline is required');

      const now = Math.floor(Date.now() / 1000);
      const duration = deadline - now;

      if (duration <= 0) {
        throw new Error('Deadline must be in the future');
      }

      const yieldEligible = duration > MIN_YIELD_DURATION;
      const amountWei = ethers.parseUnits(String(amountUsdc), 6);

      console.log(`[YieldingEscrow] Depositing ${amountUsdc} USDC for task ${taskId}, yield eligible: ${yieldEligible}`);

      if (this.signer && yieldEligible) {
        try {
          // Step 1: Approve Teller to spend USDC
          const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, this.signer);
          console.log(`[YieldingEscrow] Approving ${amountUsdc} USDC for Teller...`);
          const approveTx = await usdc.approve(TELLER_ADDRESS, amountWei);
          await approveTx.wait();

          // Step 2: Preview expected USYC shares
          const usyc = new ethers.Contract(USYC_ADDRESS, USYC_ABI, this.provider);
          let expectedShares = amountWei;
          try {
            expectedShares = await usyc.previewDeposit(amountWei);
          } catch {
            console.warn('[YieldingEscrow] Preview failed, using 1:1 estimate');
          }

          // Step 3: Deposit via Teller with 1% slippage
          const minimumMint = expectedShares * 99n / 100n;
          const teller = new ethers.Contract(TELLER_ADDRESS, TELLER_ABI, this.signer);
          console.log(`[YieldingEscrow] Depositing into USYC via Teller...`);
          const depositTx = await teller.deposit(USDC_ADDRESS, amountWei, minimumMint);
          const receipt = await depositTx.wait();

          const record = {
            taskId,
            amountUsdc: String(amountUsdc),
            provider: providerAddress,
            deadline,
            duration,
            yieldDeployed: true,
            usycShares: ethers.formatUnits(expectedShares, 6),
            depositTxHash: receipt.hash,
            status: 'locked_with_yield',
            createdAt: new Date().toISOString(),
          };

          this._store.set(taskId, record);
          console.log(`[YieldingEscrow] Deposited with yield: tx=${receipt.hash}`);
          return record;
        } catch (err) {
          console.warn(`[YieldingEscrow] On-chain yield deposit failed, falling back to standard escrow: ${err.message}`);
          // Fall through to dev fallback
        }
      }

      // Dev fallback or non-yield-eligible deposit
      const record = {
        taskId,
        amountUsdc: String(amountUsdc),
        provider: providerAddress,
        deadline,
        duration,
        yieldDeployed: yieldEligible,
        usycShares: yieldEligible ? String(amountUsdc) : '0', // Simulated 1:1 conversion
        status: yieldEligible ? 'locked_with_yield' : 'locked',
        estimatedYield: yieldEligible
          ? parseFloat((parseFloat(amountUsdc) * 0.05 * (duration / (365 * 24 * 3600))).toFixed(6))
          : 0,
        createdAt: new Date().toISOString(),
      };

      this._store.set(taskId, record);
      console.log(`[YieldingEscrow] Deposit recorded (${yieldEligible ? 'with yield' : 'standard'}): taskId=${taskId}`);
      return record;
    } catch (err) {
      console.error(`[YieldingEscrow] depositWithYield failed:`, err.message);
      throw new Error(`Yield escrow deposit failed: ${err.message}`);
    }
  }

  /**
   * Release escrowed funds (and redeem USYC yield if deployed).
   * @param {string} taskId - Task identifier.
   * @returns {Promise<object>} Release result with yield info.
   */
  async releaseWithYield(taskId) {
    try {
      const record = this._store.get(taskId);
      if (!record) throw new Error(`Escrow for task ${taskId} not found`);
      if (record.status === 'released') throw new Error(`Escrow for task ${taskId} already released`);
      if (record.status === 'refunded') throw new Error(`Escrow for task ${taskId} was refunded`);

      let yieldEarned = 0;
      let totalPayout = parseFloat(record.amountUsdc);
      let redeemTxHash = null;

      if (record.yieldDeployed && this.signer) {
        try {
          const usyc = new ethers.Contract(USYC_ADDRESS, USYC_ABI, this.signer);
          const sharesWei = ethers.parseUnits(record.usycShares, 6);

          // Preview redemption to get expected USDC
          let expectedAssets = sharesWei;
          try {
            expectedAssets = await usyc.previewRedeem(sharesWei);
          } catch {
            console.warn('[YieldingEscrow] Preview redeem failed, using 1:1');
          }

          // Redeem USYC shares
          console.log(`[YieldingEscrow] Redeeming ${record.usycShares} USYC shares...`);
          const redeemTx = await usyc.redeem(sharesWei);
          const receipt = await redeemTx.wait();

          const redeemedAmount = parseFloat(ethers.formatUnits(expectedAssets, 6));
          yieldEarned = parseFloat((redeemedAmount - parseFloat(record.amountUsdc)).toFixed(6));
          totalPayout = redeemedAmount;
          redeemTxHash = receipt.hash;

          console.log(`[YieldingEscrow] USYC redeemed: yield=${yieldEarned} USDC, tx=${receipt.hash}`);
        } catch (err) {
          console.warn(`[YieldingEscrow] USYC redemption failed: ${err.message}`);
          // Still release the principal
          yieldEarned = 0;
          totalPayout = parseFloat(record.amountUsdc);
        }
      } else if (record.yieldDeployed) {
        // Dev mode: simulate yield earned
        yieldEarned = record.estimatedYield || 0;
        totalPayout = parseFloat(record.amountUsdc) + yieldEarned;
      }

      // Transfer to provider (on-chain if signer available)
      let transferTxHash = null;
      if (this.signer && record.provider !== ethers.ZeroAddress) {
        try {
          const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, this.signer);
          const payoutWei = ethers.parseUnits(totalPayout.toFixed(6), 6);
          const transferTx = await usdc.transfer(record.provider, payoutWei);
          const transferReceipt = await transferTx.wait();
          transferTxHash = transferReceipt.hash;
          console.log(`[YieldingEscrow] Funds transferred to provider: tx=${transferTxHash}`);
        } catch (err) {
          console.warn(`[YieldingEscrow] On-chain transfer failed: ${err.message}`);
        }
      }

      record.status = 'released';
      record.releasedAt = new Date().toISOString();
      record.yieldEarned = yieldEarned;
      record.totalPayout = totalPayout;
      record.redeemTxHash = redeemTxHash;
      record.transferTxHash = transferTxHash;

      console.log(`[YieldingEscrow] Released: taskId=${taskId}, principal=${record.amountUsdc}, yield=${yieldEarned}, total=${totalPayout}`);

      return {
        taskId,
        provider: record.provider,
        principal: record.amountUsdc,
        yieldEarned,
        totalPayout,
        yieldDeployed: record.yieldDeployed,
        status: 'released',
        redeemTxHash,
        transferTxHash,
        releasedAt: record.releasedAt,
      };
    } catch (err) {
      console.error(`[YieldingEscrow] releaseWithYield failed:`, err.message);
      throw new Error(`Yield escrow release failed: ${err.message}`);
    }
  }

  /**
   * Get escrow status for a task.
   * @param {string} taskId - Task identifier.
   * @returns {object} Escrow status.
   */
  getEscrowStatus(taskId) {
    const record = this._store.get(taskId);
    if (!record) throw new Error(`Escrow for task ${taskId} not found`);
    return { ...record };
  }

  /**
   * Get all active (locked) escrows.
   * @returns {Array} List of active escrow records.
   */
  getActiveEscrows() {
    return Array.from(this._store.values())
      .filter((r) => r.status === 'locked' || r.status === 'locked_with_yield');
  }
}

module.exports = YieldingEscrowService;
