/**
 * Traction Stats Routes - live platform statistics.
 * Provides comprehensive and real-time metrics for the Arc Agent OS dashboard.
 * All data is derived from in-memory counters and periodic snapshots.
 */

const express = require('express');
const router = express.Router();

// ---------------------------------------------------------------------------
// In-memory stats store
// ---------------------------------------------------------------------------

const stats = {
  totalAgents: 0,
  activeAgents: 0,
  totalTasks: 0,
  completedTasks: 0,
  totalVolume: 0,         // USDC volume
  uniqueWallets: new Set(),
  activeMarkets: 0,
  bettingVolume: 0,
  lastUpdated: new Date().toISOString(),
};

/** Snapshot of previous stats for computing deltas */
let previousSnapshot = { ...stats, uniqueWallets: 0 };

/**
 * Increment helpers (can be called by other modules).
 */
function incrementStat(key, value = 1) {
  if (key === 'uniqueWallets' && typeof value === 'string') {
    stats.uniqueWallets.add(value);
  } else if (typeof stats[key] === 'number') {
    stats[key] += value;
  }
  stats.lastUpdated = new Date().toISOString();
}

function setStat(key, value) {
  if (key === 'uniqueWallets') return; // use incrementStat for wallets
  stats[key] = value;
  stats.lastUpdated = new Date().toISOString();
}

// Expose helpers for other modules
router._incrementStat = incrementStat;
router._setStat = setStat;

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /stats
 * Returns comprehensive platform statistics.
 */
router.get('/', async (req, res, next) => {
  try {
    const snapshot = {
      totalAgents: stats.totalAgents,
      activeAgents: stats.activeAgents,
      totalTasks: stats.totalTasks,
      completedTasks: stats.completedTasks,
      totalVolume: Math.round(stats.totalVolume * 100) / 100,
      uniqueWallets: stats.uniqueWallets.size,
      activeMarkets: stats.activeMarkets,
      bettingVolume: Math.round(stats.bettingVolume * 100) / 100,
      lastUpdated: stats.lastUpdated,
    };

    res.json({ success: true, stats: snapshot });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /stats/live
 * Returns real-time stats with deltas (change since last query).
 */
router.get('/live', async (req, res, next) => {
  try {
    const current = {
      totalAgents: stats.totalAgents,
      activeAgents: stats.activeAgents,
      totalTasks: stats.totalTasks,
      completedTasks: stats.completedTasks,
      totalVolume: Math.round(stats.totalVolume * 100) / 100,
      uniqueWallets: stats.uniqueWallets.size,
      activeMarkets: stats.activeMarkets,
      bettingVolume: Math.round(stats.bettingVolume * 100) / 100,
      lastUpdated: stats.lastUpdated,
    };

    const deltas = {
      totalAgents: current.totalAgents - (previousSnapshot.totalAgents || 0),
      activeAgents: current.activeAgents - (previousSnapshot.activeAgents || 0),
      totalTasks: current.totalTasks - (previousSnapshot.totalTasks || 0),
      completedTasks: current.completedTasks - (previousSnapshot.completedTasks || 0),
      totalVolume: Math.round((current.totalVolume - (previousSnapshot.totalVolume || 0)) * 100) / 100,
      uniqueWallets: current.uniqueWallets - (previousSnapshot.uniqueWallets || 0),
      activeMarkets: current.activeMarkets - (previousSnapshot.activeMarkets || 0),
      bettingVolume: Math.round((current.bettingVolume - (previousSnapshot.bettingVolume || 0)) * 100) / 100,
    };

    // Update snapshot for next delta computation
    previousSnapshot = { ...current };

    res.json({ success: true, stats: current, deltas, timestamp: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
