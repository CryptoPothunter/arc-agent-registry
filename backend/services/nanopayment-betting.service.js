/**
 * NanopaymentBettingService - Nanopayment aggregation for prediction markets.
 *
 * Aggregates micro bets into batches and submits them periodically to the
 * AgentReputationMarket contract. Reduces gas costs by batching many small
 * bets into single on-chain transactions every 30 seconds.
 */

const { ethers } = require('ethers');

const RPC_URL = process.env.ARC_RPC_URL || process.env.RPC_URL || 'https://rpc.testnet.arc.network';
const OPERATOR_KEY = process.env.DEPLOYER_PRIVATE_KEY || process.env.OPERATOR_PRIVATE_KEY || '';
const REPUTATION_MARKET_ADDRESS = '0x64FfE155fa71669cFFE5C5a9faB3Ad67480f0b74';
const USDC_ADDRESS = process.env.USDC_ADDRESS || process.env.USDC_CONTRACT || '0x3600000000000000000000000000000000000000';

// Flush interval: 30 seconds
const FLUSH_INTERVAL_MS = 30 * 1000;

// Minimal ABIs
const REPUTATION_MARKET_ABI = [
  'function placeBet(uint256 marketId, bool forAbove, uint256 amount) external',
  'function placeBatchBets(uint256 marketId, bool forAbove, uint256 totalAmount, address[] calldata bettors) external',
  'function getMarket(uint256 marketId) external view returns (uint256 totalAbove, uint256 totalBelow, uint256 deadline, bool resolved, uint256 outcome)',
  'function resolveMarket(uint256 marketId, uint256 outcome) external',
  'event BetPlaced(uint256 indexed marketId, address indexed bettor, bool forAbove, uint256 amount)',
  'event MarketResolved(uint256 indexed marketId, uint256 outcome)',
];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function balanceOf(address account) external view returns (uint256)',
];

class NanopaymentBettingService {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(RPC_URL);
    this.signer = OPERATOR_KEY
      ? new ethers.Wallet(OPERATOR_KEY, this.provider)
      : null;
    this.contract = this.signer
      ? new ethers.Contract(REPUTATION_MARKET_ADDRESS, REPUTATION_MARKET_ABI, this.signer)
      : null;

    // Pending bets: Map<batchKey, Array<BetRecord>>
    // batchKey format: "marketId:forAbove" (e.g., "1:true")
    this._pendingBets = new Map();

    // Settled bets history
    this._settledBatches = [];

    // Bet ID counter
    this._nextBetId = 1;

    // Flush timer reference
    this._flushTimer = null;

    // Stats
    this._stats = {
      totalBetsReceived: 0,
      totalBatchesFlushed: 0,
      totalAmountFlushed: 0,
      lastFlushAt: null,
    };
  }

  /**
   * Start the periodic flush timer (every 30 seconds).
   */
  startAutoFlush() {
    if (this._flushTimer) {
      console.log('[NanopaymentBetting] Auto-flush already running');
      return;
    }

    this._flushTimer = setInterval(async () => {
      try {
        await this.flushPendingBets();
      } catch (err) {
        console.error('[NanopaymentBetting] Auto-flush error:', err.message);
      }
    }, FLUSH_INTERVAL_MS);

    console.log(`[NanopaymentBetting] Auto-flush started (every ${FLUSH_INTERVAL_MS / 1000}s)`);
  }

  /**
   * Stop the periodic flush timer.
   */
  stopAutoFlush() {
    if (this._flushTimer) {
      clearInterval(this._flushTimer);
      this._flushTimer = null;
      console.log('[NanopaymentBetting] Auto-flush stopped');
    }
  }

  /**
   * Place a micro bet into the aggregation queue.
   * @param {string|number} marketId - Prediction market ID.
   * @param {boolean} forAbove - True to bet for above threshold, false for below.
   * @param {string|number} amountUsdc - Bet amount in USDC (human-readable).
   * @param {string} userAddress - Bettor's wallet address.
   * @returns {object} Bet receipt.
   */
  placeMicroBet(marketId, forAbove, amountUsdc, userAddress) {
    try {
      if (marketId === undefined || marketId === null) {
        throw new Error('marketId is required');
      }
      if (typeof forAbove !== 'boolean') {
        throw new Error('forAbove must be a boolean');
      }
      const amount = parseFloat(amountUsdc);
      if (isNaN(amount) || amount <= 0) {
        throw new Error('amountUsdc must be a positive number');
      }
      if (!userAddress || typeof userAddress !== 'string') {
        throw new Error('userAddress is required');
      }

      const batchKey = `${marketId}:${forAbove}`;

      if (!this._pendingBets.has(batchKey)) {
        this._pendingBets.set(batchKey, []);
      }

      const betId = `bet-${this._nextBetId++}`;
      const bet = {
        betId,
        marketId: String(marketId),
        forAbove,
        amountUsdc: amount,
        userAddress,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      this._pendingBets.get(batchKey).push(bet);
      this._stats.totalBetsReceived++;

      console.log(`[NanopaymentBetting] Micro bet queued: betId=${betId}, market=${marketId}, forAbove=${forAbove}, amount=${amount} USDC`);

      return {
        betId,
        marketId: String(marketId),
        forAbove,
        amountUsdc: amount,
        userAddress,
        status: 'pending',
        batchKey,
        pendingInBatch: this._pendingBets.get(batchKey).length,
        createdAt: bet.createdAt,
      };
    } catch (err) {
      console.error('[NanopaymentBetting] placeMicroBet failed:', err.message);
      throw new Error(`Micro bet placement failed: ${err.message}`);
    }
  }

  /**
   * Flush all pending bets by batch-submitting to the contract.
   * Groups bets by (marketId, forAbove) and submits each group as a batch.
   * @returns {Promise<object>} Flush results.
   */
  async flushPendingBets() {
    const batchKeys = Array.from(this._pendingBets.keys());

    if (batchKeys.length === 0) {
      console.log('[NanopaymentBetting] No pending bets to flush');
      return { flushed: 0, batches: [] };
    }

    const results = [];

    for (const batchKey of batchKeys) {
      const bets = this._pendingBets.get(batchKey);
      if (!bets || bets.length === 0) continue;

      const [marketId, forAboveStr] = batchKey.split(':');
      const forAbove = forAboveStr === 'true';
      const totalAmount = bets.reduce((sum, b) => sum + b.amountUsdc, 0);
      const bettorAddresses = bets.map((b) => b.userAddress);

      let txHash = null;
      let status = 'submitted';

      if (this.contract && this.signer) {
        try {
          const totalAmountWei = ethers.parseUnits(totalAmount.toFixed(6), 6);

          // Approve USDC spending
          const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, this.signer);
          const approveTx = await usdc.approve(REPUTATION_MARKET_ADDRESS, totalAmountWei);
          await approveTx.wait();

          // Try batch submission first, fall back to individual
          try {
            const tx = await this.contract.placeBatchBets(
              marketId,
              forAbove,
              totalAmountWei,
              bettorAddresses
            );
            const receipt = await tx.wait();
            txHash = receipt.hash;
            console.log(`[NanopaymentBetting] Batch submitted on-chain: market=${marketId}, bets=${bets.length}, tx=${txHash}`);
          } catch {
            // Fallback: single aggregated bet
            console.log('[NanopaymentBetting] Batch method unavailable, using single bet');
            const tx = await this.contract.placeBet(marketId, forAbove, totalAmountWei);
            const receipt = await tx.wait();
            txHash = receipt.hash;
            console.log(`[NanopaymentBetting] Aggregated bet on-chain: market=${marketId}, tx=${txHash}`);
          }
        } catch (err) {
          console.error(`[NanopaymentBetting] On-chain flush failed for batch ${batchKey}:`, err.message);
          status = 'failed';
        }
      } else {
        // Dev mode: simulate submission
        txHash = `0xdev_${Date.now().toString(16)}_${batchKey.replace(':', '_')}`;
        console.log(`[NanopaymentBetting] Batch flushed (dev mode): market=${marketId}, bets=${bets.length}, total=${totalAmount} USDC`);
      }

      // Mark bets as settled
      for (const bet of bets) {
        bet.status = status === 'submitted' ? 'settled' : 'failed';
        bet.settledAt = new Date().toISOString();
        bet.batchTxHash = txHash;
      }

      const batchResult = {
        batchKey,
        marketId,
        forAbove,
        betCount: bets.length,
        totalAmountUsdc: parseFloat(totalAmount.toFixed(6)),
        bettorAddresses,
        txHash,
        status,
        flushedAt: new Date().toISOString(),
      };

      results.push(batchResult);
      this._settledBatches.push(batchResult);

      // Clear the pending batch
      this._pendingBets.delete(batchKey);
    }

    this._stats.totalBatchesFlushed += results.length;
    this._stats.totalAmountFlushed += results.reduce((sum, r) => sum + r.totalAmountUsdc, 0);
    this._stats.lastFlushAt = new Date().toISOString();

    console.log(`[NanopaymentBetting] Flush complete: ${results.length} batches processed`);

    return {
      flushed: results.length,
      batches: results,
      stats: { ...this._stats },
    };
  }

  /**
   * Get pending bets summary.
   * @returns {object} Pending bets summary.
   */
  getPendingBetsSummary() {
    const batches = [];
    for (const [batchKey, bets] of this._pendingBets) {
      const [marketId, forAboveStr] = batchKey.split(':');
      batches.push({
        batchKey,
        marketId,
        forAbove: forAboveStr === 'true',
        betCount: bets.length,
        totalAmountUsdc: parseFloat(bets.reduce((sum, b) => sum + b.amountUsdc, 0).toFixed(6)),
      });
    }

    return {
      totalPendingBatches: batches.length,
      totalPendingBets: batches.reduce((sum, b) => sum + b.betCount, 0),
      batches,
      stats: { ...this._stats },
    };
  }

  /**
   * Get market info from the contract.
   * @param {string|number} marketId - Market ID.
   * @returns {Promise<object>} Market info.
   */
  async getMarketInfo(marketId) {
    try {
      if (this.contract) {
        const raw = await this.contract.getMarket(marketId);
        return {
          marketId: String(marketId),
          totalAbove: ethers.formatUnits(raw.totalAbove, 6),
          totalBelow: ethers.formatUnits(raw.totalBelow, 6),
          deadline: Number(raw.deadline),
          resolved: raw.resolved,
          outcome: Number(raw.outcome),
          contract: REPUTATION_MARKET_ADDRESS,
        };
      }

      // Dev fallback
      return {
        marketId: String(marketId),
        totalAbove: '0.000000',
        totalBelow: '0.000000',
        deadline: Math.floor(Date.now() / 1000) + 86400,
        resolved: false,
        outcome: 0,
        contract: REPUTATION_MARKET_ADDRESS,
        note: 'Dev mode - no on-chain data available',
      };
    } catch (err) {
      console.error(`[NanopaymentBetting] getMarketInfo failed:`, err.message);
      throw new Error(`Market info retrieval failed: ${err.message}`);
    }
  }
}

module.exports = NanopaymentBettingService;
