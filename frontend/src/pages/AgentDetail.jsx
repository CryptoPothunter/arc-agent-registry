import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import ReputationStars from '../components/ReputationStars';
import StatusBadge from '../components/StatusBadge';
import { getAgent } from '../services/api';

export default function AgentDetail() {
  const { id } = useParams();
  const [agent, setAgent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchAgent() {
      setLoading(true);
      setError(null);
      try {
        const result = await getAgent(id);
        const raw = result.agent || result;

        // Normalize agent data
        setAgent({
          id: raw.agentId || raw.id || id,
          name: raw.metadata?.name || raw.name || `Agent ${id}`,
          description: raw.metadata?.description || raw.description || 'No description available.',
          status: raw.available !== false ? 'online' : 'offline',
          reputation: raw.reputationScore ? raw.reputationScore / 100 : (raw.reputation || 0),
          totalTasks: raw.taskCount || raw.totalTasks || 0,
          walletAddress: raw.walletAddress || raw.owner || '',
          metadataURI: raw.metadataURI || '',
          basePriceUsdc: raw.basePriceUsdc || raw.metadata?.pricePerTask || 0,
          capabilities: (raw.metadata?.capabilityDetails || raw.capabilities || []).map((cap) => {
            if (typeof cap === 'string') {
              return { name: cap, description: '', inputSchema: '', outputSchema: '', price: raw.basePriceUsdc || 0 };
            }
            return cap;
          }),
          reputationHistory: raw.reputationHistory || [],
          taskHistory: raw.taskHistory || [],
          registeredAt: raw.registeredAt || '',
          txHash: raw.txHash || '',
        });
      } catch (err) {
        console.error('Failed to fetch agent:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchAgent();
  }, [id]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-20 text-center">
        <div className="flex gap-1 justify-center mb-4">
          <span className="w-3 h-3 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-3 h-3 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-3 h-3 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
        <p className="text-gray-500">Loading agent details...</p>
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-20 text-center">
        <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Agent Not Found</h2>
        <p className="text-gray-500 mb-4">{error || 'This agent could not be found in the registry.'}</p>
        <Link to="/explore" className="btn-primary text-sm">Browse Agents</Link>
      </div>
    );
  }

  const maxBar = Math.max(...(agent.reputationHistory.length ? agent.reputationHistory : [1]));

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {/* Header */}
      <div className="card p-8 mb-8">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-2xl bg-primary-100 flex items-center justify-center flex-shrink-0">
              <span className="text-primary-700 font-bold text-2xl">{agent.name.charAt(0)}</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 mb-1">{agent.name}</h1>
              <div className="flex items-center gap-3 mb-3">
                <StatusBadge status={agent.status} />
                <ReputationStars score={agent.reputation} totalTasks={agent.totalTasks} />
              </div>
              <p className="text-gray-600 max-w-2xl">{agent.description}</p>
              {agent.walletAddress && (
                <p className="text-xs font-mono text-gray-400 mt-2">
                  <a href={`https://testnet.arcscan.app/address/${agent.walletAddress}`} target="_blank" rel="noopener noreferrer" className="hover:text-primary-600">
                    {agent.walletAddress}
                  </a>
                </p>
              )}
            </div>
          </div>
          <Link to={`/tasks/new?agent=${agent.id}`} className="btn-primary flex-shrink-0">
            Hire This Agent
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          {/* Capabilities */}
          <div className="card p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Capabilities</h2>
            {agent.capabilities.length === 0 ? (
              <p className="text-sm text-gray-500">No capabilities registered yet.</p>
            ) : (
              <div className="space-y-4">
                {agent.capabilities.map((cap, idx) => (
                  <div key={cap.name || idx} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="badge bg-primary-50 text-primary-700 border border-primary-200 text-sm">{cap.name}</span>
                      <span className="font-bold text-gray-900">{cap.price || agent.basePriceUsdc} USDC</span>
                    </div>
                    {cap.description && (
                      <p className="text-sm text-gray-600 mb-3">{cap.description}</p>
                    )}
                    {(cap.inputSchema || cap.outputSchema) && (
                      <div className="grid grid-cols-2 gap-3">
                        {cap.inputSchema && (
                          <div>
                            <span className="text-xs font-medium text-gray-400 uppercase">Input</span>
                            <pre className="mt-1 text-xs bg-gray-50 rounded p-2 font-mono text-gray-600 overflow-x-auto">{cap.inputSchema}</pre>
                          </div>
                        )}
                        {cap.outputSchema && (
                          <div>
                            <span className="text-xs font-medium text-gray-400 uppercase">Output</span>
                            <pre className="mt-1 text-xs bg-gray-50 rounded p-2 font-mono text-gray-600 overflow-x-auto">{cap.outputSchema}</pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Task History */}
          <div className="card p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Task History</h2>
            {agent.taskHistory.length === 0 ? (
              <p className="text-sm text-gray-500">No tasks completed yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-3 px-2 font-medium text-gray-500">Description</th>
                      <th className="text-left py-3 px-2 font-medium text-gray-500">Status</th>
                      <th className="text-right py-3 px-2 font-medium text-gray-500">Price</th>
                      <th className="text-right py-3 px-2 font-medium text-gray-500">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agent.taskHistory.map((t, idx) => (
                      <tr key={t.id || idx} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-3 px-2 text-gray-900">{t.description}</td>
                        <td className="py-3 px-2">
                          <span className={`badge ${t.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                            {t.status}
                          </span>
                        </td>
                        <td className="py-3 px-2 text-right font-medium text-gray-900">{t.price} USDC</td>
                        <td className="py-3 px-2 text-right text-gray-500">{t.date}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-8">
          {/* Reputation History Chart */}
          {agent.reputationHistory.length > 0 && (
            <div className="card p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Reputation History</h2>
              <div className="flex items-end gap-2 h-40">
                {agent.reputationHistory.map((score, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-xs text-gray-500">{score.toFixed(1)}</span>
                    <div
                      className="w-full bg-primary-500 rounded-t-md transition-all duration-300"
                      style={{ height: `${(score / maxBar) * 100}%` }}
                    />
                    <span className="text-xs text-gray-400">M{i + 1}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Stats</h2>
            <dl className="space-y-3">
              <div className="flex justify-between">
                <dt className="text-sm text-gray-500">Agent ID</dt>
                <dd className="text-sm font-medium text-gray-900 font-mono">{agent.id}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-sm text-gray-500">Completed Tasks</dt>
                <dd className="text-sm font-medium text-gray-900">{agent.totalTasks}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-sm text-gray-500">Avg. Rating</dt>
                <dd className="text-sm font-medium text-gray-900">{agent.reputation.toFixed(1)}/5.0</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-sm text-gray-500">Base Price</dt>
                <dd className="text-sm font-medium text-gray-900">{agent.basePriceUsdc} USDC</dd>
              </div>
              {agent.registeredAt && (
                <div className="flex justify-between">
                  <dt className="text-sm text-gray-500">Registered</dt>
                  <dd className="text-sm font-medium text-gray-900">{new Date(agent.registeredAt).toLocaleDateString()}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* On-chain info */}
          {agent.txHash && (
            <div className="card p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">On-Chain</h2>
              <dl className="space-y-3">
                <div>
                  <dt className="text-sm text-gray-500 mb-1">Registration TX</dt>
                  <dd>
                    <a href={`https://testnet.arcscan.app/tx/${agent.txHash}`} target="_blank" rel="noopener noreferrer"
                       className="text-xs font-mono text-primary-600 hover:underline break-all">
                      {agent.txHash}
                    </a>
                  </dd>
                </div>
                {agent.metadataURI && (
                  <div>
                    <dt className="text-sm text-gray-500 mb-1">Metadata CID</dt>
                    <dd className="text-xs font-mono text-gray-600 break-all">{agent.metadataURI}</dd>
                  </div>
                )}
              </dl>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
