/**
 * ERC-8183 AgenticCommerce Job Routes
 *
 * Full lifecycle routes for ERC-8183 jobs on Arc Testnet:
 * Open -> Funded -> Submitted -> Completed/Rejected/Expired
 */

const { Router } = require('express');
const ArcNativeIdentityService = require('../services/arc-native-identity.service');

const router = Router();
const identityService = new ArcNativeIdentityService();

// --- ERC-8004 Identity Routes ---

/**
 * POST /api/arc/identity/register
 * Register an agent on ERC-8004 IdentityRegistry.
 */
router.post('/identity/register', async (req, res) => {
  try {
    const { name, description, capabilitySchemas, pricingModel, availabilityEndpoint, wallet } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const result = await identityService.registerAgentOnChain({
      name, description, capabilitySchemas, pricingModel, availabilityEndpoint, wallet,
    });

    req.app.locals.wsNotify?.('agent:registered', { event: 'erc8004_registered', ...result });
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/arc/identity/:agentId
 * Get agent identity from ERC-8004.
 */
router.get('/identity/:agentId', async (req, res) => {
  try {
    const result = await identityService.getAgentIdentity(req.params.agentId);
    res.json(result);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

/**
 * PUT /api/arc/identity/:agentId/metadata
 * Update agent metadata on ERC-8004.
 */
router.put('/identity/:agentId/metadata', async (req, res) => {
  try {
    const result = await identityService.updateAgentMetadata(req.params.agentId, req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ERC-8004 Reputation Routes ---

/**
 * POST /api/arc/reputation/feedback
 * Record reputation feedback for an agent on ReputationRegistry.
 */
router.post('/reputation/feedback', async (req, res) => {
  try {
    const { agentId, score, feedbackType, tag } = req.body;
    if (!agentId || score === undefined) {
      return res.status(400).json({ error: 'agentId and score are required' });
    }

    const result = await identityService.giveFeedback({ agentId, score, feedbackType, tag });
    req.app.locals.wsNotify?.('reputation:updated', { event: 'erc8004_feedback', ...result });
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ERC-8004 Validation Routes ---

/**
 * POST /api/arc/validation/request
 * Request validation for an agent on ValidationRegistry.
 */
router.post('/validation/request', async (req, res) => {
  try {
    const { agentId, requestURI, validatorAddress } = req.body;
    if (!agentId) return res.status(400).json({ error: 'agentId is required' });

    const result = await identityService.requestValidation({ agentId, requestURI, validatorAddress });
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/arc/validation/respond
 * Submit validation response on ValidationRegistry.
 */
router.post('/validation/respond', async (req, res) => {
  try {
    const { requestHash, responseCode, tag } = req.body;
    if (!requestHash || responseCode === undefined) {
      return res.status(400).json({ error: 'requestHash and responseCode are required' });
    }

    const result = await identityService.submitValidationResponse({ requestHash, responseCode, tag });
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/arc/validation/:requestHash
 * Get validation status for a request hash.
 */
router.get('/validation/:requestHash', async (req, res) => {
  try {
    const result = await identityService.getValidationStatus(req.params.requestHash);
    res.json(result);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// --- ERC-8183 Job Routes ---

/**
 * POST /api/arc/jobs
 * Create a new ERC-8183 job.
 */
router.post('/jobs', async (req, res) => {
  try {
    const { description, providerAddress, evaluatorAddress, deadline, hookAddress } = req.body;
    if (!description || !providerAddress) {
      return res.status(400).json({ error: 'description and providerAddress are required' });
    }

    const result = await identityService.createJob({
      description, providerAddress, evaluatorAddress,
      deadline: deadline || Math.floor(Date.now() / 1000) + 86400,
      hookAddress,
    });

    req.app.locals.wsNotify?.('job:created', { event: 'erc8183_job_created', ...result });
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/arc/jobs/:jobId/budget
 * Set budget for a job (provider role).
 */
router.post('/jobs/:jobId/budget', async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount) return res.status(400).json({ error: 'amount is required' });

    const result = await identityService.setBudget(req.params.jobId, amount);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/arc/jobs/:jobId/fund
 * Fund a job's escrow with USDC (client role).
 */
router.post('/jobs/:jobId/fund', async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount) return res.status(400).json({ error: 'amount is required' });

    const result = await identityService.fundJob(req.params.jobId, amount);
    req.app.locals.wsNotify?.('job:funded', { event: 'erc8183_job_funded', ...result });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/arc/jobs/:jobId/submit
 * Submit deliverable for a job (provider role).
 */
router.post('/jobs/:jobId/submit', async (req, res) => {
  try {
    const { deliverableData } = req.body;
    if (!deliverableData) return res.status(400).json({ error: 'deliverableData is required' });

    const result = await identityService.submitDeliverable(req.params.jobId, deliverableData);
    req.app.locals.wsNotify?.('job:submitted', { event: 'erc8183_deliverable_submitted', ...result });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/arc/jobs/:jobId/complete
 * Complete a job (evaluator/client role).
 */
router.post('/jobs/:jobId/complete', async (req, res) => {
  try {
    const result = await identityService.completeJob(req.params.jobId);
    req.app.locals.wsNotify?.('job:completed', { event: 'erc8183_job_completed', ...result });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/arc/jobs/:jobId/reject
 * Reject a deliverable (evaluator/client role).
 */
router.post('/jobs/:jobId/reject', async (req, res) => {
  try {
    const result = await identityService.rejectDeliverable(req.params.jobId);
    req.app.locals.wsNotify?.('job:rejected', { event: 'erc8183_deliverable_rejected', ...result });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/arc/jobs/:jobId
 * Get job details from ERC-8183.
 */
router.get('/jobs/:jobId', async (req, res) => {
  try {
    const result = await identityService.getJob(req.params.jobId);
    res.json(result);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// --- Full Lifecycle Demo Routes ---

/**
 * POST /api/arc/demo/identity-workflow
 * Execute full ERC-8004 identity workflow (7 steps).
 */
router.post('/demo/identity-workflow', async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const result = await identityService.executeFullIdentityWorkflow({ name, description });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/arc/demo/job-lifecycle
 * Execute full ERC-8183 job lifecycle.
 */
router.post('/demo/job-lifecycle', async (req, res) => {
  try {
    const { description, budget, deadline } = req.body;
    if (!description || !budget) {
      return res.status(400).json({ error: 'description and budget are required' });
    }

    const result = await identityService.executeFullJobLifecycle({
      description,
      budget,
      deadline: deadline || Math.floor(Date.now() / 1000) + 86400,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
