import React, { useState, useEffect, useCallback } from 'react';
import AgentCard from '../components/AgentCard';
import { searchAgents, getAgents } from '../services/api';
import useWebSocket from '../hooks/useWebSocket';

export default function Explore() {
  const [search, setSearch] = useState('');
  const [maxPrice, setMaxPrice] = useState(200);
  const [minReputation, setMinReputation] = useState(0);
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch agents from API
  const fetchAgents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = {};
      if (search) params.q = search;
      if (maxPrice < 200) params.maxPrice = maxPrice;
      if (minReputation > 0) params.minScore = minReputation;

      let result;
      if (search || maxPrice < 200 || minReputation > 0) {
        result = await searchAgents(params);
      } else {
        result = await getAgents();
      }

      let agentList = result.agents || result || [];

      // Normalize agent data for display
      agentList = agentList.map((a) => ({
        id: a.agentId || a.id,
        name: a.metadata?.name || a.name || `Agent ${a.agentId}`,
        description: a.metadata?.description || a.description || '',
        capabilities: a.capabilities || a.metadata?.capabilities || [],
        reputation: a.reputationScore ? a.reputationScore / 100 : (a.reputation || 0),
        totalTasks: a.taskCount || a.totalTasks || 0,
        price: a.metadata?.pricePerTask || a.basePriceUsdc || a.price || 0,
        status: a.available !== false ? 'online' : 'offline',
      }));

      // Client-side filter for online-only
      if (onlineOnly) {
        agentList = agentList.filter((a) => a.status === 'online');
      }

      setAgents(agentList);
    } catch (err) {
      console.error('Failed to fetch agents:', err);
      setError(err.message);
      // Fallback to empty list on error
      setAgents([]);
    } finally {
      setLoading(false);
    }
  }, [search, maxPrice, minReputation, onlineOnly]);

  // WebSocket: auto-refresh when new agents register
  useWebSocket({
    topics: ['registry:new_agents'],
    onMessage: useCallback((data) => {
      if (data.event === 'agent_registered') {
        fetchAgents();
      }
    }, [fetchAgents]),
  });

  // Debounced fetch on filter change
  useEffect(() => {
    const timer = setTimeout(fetchAgents, 300);
    return () => clearTimeout(timer);
  }, [fetchAgents]);

  const filtered = agents.filter((a) => {
    if (a.price > maxPrice) return false;
    if (a.reputation < minReputation) return false;
    if (onlineOnly && a.status !== 'online') return false;
    return true;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div className="mb-8">
        <h1 className="section-heading mb-2">Explore Agents</h1>
        <p className="text-gray-500">Find the perfect AI agent for your task.</p>
      </div>

      {/* Search bar */}
      <div className="mb-8">
        <div className="relative">
          <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search agents by name, capability, or describe what you need..."
            className="input-field pl-12"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Filters sidebar */}
        <aside className="w-full lg:w-64 flex-shrink-0">
          <div className="card p-6 space-y-6 sticky top-24">
            <h3 className="font-semibold text-gray-900">Filters</h3>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Max Price: {maxPrice} USDC
              </label>
              <input
                type="range"
                min={0}
                max={200}
                value={maxPrice}
                onChange={(e) => setMaxPrice(Number(e.target.value))}
                className="w-full accent-primary-600"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>0</span><span>200</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Min Reputation: {minReputation.toFixed(1)}
              </label>
              <input
                type="range"
                min={0}
                max={5}
                step={0.5}
                value={minReputation}
                onChange={(e) => setMinReputation(Number(e.target.value))}
                className="w-full accent-primary-600"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>0</span><span>5.0</span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700">Online Only</label>
              <button
                onClick={() => setOnlineOnly(!onlineOnly)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  onlineOnly ? 'bg-primary-600' : 'bg-gray-300'
                }`}
              >
                <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                  onlineOnly ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
            </div>

            <div className="text-sm text-gray-400">
              {filtered.length} agent{filtered.length !== 1 ? 's' : ''} found
            </div>
          </div>
        </aside>

        {/* Agent grid */}
        <div className="flex-1">
          {loading ? (
            <div className="text-center py-20">
              <div className="flex gap-1 justify-center mb-4">
                <span className="w-3 h-3 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-3 h-3 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-3 h-3 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
              <p className="text-gray-500">Searching agents...</p>
            </div>
          ) : error ? (
            <div className="text-center py-20">
              <svg className="w-12 h-12 mx-auto text-red-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <p className="text-gray-500 mb-2">Failed to load agents</p>
              <p className="text-sm text-gray-400">{error}</p>
              <button onClick={fetchAgents} className="btn-secondary mt-4 text-sm">Retry</button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-20">
              <svg className="w-12 h-12 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-gray-500">No agents match your filters.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {filtered.map((agent) => (
                <AgentCard key={agent.id} agent={agent} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
