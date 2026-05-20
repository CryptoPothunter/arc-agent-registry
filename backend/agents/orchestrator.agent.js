/**
 * OrchestratorAgent - decomposes complex tasks into a DAG of subtasks,
 * monitors execution, and handles failure recovery.
 */

const EventEmitter = require('events');
const fetch = require('node-fetch');

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';

const PipelineStatus = {
  PLANNING: 'planning',
  RUNNING: 'running',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

class OrchestratorAgent extends EventEmitter {
  constructor() {
    super();
    this.name = 'OrchestratorAgent';
    this._pipelines = new Map();
  }

  /**
   * Start the orchestrator (no-op lifecycle hook for consistency).
   */
  start() {
    console.log(`[${this.name}] Ready`);
    this.emit('started');
  }

  /**
   * Decompose a complex task into a DAG of subtasks using AI.
   * @param {string} pipelineId
   * @param {object} taskSpec - { description, capabilities, constraints }
   * @param {number} totalBudget - total budget in USDC
   * @returns {Promise<object>} pipeline state with DAG
   */
  async decomposeTask(pipelineId, taskSpec, totalBudget) {
    const pipeline = {
      pipelineId,
      taskSpec,
      totalBudget,
      status: PipelineStatus.PLANNING,
      dag: null,
      createdAt: new Date().toISOString(),
      subtaskResults: {},
    };
    this._pipelines.set(pipelineId, pipeline);
    this.emit('planning', { pipelineId });

    const dag = await this._aiDecompose(taskSpec, totalBudget);

    if (!dag || !dag.nodes || !Array.isArray(dag.nodes)) {
      pipeline.status = PipelineStatus.FAILED;
      pipeline.error = 'AI decomposition returned invalid DAG';
      this.emit('error', { pipelineId, error: pipeline.error });
      return pipeline;
    }

    // Validate DAG
    const validation = this._validateDAG(dag, totalBudget);
    if (!validation.valid) {
      pipeline.status = PipelineStatus.FAILED;
      pipeline.error = validation.reason;
      this.emit('error', { pipelineId, error: pipeline.error });
      return pipeline;
    }

    pipeline.dag = dag;
    pipeline.status = PipelineStatus.RUNNING;
    this.emit('decomposed', { pipelineId, dag });
    return pipeline;
  }

  /**
   * Use DeepSeek to decompose a task specification into a DAG.
   * @private
   */
  async _aiDecompose(taskSpec, totalBudget) {
    const systemPrompt = `You are a task orchestrator for Arc Agent OS.
Decompose the given task into a directed acyclic graph (DAG) of subtasks.
Each node should have: id (string), name (string), capability (string), budgetUsdc (number), dependencies (array of node ids).
The sum of all budgetUsdc must not exceed the total budget.
Return JSON: { "nodes": [...], "edges": [{ "from": id, "to": id }] }`;

    const userMessage = JSON.stringify({
      task: taskSpec,
      totalBudget,
    });

    const result = await this._callDeepSeek(systemPrompt, userMessage, 800);

    if (result && result.nodes) return result;

    // Local fallback: single-node DAG
    return {
      nodes: [
        {
          id: 'task-1',
          name: taskSpec.description || 'Main task',
          capability: taskSpec.capabilities?.[0] || 'general',
          budgetUsdc: totalBudget,
          dependencies: [],
        },
      ],
      edges: [],
    };
  }

  /**
   * Validate DAG structure: no cycles, budget within limits.
   * @private
   */
  _validateDAG(dag, totalBudget) {
    const nodes = dag.nodes || [];
    const nodeIds = new Set(nodes.map(n => n.id));

    // Check budget
    const totalAllocated = nodes.reduce((sum, n) => sum + (n.budgetUsdc || 0), 0);
    if (totalAllocated > totalBudget) {
      return { valid: false, reason: `Total allocated budget (${totalAllocated}) exceeds limit (${totalBudget})` };
    }

    // Check for cycles using topological sort (Kahn's algorithm)
    const adj = new Map();
    const inDegree = new Map();
    for (const id of nodeIds) {
      adj.set(id, []);
      inDegree.set(id, 0);
    }
    for (const node of nodes) {
      for (const dep of (node.dependencies || [])) {
        if (!nodeIds.has(dep)) {
          return { valid: false, reason: `Dependency "${dep}" referenced by "${node.id}" does not exist` };
        }
        adj.get(dep).push(node.id);
        inDegree.set(node.id, (inDegree.get(node.id) || 0) + 1);
      }
    }

    const queue = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }
    let visited = 0;
    while (queue.length > 0) {
      const cur = queue.shift();
      visited++;
      for (const neighbor of adj.get(cur)) {
        inDegree.set(neighbor, inDegree.get(neighbor) - 1);
        if (inDegree.get(neighbor) === 0) queue.push(neighbor);
      }
    }

    if (visited !== nodeIds.size) {
      return { valid: false, reason: 'DAG contains a cycle' };
    }

    return { valid: true };
  }

  /**
   * Monitor pipeline execution and handle failures with retry/reassign.
   * @param {string} pipelineId
   */
  async monitorAndRecover(pipelineId) {
    const pipeline = this._pipelines.get(pipelineId);
    if (!pipeline) throw new Error(`Pipeline ${pipelineId} not found`);
    if (!pipeline.dag) throw new Error(`Pipeline ${pipelineId} has no DAG`);

    const nodes = pipeline.dag.nodes || [];

    for (const node of nodes) {
      const result = pipeline.subtaskResults[node.id];

      if (!result || result.status === 'pending') {
        continue; // not started yet
      }

      if (result.status === 'failed') {
        console.log(`[${this.name}] Subtask "${node.id}" failed in pipeline ${pipelineId}, attempting recovery`);
        this.emit('recovery', { pipelineId, nodeId: node.id, attempt: (result.retries || 0) + 1 });

        if ((result.retries || 0) < 2) {
          result.retries = (result.retries || 0) + 1;
          result.status = 'pending';
          console.log(`[${this.name}] Retrying subtask "${node.id}" (attempt ${result.retries})`);
        } else {
          console.error(`[${this.name}] Subtask "${node.id}" exhausted retries, marking pipeline failed`);
          pipeline.status = PipelineStatus.FAILED;
          pipeline.error = `Subtask "${node.id}" failed after ${result.retries} retries`;
          this.emit('pipeline_failed', { pipelineId, error: pipeline.error });
          return pipeline;
        }
      }
    }

    // Check if all complete
    const allDone = nodes.every(n => {
      const r = pipeline.subtaskResults[n.id];
      return r && r.status === 'completed';
    });

    if (allDone) {
      pipeline.status = PipelineStatus.COMPLETED;
      pipeline.completedAt = new Date().toISOString();
      this.emit('pipeline_completed', { pipelineId });
    }

    return pipeline;
  }

  /**
   * Get pipeline state.
   */
  getPipeline(pipelineId) {
    return this._pipelines.get(pipelineId) || null;
  }

  /**
   * Call DeepSeek AI API.
   * @private
   */
  async _callDeepSeek(systemPrompt, userMessage, maxTokens = 500) {
    if (!DEEPSEEK_API_KEY) return null;
    try {
      const response = await fetch(DEEPSEEK_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: typeof userMessage === 'string' ? userMessage : JSON.stringify(userMessage) },
          ],
          max_tokens: maxTokens,
          response_format: { type: 'json_object' },
        }),
      });
      if (!response.ok) {
        console.warn(`[${this.name}] DeepSeek API error: ${response.status}`);
        return null;
      }
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      return content ? JSON.parse(content) : null;
    } catch (err) {
      console.warn(`[${this.name}] DeepSeek call failed:`, err.message);
      return null;
    }
  }
}

module.exports = OrchestratorAgent;
