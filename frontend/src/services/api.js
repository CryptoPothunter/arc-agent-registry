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
    throw new Error(error.message || 'API request failed');
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
};
