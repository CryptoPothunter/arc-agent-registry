import React from 'react';
import { useParams, Link } from 'react-router-dom';
import ReputationStars from '../components/ReputationStars';
import StatusBadge from '../components/StatusBadge';

const mockAgents = {
  '1': {
    id: '1', name: 'PixelForge', description: 'High-quality AI image generation with multiple style support including photorealistic, anime, and abstract art styles. Powered by state-of-the-art diffusion models.', status: 'online', reputation: 4.8, totalTasks: 47,
    capabilities: [
      { name: 'image-generation', description: 'Generate images from text prompts', inputSchema: '{ "prompt": "string", "style": "string" }', outputSchema: '{ "image_url": "string" }', price: 25 },
      { name: 'style-transfer', description: 'Apply artistic styles to existing images', inputSchema: '{ "image_url": "string", "style": "string" }', outputSchema: '{ "image_url": "string" }', price: 30 },
    ],
    reputationHistory: [3.5, 4.0, 4.2, 4.5, 4.6, 4.8],
    taskHistory: [
      { id: 't1', description: 'Generate product mockups', status: 'completed', price: 25, date: '2026-05-15' },
      { id: 't2', description: 'Style transfer for marketing', status: 'completed', price: 30, date: '2026-05-12' },
      { id: 't3', description: 'Batch image generation', status: 'completed', price: 50, date: '2026-05-08' },
      { id: 't4', description: 'Logo design concepts', status: 'in-progress', price: 25, date: '2026-05-18' },
    ],
  },
  '2': {
    id: '2', name: 'CodeSentinel', description: 'Automated code review with security vulnerability detection, best-practice recommendations, and CI/CD integration support.', status: 'online', reputation: 4.5, totalTasks: 32,
    capabilities: [
      { name: 'code-review', description: 'Review code for quality and bugs', inputSchema: '{ "repo_url": "string", "branch": "string" }', outputSchema: '{ "report": "object" }', price: 40 },
      { name: 'security-audit', description: 'Scan for security vulnerabilities', inputSchema: '{ "repo_url": "string" }', outputSchema: '{ "vulnerabilities": "array" }', price: 60 },
    ],
    reputationHistory: [4.0, 4.1, 4.3, 4.4, 4.5, 4.5],
    taskHistory: [
      { id: 't5', description: 'Review PR #142', status: 'completed', price: 40, date: '2026-05-14' },
      { id: 't6', description: 'Security audit for DeFi contract', status: 'completed', price: 60, date: '2026-05-10' },
    ],
  },
};

const fallbackAgent = {
  id: '0', name: 'Unknown Agent', description: 'This agent was not found.', status: 'offline', reputation: 0, totalTasks: 0,
  capabilities: [], reputationHistory: [], taskHistory: [],
};

export default function AgentDetail() {
  const { id } = useParams();
  const agent = mockAgents[id] || fallbackAgent;

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
            <div className="space-y-4">
              {agent.capabilities.map((cap) => (
                <div key={cap.name} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="badge bg-primary-50 text-primary-700 border border-primary-200 text-sm">{cap.name}</span>
                    <span className="font-bold text-gray-900">{cap.price} USDC</span>
                  </div>
                  <p className="text-sm text-gray-600 mb-3">{cap.description}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <span className="text-xs font-medium text-gray-400 uppercase">Input</span>
                      <pre className="mt-1 text-xs bg-gray-50 rounded p-2 font-mono text-gray-600 overflow-x-auto">{cap.inputSchema}</pre>
                    </div>
                    <div>
                      <span className="text-xs font-medium text-gray-400 uppercase">Output</span>
                      <pre className="mt-1 text-xs bg-gray-50 rounded p-2 font-mono text-gray-600 overflow-x-auto">{cap.outputSchema}</pre>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Task History */}
          <div className="card p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Task History</h2>
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
                  {agent.taskHistory.map((t) => (
                    <tr key={t.id} className="border-b border-gray-100 hover:bg-gray-50">
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
          </div>
        </div>

        {/* Reputation History Chart */}
        <div className="space-y-8">
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

          <div className="card p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Stats</h2>
            <dl className="space-y-3">
              <div className="flex justify-between">
                <dt className="text-sm text-gray-500">Completed Tasks</dt>
                <dd className="text-sm font-medium text-gray-900">{agent.totalTasks}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-sm text-gray-500">Avg. Rating</dt>
                <dd className="text-sm font-medium text-gray-900">{agent.reputation}/5.0</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-sm text-gray-500">Response Time</dt>
                <dd className="text-sm font-medium text-gray-900">&lt; 2 min</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-sm text-gray-500">Success Rate</dt>
                <dd className="text-sm font-medium text-gray-900">96%</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
