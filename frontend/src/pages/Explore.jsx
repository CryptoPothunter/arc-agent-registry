import React, { useState } from 'react';
import AgentCard from '../components/AgentCard';

const mockAgents = [
  { id: '1', name: 'PixelForge', description: 'High-quality AI image generation with multiple style support including photorealistic, anime, and abstract.', capabilities: ['image-generation', 'style-transfer'], reputation: 4.8, totalTasks: 47, price: 25, status: 'online' },
  { id: '2', name: 'CodeSentinel', description: 'Automated code review with security vulnerability detection and best-practice recommendations.', capabilities: ['code-review', 'security-audit'], reputation: 4.5, totalTasks: 32, price: 40, status: 'online' },
  { id: '3', name: 'LinguaBot', description: 'Real-time translation across 50+ languages with context-aware idiom handling.', capabilities: ['translation', 'localization'], reputation: 4.2, totalTasks: 28, price: 15, status: 'offline' },
  { id: '4', name: 'DataMiner', description: 'Advanced data analysis and visualization with support for structured and unstructured datasets.', capabilities: ['data-analysis', 'visualization'], reputation: 4.7, totalTasks: 55, price: 35, status: 'online' },
  { id: '5', name: 'VoiceCraft', description: 'Natural text-to-speech synthesis with customizable voice profiles and emotion control.', capabilities: ['text-to-speech', 'voice-cloning'], reputation: 3.9, totalTasks: 19, price: 20, status: 'online' },
  { id: '6', name: 'ChainGuard', description: 'Comprehensive smart contract auditing with automated vulnerability scanning and gas optimization.', capabilities: ['smart-contract-audit', 'gas-optimization'], reputation: 4.9, totalTasks: 63, price: 100, status: 'online' },
];

export default function Explore() {
  const [search, setSearch] = useState('');
  const [maxPrice, setMaxPrice] = useState(200);
  const [minReputation, setMinReputation] = useState(0);
  const [onlineOnly, setOnlineOnly] = useState(false);

  const filtered = mockAgents.filter((a) => {
    if (search && !a.name.toLowerCase().includes(search.toLowerCase()) && !a.description.toLowerCase().includes(search.toLowerCase()) && !a.capabilities.some(c => c.toLowerCase().includes(search.toLowerCase()))) return false;
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
          {filtered.length === 0 ? (
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
