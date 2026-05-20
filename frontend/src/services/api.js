const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

async function request(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(error.message || error.error || 'API request failed');
  }
  return res.json();
}

// Registry - Agents
export const registerAgent = (data) =>
  request('/registry/register', { method: 'POST', body: JSON.stringify(data) });

export const getAgents = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/registry/agents${qs ? `?${qs}` : ''}`);
};

export const getAgent = (agentId) => request(`/registry/agents/${agentId}`);

export const updateAvailability = (agentId, data) =>
  request(`/registry/agents/${agentId}/availability`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });

// Discovery - Search
export const searchAgents = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/discovery/search${qs ? `?${qs}` : ''}`);
};

// Negotiation
export const proposeNegotiation = (data) =>
  request('/negotiation/propose', { method: 'POST', body: JSON.stringify(data) });

export const getNegotiationStatus = (negotiationId) =>
  request(`/negotiation/${negotiationId}/status`);

export const respondToNegotiation = (negotiationId, data) =>
  request(`/negotiation/${negotiationId}/respond`, { method: 'POST', body: JSON.stringify(data) });

// Escrow
export const depositEscrow = (data) =>
  request('/escrow/deposit', { method: 'POST', body: JSON.stringify(data) });

export const releaseEscrow = (taskId, data = {}) =>
  request(`/escrow/${taskId}/release`, { method: 'POST', body: JSON.stringify(data) });

export const disputeEscrow = (taskId, data) =>
  request(`/escrow/${taskId}/dispute`, { method: 'POST', body: JSON.stringify(data) });

export const getEscrowStatus = (taskId) => request(`/escrow/${taskId}/status`);

// Settlement
export const settleTask = (data) =>
  request('/settlement/settle', { method: 'POST', body: JSON.stringify(data) });

export const getSettlementStatus = (taskId) =>
  request(`/settlement/${taskId}/status`);

// Agent Investment Funds
export const createFund = (data) =>
  request('/fund/create', { method: 'POST', body: JSON.stringify(data) });

export const investInFund = (fundId, data) =>
  request(`/fund/${fundId}/invest`, { method: 'POST', body: JSON.stringify(data) });

export const getFund = (fundId) => request(`/fund/${fundId}`);

export const getFundByAgent = (agentId) => request(`/fund/agent/${agentId}`);

// Pipeline Orchestration
export const createPipeline = (data) =>
  request('/pipeline/create', { method: 'POST', body: JSON.stringify(data) });

export const getPipelineStatus = (pipelineId) => request(`/pipeline/${pipelineId}`);

export const decomposePipeline = (pipelineId, data) =>
  request(`/pipeline/${pipelineId}/decompose`, { method: 'POST', body: JSON.stringify(data) });

// Market Data & Prediction Markets
export const getMarketPrices = () => request('/market/prices');

export const getMarketTrades = () => request('/market/trades');

export const getPredictionMarkets = () => request('/market/prediction-markets');

export const getPredictionMarket = (marketId) => request(`/market/prediction-markets/${marketId}`);

export const placeBet = (marketId, data) =>
  request(`/market/prediction-markets/${marketId}/bet`, { method: 'POST', body: JSON.stringify(data) });

// Private Intent Matching
export const submitIntent = (data) =>
  request('/intent/submit', { method: 'POST', body: JSON.stringify(data) });

export const matchIntent = (intentId, data = {}) =>
  request(`/intent/${intentId}/match`, { method: 'POST', body: JSON.stringify(data) });

export const getIntentStatus = (intentId) => request(`/intent/${intentId}`);

// AI Decision Transparency
export const getAIDecisions = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/ai/decisions${qs ? `?${qs}` : ''}`);
};

export const getAIStatus = () => request('/ai/status');

export const recordAIDecision = (data) =>
  request('/ai/decisions', { method: 'POST', body: JSON.stringify(data) });

export const updateAIHeartbeat = (data) =>
  request('/ai/status', { method: 'POST', body: JSON.stringify(data) });

// Platform Stats
export const getPlatformStats = () => request('/stats');

export const getLiveStats = () => request('/stats/live');

// Faucet
export const claimFaucet = (data) =>
  request('/faucet/claim', { method: 'POST', body: JSON.stringify(data) });

export const getFaucetStatus = (walletAddress) => request(`/faucet/status/${walletAddress}`);

// Health check
export const getHealthStatus = () => request('/health');

// --- Arc Native Protocol (ERC-8004 + ERC-8183) ---

// ERC-8004 Identity
export const registerArcIdentity = (data) =>
  request('/arc/identity/register', { method: 'POST', body: JSON.stringify(data) });

export const getArcIdentity = (agentId) => request(`/arc/identity/${agentId}`);

export const updateArcMetadata = (agentId, data) =>
  request(`/arc/identity/${agentId}/metadata`, { method: 'PUT', body: JSON.stringify(data) });

// ERC-8004 Reputation
export const giveReputationFeedback = (data) =>
  request('/arc/reputation/feedback', { method: 'POST', body: JSON.stringify(data) });

// ERC-8004 Validation
export const requestValidation = (data) =>
  request('/arc/validation/request', { method: 'POST', body: JSON.stringify(data) });

export const respondValidation = (data) =>
  request('/arc/validation/respond', { method: 'POST', body: JSON.stringify(data) });

export const getValidationStatus = (requestHash) =>
  request(`/arc/validation/${requestHash}`);

// ERC-8183 Jobs
export const createArcJob = (data) =>
  request('/arc/jobs', { method: 'POST', body: JSON.stringify(data) });

export const setJobBudget = (jobId, data) =>
  request(`/arc/jobs/${jobId}/budget`, { method: 'POST', body: JSON.stringify(data) });

export const fundArcJob = (jobId, data) =>
  request(`/arc/jobs/${jobId}/fund`, { method: 'POST', body: JSON.stringify(data) });

export const submitJobDeliverable = (jobId, data) =>
  request(`/arc/jobs/${jobId}/submit`, { method: 'POST', body: JSON.stringify(data) });

export const completeArcJob = (jobId) =>
  request(`/arc/jobs/${jobId}/complete`, { method: 'POST' });

export const rejectJobDeliverable = (jobId) =>
  request(`/arc/jobs/${jobId}/reject`, { method: 'POST' });

export const getArcJob = (jobId) => request(`/arc/jobs/${jobId}`);

// Demo workflows
export const runIdentityWorkflow = (data) =>
  request('/arc/demo/identity-workflow', { method: 'POST', body: JSON.stringify(data) });

export const runJobLifecycle = (data) =>
  request('/arc/demo/job-lifecycle', { method: 'POST', body: JSON.stringify(data) });

export default {
  registerAgent,
  getAgents,
  getAgent,
  updateAvailability,
  searchAgents,
  proposeNegotiation,
  getNegotiationStatus,
  respondToNegotiation,
  depositEscrow,
  releaseEscrow,
  disputeEscrow,
  getEscrowStatus,
  settleTask,
  getSettlementStatus,
  createFund,
  investInFund,
  getFund,
  getFundByAgent,
  createPipeline,
  getPipelineStatus,
  decomposePipeline,
  getMarketPrices,
  getMarketTrades,
  getPredictionMarkets,
  getPredictionMarket,
  placeBet,
  submitIntent,
  matchIntent,
  getIntentStatus,
  getAIDecisions,
  getAIStatus,
  recordAIDecision,
  updateAIHeartbeat,
  getPlatformStats,
  getLiveStats,
  claimFaucet,
  getFaucetStatus,
  getHealthStatus,
  // Arc Native Protocol (ERC-8004 + ERC-8183)
  registerArcIdentity,
  getArcIdentity,
  updateArcMetadata,
  giveReputationFeedback,
  requestValidation,
  respondValidation,
  getValidationStatus,
  createArcJob,
  setJobBudget,
  fundArcJob,
  submitJobDeliverable,
  completeArcJob,
  rejectJobDeliverable,
  getArcJob,
  runIdentityWorkflow,
  runJobLifecycle,
};
