import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getAgents, proposeNegotiation } from '../services/api';

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

  const [agents, setAgents] = useState([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  // Fetch agents list for the dropdown
  useEffect(() => {
    async function fetchAgentList() {
      try {
        const result = await getAgents();
        const list = (result.agents || result || []).map((a) => ({
          id: a.agentId || a.id,
          name: a.metadata?.name || a.name || `Agent ${a.agentId}`,
        }));
        setAgents(list);
      } catch (err) {
        console.error('Failed to fetch agents:', err);
        // Provide empty list on error
        setAgents([]);
      } finally {
        setLoadingAgents(false);
      }
    }
    fetchAgentList();
  }, []);

  const update = (field, value) => setForm((f) => ({ ...f, [field]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);

    try {
      // Calculate deadline as Unix timestamp
      const deadlineTimestamp = form.deadline
        ? Math.floor(new Date(form.deadline).getTime() / 1000)
        : Math.floor(Date.now() / 1000) + 86400; // Default: 24 hours

      const result = await proposeNegotiation({
        fromAgentId: 'requester',
        toAgentId: form.agentId,
        taskDescription: form.description,
        proposedPrice: Number(form.budget),
        deadline: deadlineTimestamp,
        agentConfig: {},
      });

      // Navigate to the task/negotiation detail view
      const negotiationId = result.negotiation?.negotiationId || result.negotiationId;
      if (negotiationId) {
        navigate(`/tasks/${negotiationId}`);
      } else {
        navigate('/dashboard/tasks');
      }
    } catch (err) {
      console.error('Task creation failed:', err);
      setSubmitError(err.message || 'Failed to create task. Please try again.');
    } finally {
      setSubmitting(false);
    }
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
            disabled={loadingAgents}
          >
            <option value="">
              {loadingAgents ? 'Loading agents...' : 'Choose an agent...'}
            </option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          {!loadingAgents && agents.length === 0 && (
            <p className="text-xs text-gray-400 mt-1">No agents registered yet. <a href="/register" className="text-primary-600 hover:underline">Register one first.</a></p>
          )}
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

        {/* Error display */}
        {submitError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-700">{submitError}</p>
          </div>
        )}

        {/* Submit */}
        <div className="pt-4 border-t border-gray-100">
          <button
            type="submit"
            disabled={!isValid || submitting}
            className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Creating Task...' : 'Submit & Start Negotiation'}
          </button>
          <p className="text-xs text-gray-400 text-center mt-3">
            Submitting will initiate a real-time price negotiation with the selected agent.
          </p>
        </div>
      </form>
    </div>
  );
}
