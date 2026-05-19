import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

const mockAgents = [
  { id: '1', name: 'PixelForge' },
  { id: '2', name: 'CodeSentinel' },
  { id: '3', name: 'LinguaBot' },
  { id: '4', name: 'DataMiner' },
  { id: '5', name: 'VoiceCraft' },
  { id: '6', name: 'ChainGuard' },
];

export default function NewTask() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectedAgent = searchParams.get('agent') || '';

  const [form, setForm] = useState({
    agentId: preselectedAgent,
    description: '',
    budget: '',
    deadline: '',
  });

  const update = (field, value) => setForm((f) => ({ ...f, [field]: value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    // In a real app this would POST to the API
    navigate(`/tasks/demo-task-001`);
  };

  const isValid = form.agentId && form.description && form.budget;

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <h1 className="section-heading mb-2">Create New Task</h1>
      <p className="text-gray-500 mb-8">Hire an agent and start a negotiation.</p>

      <form onSubmit={handleSubmit} className="card p-8 space-y-6">
        {/* Select Agent */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Select Agent</label>
          <select
            className="input-field"
            value={form.agentId}
            onChange={(e) => update('agentId', e.target.value)}
          >
            <option value="">Choose an agent...</option>
            {mockAgents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>

        {/* Task Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Task Description</label>
          <textarea
            className="input-field h-32 resize-none"
            placeholder="Describe the task you need completed..."
            value={form.description}
            onChange={(e) => update('description', e.target.value)}
          />
        </div>

        {/* Budget */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Budget (USDC)</label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-medium">$</span>
            <input
              type="number"
              className="input-field pl-8"
              placeholder="0.00"
              min={1}
              value={form.budget}
              onChange={(e) => update('budget', e.target.value)}
            />
          </div>
          <p className="text-xs text-gray-400 mt-1">This is your starting offer. The agent may counter-offer during negotiation.</p>
        </div>

        {/* Deadline */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Deadline</label>
          <input
            type="date"
            className="input-field"
            value={form.deadline}
            onChange={(e) => update('deadline', e.target.value)}
          />
        </div>

        {/* Submit */}
        <div className="pt-4 border-t border-gray-100">
          <button
            type="submit"
            disabled={!isValid}
            className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Submit &amp; Start Negotiation
          </button>
          <p className="text-xs text-gray-400 text-center mt-3">
            Submitting will initiate a real-time price negotiation with the selected agent.
          </p>
        </div>
      </form>
    </div>
  );
}
