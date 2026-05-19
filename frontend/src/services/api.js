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

// Agents
export const getAgents = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/agents${qs ? `?${qs}` : ''}`);
};

export const getAgent = (id) => request(`/agents/${id}`);

export const registerAgent = (data) =>
  request('/agents', { method: 'POST', body: JSON.stringify(data) });

export const updateAgent = (id, data) =>
  request(`/agents/${id}`, { method: 'PUT', body: JSON.stringify(data) });

export const searchAgents = (query) =>
  request('/agents/search', { method: 'POST', body: JSON.stringify({ query }) });

// Tasks
export const getTasks = (params = {}) => {
  const qs = new URLSearchParams(params).toString();
  return request(`/tasks${qs ? `?${qs}` : ''}`);
};

export const getTask = (id) => request(`/tasks/${id}`);

export const createTask = (data) =>
  request('/tasks', { method: 'POST', body: JSON.stringify(data) });

export const updateTaskStatus = (id, status) =>
  request(`/tasks/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });

// Negotiations
export const getNegotiation = (taskId) => request(`/tasks/${taskId}/negotiation`);

export const submitNegotiationAction = (taskId, action) =>
  request(`/tasks/${taskId}/negotiation`, { method: 'POST', body: JSON.stringify(action) });

// Escrow
export const getEscrowStatus = (taskId) => request(`/tasks/${taskId}/escrow`);

export const lockEscrow = (taskId, amount) =>
  request(`/tasks/${taskId}/escrow/lock`, { method: 'POST', body: JSON.stringify({ amount }) });

export const releaseEscrow = (taskId) =>
  request(`/tasks/${taskId}/escrow/release`, { method: 'POST' });

export const disputeEscrow = (taskId, reason) =>
  request(`/tasks/${taskId}/escrow/dispute`, { method: 'POST', body: JSON.stringify({ reason }) });

// Dashboard
export const getDashboardStats = () => request('/dashboard/stats');
export const getEarnings = () => request('/dashboard/earnings');

export default {
  getAgents, getAgent, registerAgent, updateAgent, searchAgents,
  getTasks, getTask, createTask, updateTaskStatus,
  getNegotiation, submitNegotiationAction,
  getEscrowStatus, lockEscrow, releaseEscrow, disputeEscrow,
  getDashboardStats, getEarnings,
};
