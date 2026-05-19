/**
 * Discovery Routes - agent search and filtering endpoints.
 */

const express = require('express');
const router = express.Router();
const DiscoveryService = require('../services/discovery.service');

const discovery = new DiscoveryService();

/**
 * GET /search
 * Search for agents with query parameters.
 * Query params: q, capability, maxPrice, minScore, limit
 */
router.get('/search', async (req, res, next) => {
  try {
    const {
      q,
      capability,
      maxPrice,
      minScore,
      limit,
    } = req.query;

    const results = await discovery.smartSearch({
      q: q || undefined,
      capability: capability || undefined,
      maxPrice: maxPrice !== undefined ? Number(maxPrice) : undefined,
      minScore: minScore !== undefined ? Number(minScore) : undefined,
      limit: limit ? parseInt(limit, 10) : 20,
    });

    res.json({
      success: true,
      count: results.length,
      query: { q, capability, maxPrice, minScore, limit },
      results,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
