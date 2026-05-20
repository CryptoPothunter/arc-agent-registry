import React, { useState } from 'react';
import {
  createArcJob,
  setJobBudget,
  fundArcJob,
  submitJobDeliverable,
  completeArcJob,
  getArcJob,
  runIdentityWorkflow,
  runJobLifecycle,
} from '../services/api';

const STATUS_COLORS = {
  open: 'bg-blue-100 text-blue-800',
  funded: 'bg-yellow-100 text-yellow-800',
  submitted: 'bg-purple-100 text-purple-800',
  completed: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  expired: 'bg-gray-100 text-gray-800',
};

export default function ArcJobs() {
  const [activeTab, setActiveTab] = useState('jobs');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  // Job form state
  const [jobForm, setJobForm] = useState({
    description: '',
    providerAddress: '',
    deadline: '',
    budget: '',
  });

  // Query state
  const [queryJobId, setQueryJobId] = useState('');
  const [jobDetail, setJobDetail] = useState(null);

  // Demo state
  const [demoForm, setDemoForm] = useState({
    name: '',
    description: '',
    budget: '',
  });

  const handleCreateJob = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const deadlineTs = jobForm.deadline
        ? Math.floor(new Date(jobForm.deadline).getTime() / 1000)
        : Math.floor(Date.now() / 1000) + 86400;
      const res = await createArcJob({
        description: jobForm.description,
        providerAddress: jobForm.providerAddress,
        deadline: deadlineTs,
      });
      setResult(res);

      // If budget provided, set it and fund
      if (jobForm.budget && res.jobId) {
        await setJobBudget(res.jobId, { amount: jobForm.budget });
        const funded = await fundArcJob(res.jobId, { amount: jobForm.budget });
        setResult((prev) => ({ ...prev, ...funded, budget: jobForm.budget }));
      }
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const handleGetJob = async () => {
    if (!queryJobId) return;
    setLoading(true);
    setError('');
    try {
      const res = await getArcJob(queryJobId);
      setJobDetail(res);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const handleSubmitDeliverable = async () => {
    if (!queryJobId) return;
    setLoading(true);
    setError('');
    try {
      const res = await submitJobDeliverable(queryJobId, {
        deliverableData: `deliverable-${queryJobId}-${Date.now()}`,
      });
      setJobDetail((prev) => (prev ? { ...prev, ...res } : res));
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const handleCompleteJob = async () => {
    if (!queryJobId) return;
    setLoading(true);
    setError('');
    try {
      const res = await completeArcJob(queryJobId);
      setJobDetail((prev) => (prev ? { ...prev, ...res } : res));
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const handleIdentityDemo = async () => {
    if (!demoForm.name) return;
    setLoading(true);
    setError('');
    try {
      const res = await runIdentityWorkflow({
        name: demoForm.name,
        description: demoForm.description,
      });
      setResult(res);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const handleJobLifecycleDemo = async () => {
    if (!demoForm.description || !demoForm.budget) return;
    setLoading(true);
    setError('');
    try {
      const res = await runJobLifecycle({
        description: demoForm.description,
        budget: demoForm.budget,
      });
      setResult(res);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const tabs = [
    { id: 'jobs', label: 'ERC-8183 Jobs' },
    { id: 'query', label: 'Job Actions' },
    { id: 'demo', label: 'Demo Workflows' },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-2">Arc Native Protocol</h1>
      <p className="text-gray-500 mb-6">
        ERC-8004 Agent Identity + ERC-8183 Job Settlement on Arc Testnet
      </p>

      {/* Tabs */}
      <div className="flex space-x-1 mb-6 border-b border-gray-200">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setError(''); setResult(null); }}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg ${
              activeTab === tab.id
                ? 'bg-primary-50 text-primary-700 border-b-2 border-primary-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* ERC-8183 Job Creation */}
      {activeTab === 'jobs' && (
        <form onSubmit={handleCreateJob} className="space-y-4">
          <h2 className="text-xl font-semibold">Create ERC-8183 Job</h2>
          <p className="text-gray-500 text-sm">
            Create a job on the AgenticCommerce contract. The client creates the job,
            provider sets budget, client funds escrow, provider submits deliverable,
            evaluator completes or rejects.
          </p>
          <div>
            <label className="block text-sm font-medium mb-1">Task Description</label>
            <textarea
              className="w-full border rounded p-2 text-sm"
              rows={3}
              value={jobForm.description}
              onChange={(e) => setJobForm({ ...jobForm, description: e.target.value })}
              placeholder="Describe the task for the AI agent..."
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Provider Address</label>
            <input
              type="text"
              className="w-full border rounded p-2 text-sm font-mono"
              value={jobForm.providerAddress}
              onChange={(e) => setJobForm({ ...jobForm, providerAddress: e.target.value })}
              placeholder="0x..."
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Budget (USDC)</label>
              <input
                type="number"
                step="0.01"
                className="w-full border rounded p-2 text-sm"
                value={jobForm.budget}
                onChange={(e) => setJobForm({ ...jobForm, budget: e.target.value })}
                placeholder="10.00"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Deadline</label>
              <input
                type="datetime-local"
                className="w-full border rounded p-2 text-sm"
                value={jobForm.deadline}
                onChange={(e) => setJobForm({ ...jobForm, deadline: e.target.value })}
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="bg-primary-600 text-white px-6 py-2 rounded hover:bg-primary-700 disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create Job'}
          </button>
        </form>
      )}

      {/* Job Actions */}
      {activeTab === 'query' && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Job Actions</h2>
          <div className="flex space-x-2">
            <input
              type="text"
              className="flex-1 border rounded p-2 text-sm font-mono"
              value={queryJobId}
              onChange={(e) => setQueryJobId(e.target.value)}
              placeholder="Job ID"
            />
            <button
              onClick={handleGetJob}
              disabled={loading}
              className="bg-gray-700 text-white px-4 py-2 rounded hover:bg-gray-800 disabled:opacity-50 text-sm"
            >
              Query
            </button>
          </div>

          {jobDetail && (
            <div className="bg-gray-50 rounded p-4 text-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold">Job #{jobDetail.jobId}</span>
                <span className={`px-2 py-1 rounded text-xs font-medium ${STATUS_COLORS[jobDetail.status] || 'bg-gray-100'}`}>
                  {jobDetail.status}
                </span>
              </div>
              <div><span className="text-gray-500">Description:</span> {jobDetail.description}</div>
              <div><span className="text-gray-500">Budget:</span> {jobDetail.budget} USDC</div>
              <div><span className="text-gray-500">Provider:</span> <span className="font-mono text-xs">{jobDetail.provider || jobDetail.providerAddress}</span></div>
              {jobDetail.txHash && (
                <div>
                  <span className="text-gray-500">Tx:</span>{' '}
                  <a href={`https://testnet.arcscan.app/tx/${jobDetail.txHash}`} target="_blank" rel="noreferrer" className="text-primary-600 underline font-mono text-xs">
                    {jobDetail.txHash.slice(0, 16)}...
                  </a>
                </div>
              )}
            </div>
          )}

          <div className="flex space-x-2">
            <button
              onClick={handleSubmitDeliverable}
              disabled={loading || !queryJobId}
              className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700 disabled:opacity-50 text-sm"
            >
              Submit Deliverable
            </button>
            <button
              onClick={handleCompleteJob}
              disabled={loading || !queryJobId}
              className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50 text-sm"
            >
              Complete Job
            </button>
          </div>
        </div>
      )}

      {/* Demo Workflows */}
      {activeTab === 'demo' && (
        <div className="space-y-6">
          <div>
            <h2 className="text-xl font-semibold mb-2">ERC-8004 Identity Workflow</h2>
            <p className="text-gray-500 text-sm mb-3">
              Full 7-step workflow: Register agent, record reputation, request validation, submit validation response, verify status.
            </p>
            <div className="flex space-x-2 mb-2">
              <input
                type="text"
                className="flex-1 border rounded p-2 text-sm"
                value={demoForm.name}
                onChange={(e) => setDemoForm({ ...demoForm, name: e.target.value })}
                placeholder="Agent Name"
              />
              <button
                onClick={handleIdentityDemo}
                disabled={loading || !demoForm.name}
                className="bg-primary-600 text-white px-4 py-2 rounded hover:bg-primary-700 disabled:opacity-50 text-sm"
              >
                {loading ? 'Running...' : 'Run Identity Workflow'}
              </button>
            </div>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-2">ERC-8183 Job Lifecycle</h2>
            <p className="text-gray-500 text-sm mb-3">
              Full lifecycle: Create job, set budget, fund escrow, submit deliverable, complete job.
            </p>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <input
                type="text"
                className="border rounded p-2 text-sm"
                value={demoForm.description}
                onChange={(e) => setDemoForm({ ...demoForm, description: e.target.value })}
                placeholder="Task Description"
              />
              <input
                type="number"
                step="0.01"
                className="border rounded p-2 text-sm"
                value={demoForm.budget}
                onChange={(e) => setDemoForm({ ...demoForm, budget: e.target.value })}
                placeholder="Budget (USDC)"
              />
            </div>
            <button
              onClick={handleJobLifecycleDemo}
              disabled={loading || !demoForm.description || !demoForm.budget}
              className="bg-primary-600 text-white px-4 py-2 rounded hover:bg-primary-700 disabled:opacity-50 text-sm"
            >
              {loading ? 'Running...' : 'Run Job Lifecycle'}
            </button>
          </div>
        </div>
      )}

      {/* Result Display */}
      {result && (
        <div className="mt-6 bg-gray-50 rounded p-4">
          <h3 className="text-sm font-semibold mb-2">Result</h3>
          <pre className="text-xs overflow-x-auto whitespace-pre-wrap font-mono text-gray-700">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
