/**
 * Pipeline Routes - DAG-based pipeline orchestration.
 * Allows creation of multi-step pipelines, status tracking,
 * and AI-powered task decomposition into sub-tasks.
 *
 * Integrates with OrchestratorAgent for DeepSeek-powered DAG decomposition.
 */

const express = require('express');
const router = express.Router();
const OrchestratorAgent = require('../agents/orchestrator.agent');

// Singleton orchestrator instance
const orchestrator = new OrchestratorAgent();
orchestrator.start();

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

/**
 * @type {Map<string, {
 *   pipelineId: string,
 *   name: string,
 *   status: string,
 *   createdAt: string,
 *   updatedAt: string,
 *   steps: Array<{ stepId: string, name: string, capability: string, status: string, dependsOn: string[], result: any }>,
 *   metadata: object
 * }>}
 */
const pipelines = new Map();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Compute aggregate pipeline status from its steps.
 */
function computePipelineStatus(pipeline) {
  const statuses = pipeline.steps.map((s) => s.status);
  if (statuses.every((s) => s === 'completed')) return 'completed';
  if (statuses.some((s) => s === 'failed')) return 'failed';
  if (statuses.some((s) => s === 'running')) return 'running';
  return 'pending';
}

/**
 * AI-powered task decomposition via OrchestratorAgent (DeepSeek).
 * Decomposes a task description into a DAG of subtasks using the AI agent.
 * Falls back to a simple single-node DAG if AI is unavailable.
 *
 * @param {string} pipelineId - The pipeline ID to associate with the DAG.
 * @param {string} description - Task description to decompose.
 * @param {object} hints - Optional hints (capability, budget, constraints).
 * @returns {Promise<Array>} Array of step objects.
 */
async function decomposeTask(pipelineId, description, hints) {
  const totalBudget = hints?.budget || 100; // default budget in USDC
  const taskSpec = {
    description,
    capabilities: hints?.capability ? [hints.capability] : [],
    constraints: hints?.constraints || {},
  };

  try {
    const pipeline = await orchestrator.decomposeTask(pipelineId, taskSpec, totalBudget);

    if (pipeline.dag && pipeline.dag.nodes && pipeline.dag.nodes.length > 0) {
      return pipeline.dag.nodes.map((node, idx) => ({
        stepId: generateId('step'),
        name: node.name,
        capability: node.capability || 'general',
        status: 'pending',
        dependsOn: (node.dependencies || []).map((depId) => {
          const depNode = pipeline.dag.nodes.find((n) => n.id === depId);
          return depNode ? depNode.name : depId;
        }),
        budgetUsdc: node.budgetUsdc || 0,
        result: null,
      }));
    }
  } catch (err) {
    console.warn(`[Pipeline] OrchestratorAgent decomposition failed: ${err.message}, using fallback`);
  }

  // Fallback: generate logical steps from description
  const capability = hints?.capability || 'text-generation';
  const fallbackSteps = [
    { name: 'Analyze requirements', capability: 'data-analysis', budget: totalBudget * 0.15 },
    { name: 'Execute core task', capability, budget: totalBudget * 0.50 },
    { name: 'Validate output', capability: 'code-review', budget: totalBudget * 0.20 },
    { name: 'Summarize results', capability: 'text-generation', budget: totalBudget * 0.15 },
  ];

  return fallbackSteps.map((t, idx) => ({
    stepId: generateId('step'),
    name: t.name,
    capability: t.capability,
    status: 'pending',
    dependsOn: idx === 0 ? [] : [fallbackSteps[idx - 1].name],
    budgetUsdc: t.budget,
    result: null,
  }));
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * POST /pipeline/create
 * Create a new pipeline with a list of steps.
 * Body: { name, steps: [{ name, capability, dependsOn? }], metadata? }
 */
router.post('/create', async (req, res, next) => {
  try {
    const { name, steps, metadata } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!steps || !Array.isArray(steps) || steps.length === 0) {
      return res.status(400).json({ error: 'steps must be a non-empty array' });
    }

    const pipelineId = generateId('pipe');

    const normalizedSteps = steps.map((s) => ({
      stepId: generateId('step'),
      name: s.name || 'Unnamed Step',
      capability: s.capability || 'general',
      status: 'pending',
      dependsOn: s.dependsOn || [],
      result: null,
    }));

    const pipeline = {
      pipelineId,
      name,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      steps: normalizedSteps,
      metadata: metadata || {},
    };

    pipelines.set(pipelineId, pipeline);

    // Notify via WebSocket if available
    if (req.app.locals.wsNotify) {
      req.app.locals.wsNotify('pipeline:created', {
        type: 'pipeline_created',
        event: 'pipeline_created',
        pipelineId,
        name,
        stepCount: normalizedSteps.length,
      });
    }

    res.status(201).json({
      success: true,
      pipelineId,
      name,
      status: 'pending',
      stepCount: normalizedSteps.length,
      createdAt: pipeline.createdAt,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /pipeline/:pipelineId
 * Get pipeline status, progress, and step details.
 */
router.get('/:pipelineId', async (req, res, next) => {
  try {
    const { pipelineId } = req.params;
    const pipeline = pipelines.get(pipelineId);

    if (!pipeline) {
      return res.status(404).json({ error: `Pipeline ${pipelineId} not found` });
    }

    pipeline.status = computePipelineStatus(pipeline);

    const completed = pipeline.steps.filter((s) => s.status === 'completed').length;
    const progress = pipeline.steps.length > 0
      ? Math.round((completed / pipeline.steps.length) * 100)
      : 0;

    res.json({
      success: true,
      pipeline: {
        ...pipeline,
        progress: `${progress}%`,
        completedSteps: completed,
        totalSteps: pipeline.steps.length,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /pipeline/:pipelineId/decompose
 * Trigger AI task decomposition on an existing pipeline.
 * Replaces the pipeline's steps with AI-generated sub-tasks.
 * Body: { description, hints? }
 */
router.post('/:pipelineId/decompose', async (req, res, next) => {
  try {
    const { pipelineId } = req.params;
    const { description, hints } = req.body;

    const pipeline = pipelines.get(pipelineId);

    if (!pipeline) {
      return res.status(404).json({ error: `Pipeline ${pipelineId} not found` });
    }
    if (!description) {
      return res.status(400).json({ error: 'description is required for AI decomposition' });
    }

    const decomposedSteps = await decomposeTask(pipelineId, description, hints);
    pipeline.steps = decomposedSteps;
    pipeline.status = 'pending';
    pipeline.updatedAt = new Date().toISOString();
    pipeline.metadata.decomposedFrom = description;

    // Notify via WebSocket if available
    if (req.app.locals.wsNotify) {
      req.app.locals.wsNotify('pipeline:decomposed', {
        type: 'pipeline_decomposed',
        event: 'pipeline_decomposed',
        pipelineId,
        stepCount: decomposedSteps.length,
      });
    }

    res.json({
      success: true,
      pipelineId,
      status: 'pending',
      decomposedSteps: decomposedSteps.length,
      steps: decomposedSteps,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
