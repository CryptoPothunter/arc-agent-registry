import React, { useState } from 'react';
import {
  submitIntent,
  matchIntent,
  getIntentStatus,
} from '../services/api';

const STATUS_COLORS = {
  pending: 'bg-yellow-100 text-yellow-800',
  matching: 'bg-blue-100 text-blue-800',
  matched: 'bg-green-100 text-green-800',
  expired: 'bg-gray-100 text-gray-800',
};

export default function PrivateIntents() {
  const [activeTab, setActiveTab] = useState('submit');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  // Submit form state
  const [intentForm, setIntentForm] = useState({
    submitterAddress: '',
    capability: '',
    taskDescription: '',
    maxBudget: '',
  });

  // Status lookup state
  const [statusIntentId, setStatusIntentId] = useState('');
  const [intentStatus, setIntentStatus] = useState(null);

  // Matching state
  const [matchIntentId, setMatchIntentId] = useState('');

  const handleSubmitIntent = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await submitIntent({
        submitterAddress: intentForm.submitterAddress,
        capability: intentForm.capability,
        taskDescription: intentForm.taskDescription,
        maxBudget: parseFloat(intentForm.maxBudget),
      });
      setResult(res);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const handleGetStatus = async () => {
    if (!statusIntentId) return;
    setLoading(true);
    setError('');
    setIntentStatus(null);
    try {
      const res = await getIntentStatus(statusIntentId);
      setIntentStatus(res);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const handleTriggerMatching = async () => {
    if (!matchIntentId) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await matchIntent(matchIntentId, {});
      setResult(res);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const tabs = [
    { id: 'submit', label: 'Submit Intent' },
    { id: 'status', label: 'Intent Status' },
    { id: 'match', label: 'Trigger Matching' },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-2">Private Intent Matching</h1>
      <p className="text-gray-500 mb-6">
        Submit encrypted task intents and match with capable agents via AI similarity scoring
      </p>

      {/* Privacy Explanation Card */}
      <div className="mb-6 p-4 bg-indigo-50 border border-indigo-200 rounded-lg">
        <h3 className="text-sm font-semibold text-indigo-800 mb-1">Privacy-Preserving Matching</h3>
        <p className="text-xs text-indigo-700">
          Task descriptions are encrypted with AES-256-CBC before submission. Matching is performed
          using AI capability vectors and cosine similarity scoring, so agent selection occurs without
          exposing raw task details. Only the matched agent receives the decrypted description after
          agreement.
        </p>
      </div>

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

      {/* Submit Private Intent */}
      {activeTab === 'submit' && (
        <form onSubmit={handleSubmitIntent} className="space-y-4">
          <h2 className="text-xl font-semibold">Submit Private Intent</h2>
          <p className="text-gray-500 text-sm">
            Submit an encrypted intent describing the task you need completed. The task description
            will be AES-256-CBC encrypted before being stored on-chain.
          </p>
          <div>
            <label className="block text-sm font-medium mb-1">Submitter Wallet Address</label>
            <input
              type="text"
              className="w-full border rounded p-2 text-sm font-mono"
              value={intentForm.submitterAddress}
              onChange={(e) => setIntentForm({ ...intentForm, submitterAddress: e.target.value })}
              placeholder="0x..."
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Capability Needed</label>
            <input
              type="text"
              className="w-full border rounded p-2 text-sm"
              value={intentForm.capability}
              onChange={(e) => setIntentForm({ ...intentForm, capability: e.target.value })}
              placeholder="e.g. code-audit, data-analysis, smart-contract-review"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              Task Description
              <span className="ml-2 text-xs font-normal text-gray-400">(will be encrypted)</span>
            </label>
            <textarea
              className="w-full border rounded p-2 text-sm"
              rows={3}
              value={intentForm.taskDescription}
              onChange={(e) => setIntentForm({ ...intentForm, taskDescription: e.target.value })}
              placeholder="Describe the task in detail. This will be AES-256-CBC encrypted before submission..."
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Max Budget (USDC)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className="w-full border rounded p-2 text-sm"
              value={intentForm.maxBudget}
              onChange={(e) => setIntentForm({ ...intentForm, maxBudget: e.target.value })}
              placeholder="100.00"
              required
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="bg-primary-600 text-white px-6 py-2 rounded hover:bg-primary-700 disabled:opacity-50"
          >
            {loading ? 'Submitting...' : 'Submit Encrypted Intent'}
          </button>
        </form>
      )}

      {/* Intent Status */}
      {activeTab === 'status' && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Intent Status</h2>
          <p className="text-gray-500 text-sm">
            Look up the current status of a submitted intent, view matched agents and similarity scores.
          </p>
          <div className="flex space-x-2">
            <input
              type="text"
              className="flex-1 border rounded p-2 text-sm font-mono"
              value={statusIntentId}
              onChange={(e) => setStatusIntentId(e.target.value)}
              placeholder="Intent ID"
            />
            <button
              onClick={handleGetStatus}
              disabled={loading || !statusIntentId}
              className="bg-gray-700 text-white px-4 py-2 rounded hover:bg-gray-800 disabled:opacity-50 text-sm"
            >
              {loading ? 'Loading...' : 'Query'}
            </button>
          </div>

          {intentStatus && (
            <div className="bg-gray-50 rounded p-4 text-sm space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold">Intent #{intentStatus.intentId}</span>
                <span className={`px-2 py-1 rounded text-xs font-medium ${STATUS_COLORS[intentStatus.status] || 'bg-gray-100'}`}>
                  {intentStatus.status}
                </span>
              </div>
              {intentStatus.capability && (
                <div><span className="text-gray-500">Capability:</span> {intentStatus.capability}</div>
              )}
              {intentStatus.maxBudget != null && (
                <div><span className="text-gray-500">Max Budget:</span> {intentStatus.maxBudget} USDC</div>
              )}
              {intentStatus.selectedAgent && (
                <div className="p-3 bg-green-50 border border-green-200 rounded">
                  <div className="text-xs font-semibold text-green-800 mb-1">Selected Agent</div>
                  <div className="font-mono text-xs">{intentStatus.selectedAgent.address || intentStatus.selectedAgent}</div>
                  {intentStatus.selectedAgent.score != null && (
                    <div className="text-xs text-green-700 mt-1">
                      Similarity: {(intentStatus.selectedAgent.score * 100).toFixed(1)}%
                    </div>
                  )}
                </div>
              )}

              {/* Matched Agents List */}
              {intentStatus.matches && intentStatus.matches.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-gray-600 mb-2">
                    Matched Agents ({intentStatus.matches.length})
                  </div>
                  <div className="space-y-2">
                    {[...intentStatus.matches]
                      .sort((a, b) => (b.score || 0) - (a.score || 0))
                      .map((agent, idx) => (
                        <div
                          key={agent.address || agent.agentId || idx}
                          className="flex items-center justify-between p-2 bg-white border rounded text-xs"
                        >
                          <div>
                            <div className="font-medium">{agent.name || agent.agentId || 'Agent'}</div>
                            <div className="font-mono text-gray-400">{agent.address || agent.agentId}</div>
                            {agent.capabilities && (
                              <div className="text-gray-500 mt-0.5">
                                {Array.isArray(agent.capabilities) ? agent.capabilities.join(', ') : agent.capabilities}
                              </div>
                            )}
                          </div>
                          <div className="text-right">
                            <div className="font-semibold text-primary-700">
                              {agent.score != null ? `${(agent.score * 100).toFixed(1)}%` : '--'}
                            </div>
                            <div className="text-gray-400">similarity</div>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {intentStatus.matches && intentStatus.matches.length === 0 && (
                <div className="text-xs text-gray-400 italic">No matched agents yet.</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Trigger Matching */}
      {activeTab === 'match' && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Trigger AI Matching</h2>
          <p className="text-gray-500 text-sm">
            Initiate AI-powered matching for a pending intent. The system computes capability vectors
            for registered agents and ranks them by cosine similarity to the intent requirements.
          </p>
          <div className="flex space-x-2">
            <input
              type="text"
              className="flex-1 border rounded p-2 text-sm font-mono"
              value={matchIntentId}
              onChange={(e) => setMatchIntentId(e.target.value)}
              placeholder="Intent ID"
            />
            <button
              onClick={handleTriggerMatching}
              disabled={loading || !matchIntentId}
              className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700 disabled:opacity-50 text-sm"
            >
              {loading ? 'Matching...' : 'Start Matching'}
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
