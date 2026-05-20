import React, { useState } from 'react';
import {
  createPipeline,
  getPipelineStatus,
  decomposePipeline,
} from '../services/api';

const NODE_STATUS_COLORS = {
  pending: 'bg-gray-100 text-gray-800 border-gray-300',
  running: 'bg-blue-100 text-blue-800 border-blue-400',
  completed: 'bg-green-100 text-green-800 border-green-400',
  failed: 'bg-red-100 text-red-800 border-red-400',
};

const PIPELINE_STATUS_COLORS = {
  pending: 'bg-gray-100 text-gray-800',
  running: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
};

const PROGRESS_COLORS = {
  pending: 'bg-gray-400',
  running: 'bg-blue-500',
  completed: 'bg-green-500',
  failed: 'bg-red-500',
};

/* --- DAG Visualization Component --- */
function DAGVisualization({ nodes }) {
  if (!nodes || nodes.length === 0) return null;

  // Build adjacency: group nodes into layers by dependency depth
  const nodeMap = {};
  nodes.forEach((n) => { nodeMap[n.id || n.name] = n; });

  const getDepth = (node, visited = new Set()) => {
    const key = node.id || node.name;
    if (visited.has(key)) return 0;
    visited.add(key);
    if (!node.dependencies || node.dependencies.length === 0) return 0;
    return 1 + Math.max(
      ...node.dependencies.map((depId) => {
        const dep = nodeMap[depId];
        return dep ? getDepth(dep, visited) : 0;
      })
    );
  };

  const layers = {};
  nodes.forEach((node) => {
    const depth = getDepth(node);
    if (!layers[depth]) layers[depth] = [];
    layers[depth].push(node);
  });

  const sortedDepths = Object.keys(layers).map(Number).sort((a, b) => a - b);

  return (
    <div className="mt-4">
      <h4 className="text-sm font-semibold mb-3">DAG Visualization</h4>
      <div className="flex flex-col items-center space-y-2">
        {sortedDepths.map((depth, layerIdx) => (
          <React.Fragment key={depth}>
            {layerIdx > 0 && (
              <div className="flex justify-center">
                <div className="w-px h-6 bg-gray-400" />
              </div>
            )}
            <div className="flex flex-wrap justify-center gap-3">
              {layers[depth].map((node) => {
                const key = node.id || node.name;
                const status = node.status || 'pending';
                const colorClass = NODE_STATUS_COLORS[status] || NODE_STATUS_COLORS.pending;
                return (
                  <div
                    key={key}
                    className={`relative border-2 rounded-lg px-4 py-2 min-w-[140px] text-center ${colorClass}`}
                  >
                    <div className="text-sm font-semibold">{node.name || key}</div>
                    {node.capability && (
                      <div className="text-xs opacity-75 mt-0.5">{node.capability}</div>
                    )}
                    <div className="text-xs mt-1 font-medium capitalize">{status}</div>
                    {node.assignedAgent && (
                      <div className="text-xs font-mono mt-0.5 truncate max-w-[130px]" title={node.assignedAgent}>
                        {node.assignedAgent.slice(0, 8)}...
                      </div>
                    )}
                    {node.budget != null && (
                      <div className="text-xs mt-0.5">{node.budget} USDC</div>
                    )}
                    {node.dependencies && node.dependencies.length > 0 && (
                      <div className="text-xs opacity-60 mt-1">
                        deps: {node.dependencies.join(', ')}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

/* --- Main Component --- */
export default function Pipelines() {
  const [activeTab, setActiveTab] = useState('create');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  // Create Pipeline form state
  const [pipelineForm, setPipelineForm] = useState({
    name: '',
    orchestratorAddress: '',
    totalBudget: '',
  });
  const [steps, setSteps] = useState([
    { name: '', capability: '', budget: '' },
  ]);

  // Status section state
  const [statusPipelineId, setStatusPipelineId] = useState('');
  const [pipelineStatus, setPipelineStatus] = useState(null);

  // Decompose section state
  const [decomposeForm, setDecomposeForm] = useState({
    pipelineId: '',
    taskDescription: '',
  });
  const [decomposedDAG, setDecomposedDAG] = useState(null);

  /* --- Step Builder Helpers --- */
  const addStep = () => {
    setSteps([...steps, { name: '', capability: '', budget: '' }]);
  };

  const removeStep = (index) => {
    if (steps.length <= 1) return;
    setSteps(steps.filter((_, i) => i !== index));
  };

  const updateStep = (index, field, value) => {
    const updated = steps.map((s, i) => (i === index ? { ...s, [field]: value } : s));
    setSteps(updated);
  };

  /* --- Handlers --- */
  const handleCreatePipeline = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await createPipeline({
        name: pipelineForm.name,
        orchestratorAddress: pipelineForm.orchestratorAddress,
        totalBudget: pipelineForm.totalBudget,
        steps: steps.map((s) => ({
          name: s.name,
          capability: s.capability,
          budget: s.budget,
        })),
      });
      setResult(res);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const handleGetStatus = async () => {
    if (!statusPipelineId) return;
    setLoading(true);
    setError('');
    setPipelineStatus(null);
    try {
      const res = await getPipelineStatus(statusPipelineId);
      setPipelineStatus(res);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const handleDecompose = async (e) => {
    e.preventDefault();
    if (!decomposeForm.pipelineId || !decomposeForm.taskDescription) return;
    setLoading(true);
    setError('');
    setDecomposedDAG(null);
    try {
      const res = await decomposePipeline(decomposeForm.pipelineId, {
        taskDescription: decomposeForm.taskDescription,
      });
      setDecomposedDAG(res);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  /* --- Progress Helpers --- */
  const getProgressPercent = (status) => {
    if (!status || !status.nodes) return 0;
    const total = status.nodes.length;
    if (total === 0) return 0;
    const completed = status.nodes.filter((n) => n.status === 'completed').length;
    return Math.round((completed / total) * 100);
  };

  const tabs = [
    { id: 'create', label: 'Create Pipeline' },
    { id: 'status', label: 'Pipeline Status' },
    { id: 'decompose', label: 'AI Decomposition' },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-2">Pipeline Orchestration</h1>
      <p className="text-gray-500 mb-6">
        DAG-based pipeline orchestration for complex multi-step tasks
      </p>

      {/* Tabs */}
      <div className="flex space-x-1 mb-6 border-b border-gray-200">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setError(''); setResult(null); }}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg ${
              activeTab === tab.id
                ? 'bg-primary-50 text-primary-700 border-b-2 border-primary-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* ==================== CREATE PIPELINE TAB ==================== */}
      {activeTab === 'create' && (
        <form onSubmit={handleCreatePipeline} className="space-y-4">
          <h2 className="text-xl font-semibold">Create Pipeline</h2>
          <p className="text-gray-500 text-sm">
            Define a multi-step pipeline with budget allocations per step. Steps form a DAG
            that the orchestrator executes in dependency order.
          </p>

          <div>
            <label className="block text-sm font-medium mb-1">Pipeline Name</label>
            <input
              type="text"
              className="w-full border rounded p-2 text-sm"
              value={pipelineForm.name}
              onChange={(e) => setPipelineForm({ ...pipelineForm, name: e.target.value })}
              placeholder="e.g. Data Processing Pipeline"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Orchestrator Address</label>
            <input
              type="text"
              className="w-full border rounded p-2 text-sm font-mono"
              value={pipelineForm.orchestratorAddress}
              onChange={(e) => setPipelineForm({ ...pipelineForm, orchestratorAddress: e.target.value })}
              placeholder="0x..."
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Total Budget (USDC)</label>
            <input
              type="number"
              step="0.01"
              className="w-full border rounded p-2 text-sm"
              value={pipelineForm.totalBudget}
              onChange={(e) => setPipelineForm({ ...pipelineForm, totalBudget: e.target.value })}
              placeholder="100.00"
              required
            />
          </div>

          {/* Steps Builder */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium">Pipeline Steps</label>
              <button
                type="button"
                onClick={addStep}
                className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1 rounded"
              >
                + Add Step
              </button>
            </div>

            <div className="space-y-3">
              {steps.map((step, idx) => (
                <div key={idx} className="border rounded p-3 bg-gray-50">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-gray-500">Step {idx + 1}</span>
                    {steps.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeStep(idx)}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-xs text-gray-500 mb-0.5">Step Name</label>
                      <input
                        type="text"
                        className="w-full border rounded p-1.5 text-sm"
                        value={step.name}
                        onChange={(e) => updateStep(idx, 'name', e.target.value)}
                        placeholder="e.g. Data Scraping"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-0.5">Capability Needed</label>
                      <input
                        type="text"
                        className="w-full border rounded p-1.5 text-sm"
                        value={step.capability}
                        onChange={(e) => updateStep(idx, 'capability', e.target.value)}
                        placeholder="e.g. web-scraping"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-0.5">Budget (USDC)</label>
                      <input
                        type="number"
                        step="0.01"
                        className="w-full border rounded p-1.5 text-sm"
                        value={step.budget}
                        onChange={(e) => updateStep(idx, 'budget', e.target.value)}
                        placeholder="25.00"
                        required
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="bg-primary-600 text-white px-6 py-2 rounded hover:bg-primary-700 disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create Pipeline'}
          </button>
        </form>
      )}

      {/* ==================== PIPELINE STATUS TAB ==================== */}
      {activeTab === 'status' && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Pipeline Status</h2>
          <p className="text-gray-500 text-sm">
            Enter a pipeline ID to view its current status, progress, and node details.
          </p>

          <div className="flex space-x-2">
            <input
              type="text"
              className="flex-1 border rounded p-2 text-sm font-mono"
              value={statusPipelineId}
              onChange={(e) => setStatusPipelineId(e.target.value)}
              placeholder="Pipeline ID"
            />
            <button
              onClick={handleGetStatus}
              disabled={loading || !statusPipelineId}
              className="bg-gray-700 text-white px-4 py-2 rounded hover:bg-gray-800 disabled:opacity-50 text-sm"
            >
              {loading ? 'Loading...' : 'Query'}
            </button>
          </div>

          {pipelineStatus && (
            <div className="bg-gray-50 rounded p-4 text-sm space-y-4">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-semibold text-base">
                    {pipelineStatus.name || `Pipeline #${pipelineStatus.pipelineId || statusPipelineId}`}
                  </span>
                </div>
                <span className={`px-2 py-1 rounded text-xs font-medium ${
                  PIPELINE_STATUS_COLORS[pipelineStatus.status] || 'bg-gray-100'
                }`}>
                  {pipelineStatus.status}
                </span>
              </div>

              {/* Progress Bar */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-gray-500">Progress</span>
                  <span className="font-medium">{getProgressPercent(pipelineStatus)}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2.5">
                  <div
                    className={`h-2.5 rounded-full transition-all duration-500 ${
                      PROGRESS_COLORS[pipelineStatus.status] || 'bg-gray-400'
                    }`}
                    style={{ width: `${getProgressPercent(pipelineStatus)}%` }}
                  />
                </div>
              </div>

              {/* Pipeline Info */}
              {pipelineStatus.totalBudget != null && (
                <div>
                  <span className="text-gray-500">Total Budget:</span>{' '}
                  <span className="font-medium">{pipelineStatus.totalBudget} USDC</span>
                </div>
              )}
              {pipelineStatus.orchestratorAddress && (
                <div>
                  <span className="text-gray-500">Orchestrator:</span>{' '}
                  <span className="font-mono text-xs">{pipelineStatus.orchestratorAddress}</span>
                </div>
              )}

              {/* Node List */}
              {pipelineStatus.nodes && pipelineStatus.nodes.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold mb-2">Nodes ({pipelineStatus.nodes.length})</h4>
                  <div className="space-y-2">
                    {pipelineStatus.nodes.map((node, idx) => {
                      const nodeKey = node.id || node.name || idx;
                      const status = node.status || 'pending';
                      return (
                        <div
                          key={nodeKey}
                          className={`border rounded p-3 ${NODE_STATUS_COLORS[status] || NODE_STATUS_COLORS.pending}`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-sm">{node.name || nodeKey}</span>
                            <span className="text-xs font-medium capitalize">{status}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-1 text-xs">
                            {node.capability && (
                              <div><span className="opacity-70">Capability:</span> {node.capability}</div>
                            )}
                            {node.budget != null && (
                              <div><span className="opacity-70">Budget:</span> {node.budget} USDC</div>
                            )}
                            {node.assignedAgent && (
                              <div>
                                <span className="opacity-70">Agent:</span>{' '}
                                <span className="font-mono">{node.assignedAgent.slice(0, 10)}...</span>
                              </div>
                            )}
                            {node.dependencies && node.dependencies.length > 0 && (
                              <div>
                                <span className="opacity-70">Depends on:</span>{' '}
                                {node.dependencies.join(', ')}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* DAG Visualization */}
              {pipelineStatus.nodes && pipelineStatus.nodes.length > 0 && (
                <DAGVisualization nodes={pipelineStatus.nodes} />
              )}
            </div>
          )}
        </div>
      )}

      {/* ==================== AI DECOMPOSITION TAB ==================== */}
      {activeTab === 'decompose' && (
        <form onSubmit={handleDecompose} className="space-y-4">
          <h2 className="text-xl font-semibold">AI Task Decomposition</h2>
          <p className="text-gray-500 text-sm">
            Provide a high-level task description and let AI decompose it into a DAG of
            sub-tasks with dependencies and capability requirements.
          </p>

          <div>
            <label className="block text-sm font-medium mb-1">Pipeline ID</label>
            <input
              type="text"
              className="w-full border rounded p-2 text-sm font-mono"
              value={decomposeForm.pipelineId}
              onChange={(e) => setDecomposeForm({ ...decomposeForm, pipelineId: e.target.value })}
              placeholder="Pipeline ID"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Task Description</label>
            <textarea
              className="w-full border rounded p-2 text-sm"
              rows={4}
              value={decomposeForm.taskDescription}
              onChange={(e) => setDecomposeForm({ ...decomposeForm, taskDescription: e.target.value })}
              placeholder="Describe the complex task to decompose into sub-tasks...&#10;e.g. Scrape product data from 3 competitor sites, normalize the data, run sentiment analysis on reviews, and generate a comparison report."
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading || !decomposeForm.pipelineId || !decomposeForm.taskDescription}
            className="bg-primary-600 text-white px-6 py-2 rounded hover:bg-primary-700 disabled:opacity-50"
          >
            {loading ? 'Decomposing...' : 'Decompose Task'}
          </button>

          {decomposedDAG && (
            <div className="bg-gray-50 rounded p-4 text-sm space-y-3">
              <h3 className="font-semibold">Decomposition Result</h3>

              {decomposedDAG.steps && decomposedDAG.steps.length > 0 && (
                <div className="space-y-2">
                  {decomposedDAG.steps.map((step, idx) => (
                    <div key={step.id || step.name || idx} className="border rounded p-3 bg-white">
                      <div className="font-semibold text-sm">{step.name || `Step ${idx + 1}`}</div>
                      {step.description && (
                        <div className="text-xs text-gray-600 mt-0.5">{step.description}</div>
                      )}
                      <div className="flex flex-wrap gap-2 mt-1 text-xs">
                        {step.capability && (
                          <span className="bg-purple-50 text-purple-700 px-2 py-0.5 rounded">
                            {step.capability}
                          </span>
                        )}
                        {step.budget != null && (
                          <span className="bg-yellow-50 text-yellow-700 px-2 py-0.5 rounded">
                            {step.budget} USDC
                          </span>
                        )}
                        {step.dependencies && step.dependencies.length > 0 && (
                          <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                            deps: {step.dependencies.join(', ')}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* DAG Visualization for decomposed result */}
              {decomposedDAG.steps && decomposedDAG.steps.length > 0 && (
                <DAGVisualization nodes={decomposedDAG.steps} />
              )}

              {/* Raw result fallback */}
              {!decomposedDAG.steps && (
                <pre className="text-xs overflow-x-auto whitespace-pre-wrap font-mono text-gray-700">
                  {JSON.stringify(decomposedDAG, null, 2)}
                </pre>
              )}
            </div>
          )}
        </form>
      )}

      {/* Result Display */}
      {result && (
        <div className="mt-6 bg-gray-50 rounded p-4">
          <h3 className="text-sm font-semibold mb-2">Result</h3>
          <pre className="text-xs overflow-x-auto whitespace-pre-wrap font-mono text-gray-700">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
