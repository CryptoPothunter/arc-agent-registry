/**
 * Pipeline Routes - DAG-based pipeline orchestration.
 * Allows creation of multi-step pipelines, status tracking,
 * and AI-powered task decomposition into sub-tasks.
 */

const express = require('express');
const router = express.Router();

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
 * Simple AI task decomposition stub.
 * In production this would call an LLM to break a goal into sub-tasks.
 */
function decomposeTask(description, hints) {
  const subtasks = [
    { name: 'Analyze requirements', capability: 'data-analysis' },
    { name: 'Execute core task', capability: hints?.capability || 'text-generation' },
    { name: 'Validate output', capability: 'code-review' },
    { name: 'Summarize results', capability: 'text-generation' },
  ];

  return subtasks.map((t, idx) => ({
    stepId: generateId('step'),
    name: t.name,
    capability: t.capability,
    status: 'pending',
    dependsOn: idx === 0 ? [] : [subtasks[idx - 1].name],
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

    const decomposedSteps = decomposeTask(description, hints);
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
