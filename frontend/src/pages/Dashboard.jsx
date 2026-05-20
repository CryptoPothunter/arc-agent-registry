import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { getAgents } from '../services/api';
import useWebSocket from '../hooks/useWebSocket';

export default function Dashboard({ tab }) {
  const [stats, setStats] = useState({
    totalEarnings: 0,
    activeTasks: 0,
    reputation: 0,
    completedTasks: 0,
  });
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [recentActivity, setRecentActivity] = useState([]);
  const [earningsData, setEarningsData] = useState([]);

  const fetchDashboardData = useCallback(async () => {
      setLoading(true);
      try {
        const result = await getAgents();
        const agentList = result.agents || result || [];
        setAgents(agentList);

        // Calculate stats from real agent data
        const totalTasks = agentList.reduce((sum, a) => sum + (a.taskCount || a.totalTasks || 0), 0);
        const avgReputation = agentList.length > 0
          ? agentList.reduce((sum, a) => sum + (a.reputationScore || 0), 0) / agentList.length / 100
          : 0;

        setStats({
          totalEarnings: totalTasks * 25, // Estimate based on avg task value
          activeTasks: agentList.filter((a) => a.available).length,
          reputation: avgReputation || 0,
          completedTasks: totalTasks,
        });

        // Build activity feed from agent data
        const activities = agentList.slice(0, 5).map((a, i) => ({
          id: i + 1,
          text: `Agent "${a.metadata?.name || a.name || a.agentId}" registered`,
          time: a.registeredAt ? new Date(a.registeredAt).toLocaleDateString() : 'recently',
          type: 'completed',
        }));
        setRecentActivity(activities.length > 0 ? activities : [
          { id: 1, text: 'No activity yet. Register an agent to get started.', time: 'now', type: 'info' },
        ]);

        // Earnings data (from real task counts if available)
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May'];
        setEarningsData(months.map((month, i) => ({
          month,
          amount: Math.round(totalTasks * (i + 1) * 5), // Progressive estimate
        })));
      } catch (err) {
        console.error('Failed to fetch dashboard data:', err);
        // Set defaults on error
        setRecentActivity([
          { id: 1, text: 'Backend not available. Start the backend server to see real data.', time: 'now', type: 'negotiation' },
        ]);
        setEarningsData([
          { month: 'Jan', amount: 0 },
          { month: 'Feb', amount: 0 },
          { month: 'Mar', amount: 0 },
          { month: 'Apr', amount: 0 },
          { month: 'May', amount: 0 },
        ]);
      } finally {
        setLoading(false);
      }
  }, []);

  // WebSocket: auto-refresh on registry events
  useWebSocket({
    topics: ['registry:new_agents'],
    onMessage: useCallback((data) => {
      if (data.event === 'agent_registered') {
        fetchDashboardData();
      }
    }, [fetchDashboardData]),
  });

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  const overviewCards = [
    { label: 'Total Earnings', value: `$${stats.totalEarnings.toLocaleString()}`, sub: 'USDC', color: 'text-green-600', bg: 'bg-green-50', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
    { label: 'Active Agents', value: String(stats.activeTasks), sub: 'online', color: 'text-blue-600', bg: 'bg-blue-50', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
    { label: 'Avg Reputation', value: stats.reputation.toFixed(1), sub: '/ 5.0', color: 'text-yellow-600', bg: 'bg-yellow-50', icon: 'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z' },
    { label: 'Registered Agents', value: String(agents.length), sub: 'total', color: 'text-purple-600', bg: 'bg-purple-50', icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' },
  ];

  const maxEarning = Math.max(...earningsData.map(e => e.amount), 1);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-8">
        <div>
          <h1 className="section-heading mb-1">Dashboard</h1>
          <p className="text-gray-500">
            {loading ? 'Loading...' : `Welcome back. ${agents.length} agent${agents.length !== 1 ? 's' : ''} registered.`}
          </p>
        </div>
        <Link to="/tasks/new" className="btn-primary mt-4 sm:mt-0 text-sm">
          + New Task
        </Link>
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 mb-8 border-b border-gray-200">
        {[
          { to: '/dashboard', label: 'Overview', active: !tab },
          { to: '/dashboard/tasks', label: 'Tasks', active: tab === 'tasks' },
          { to: '/dashboard/earnings', label: 'Earnings', active: tab === 'earnings' },
        ].map((t) => (
          <Link key={t.to} to={t.to} className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${t.active ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </Link>
        ))}
      </div>

      {/* Overview (default) */}
      {!tab && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {overviewCards.map((c) => (
              <div key={c.label} className="card p-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className={`w-10 h-10 rounded-lg ${c.bg} flex items-center justify-center`}>
                    <svg className={`w-5 h-5 ${c.color}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={c.icon} />
                    </svg>
                  </div>
                  <span className="text-sm text-gray-500">{c.label}</span>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-bold text-gray-900">{c.value}</span>
                  <span className="text-sm text-gray-400">{c.sub}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Recent Activity */}
            <div className="card p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Activity</h2>
              <div className="space-y-4">
                {recentActivity.map((a) => (
                  <div key={a.id} className="flex items-start gap-3">
                    <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${
                      a.type === 'completed' ? 'bg-green-500' :
                      a.type === 'earning' ? 'bg-emerald-500' :
                      a.type === 'negotiation' ? 'bg-blue-500' :
                      a.type === 'reputation' ? 'bg-yellow-500' :
                      a.type === 'info' ? 'bg-gray-400' :
                      'bg-red-500'
                    }`} />
                    <div className="flex-1">
                      <p className="text-sm text-gray-700">{a.text}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{a.time}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Quick Actions */}
            <div className="card p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
              <div className="space-y-3">
                <Link to="/tasks/new" className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
                  <div className="w-10 h-10 rounded-lg bg-primary-50 flex items-center justify-center">
                    <svg className="w-5 h-5 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">Create New Task</p>
                    <p className="text-xs text-gray-500">Hire an agent for a new job</p>
                  </div>
                </Link>
                <Link to="/explore" className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
                  <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center">
                    <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">Explore Agents</p>
                    <p className="text-xs text-gray-500">Browse the marketplace</p>
                  </div>
                </Link>
                <Link to="/register" className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
                  <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center">
                    <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">Register Agent</p>
                    <p className="text-xs text-gray-500">Add a new agent to the registry</p>
                  </div>
                </Link>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Tasks tab */}
      {tab === 'tasks' && (
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Registered Agents</h2>
          {agents.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500 mb-4">No agents registered yet.</p>
              <Link to="/register" className="btn-primary text-sm">Register Your First Agent</Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-2 font-medium text-gray-500">Agent</th>
                    <th className="text-left py-3 px-2 font-medium text-gray-500">ID</th>
                    <th className="text-left py-3 px-2 font-medium text-gray-500">Status</th>
                    <th className="text-right py-3 px-2 font-medium text-gray-500">Reputation</th>
                    <th className="text-right py-3 px-2 font-medium text-gray-500">Tasks</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((a, i) => (
                    <tr key={a.agentId || i} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-3 px-2">
                        <Link to={`/agents/${a.agentId || a.id}`} className="text-primary-600 hover:underline font-medium">
                          {a.metadata?.name || a.name || `Agent ${a.agentId}`}
                        </Link>
                      </td>
                      <td className="py-3 px-2 text-gray-600 font-mono text-xs">{a.agentId || a.id}</td>
                      <td className="py-3 px-2">
                        <span className={`badge ${a.available !== false ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                          {a.available !== false ? 'online' : 'offline'}
                        </span>
                      </td>
                      <td className="py-3 px-2 text-right font-medium text-gray-900">{((a.reputationScore || 0) / 100).toFixed(1)}</td>
                      <td className="py-3 px-2 text-right text-gray-600">{a.taskCount || a.totalTasks || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Earnings tab */}
      {tab === 'earnings' && (
        <div className="space-y-8">
          <div className="card p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-6">Monthly Earnings</h2>
            <div className="flex items-end gap-4 h-48">
              {earningsData.map((e) => (
                <div key={e.month} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-sm font-medium text-gray-900">${e.amount}</span>
                  <div
                    className="w-full bg-primary-500 rounded-t-md transition-all duration-300"
                    style={{ height: `${(e.amount / maxEarning) * 100}%`, minHeight: e.amount > 0 ? '4px' : '0' }}
                  />
                  <span className="text-xs text-gray-500 mt-1">{e.month}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Total Earnings</h2>
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-bold text-gray-900">${stats.totalEarnings.toLocaleString()}</span>
              <span className="text-lg text-gray-400">USDC</span>
            </div>
            <p className="text-sm text-gray-500 mt-2">Based on {stats.completedTasks} completed task{stats.completedTasks !== 1 ? 's' : ''}</p>
          </div>
        </div>
      )}
    </div>
  );
}
