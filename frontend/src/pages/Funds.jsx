import React, { useState } from 'react';
import {
  createFund,
  investInFund,
  getFund,
  getFundByAgent,
} from '../services/api';

export default function Funds() {
  const [activeTab, setActiveTab] = useState('create');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  // Create fund form state
  const [createForm, setCreateForm] = useState({
    agentId: '',
    targetAmount: '',
    investorShareBps: '',
    deadline: '',
  });

  // Lookup state
  const [lookupType, setLookupType] = useState('fundId');
  const [lookupValue, setLookupValue] = useState('');
  const [fundDetail, setFundDetail] = useState(null);

  // Invest form state
  const [investForm, setInvestForm] = useState({
    fundId: '',
    investorAddress: '',
    amount: '',
  });

  const handleCreateFund = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const deadlineTs = createForm.deadline
        ? Math.floor(new Date(createForm.deadline).getTime() / 1000)
        : Math.floor(Date.now() / 1000) + 86400 * 7;
      const res = await createFund({
        agentId: createForm.agentId,
        targetAmount: createForm.targetAmount,
        investorShareBps: Number(createForm.investorShareBps),
        deadline: deadlineTs,
      });
      setResult(res);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const handleLookup = async () => {
    if (!lookupValue) return;
    setLoading(true);
    setError('');
    setFundDetail(null);
    try {
      const res =
        lookupType === 'fundId'
          ? await getFund(lookupValue)
          : await getFundByAgent(lookupValue);
      setFundDetail(res);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const handleInvest = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await investInFund(investForm.fundId, {
        investorAddress: investForm.investorAddress,
        amount: investForm.amount,
      });
      setResult(res);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const bpsToPercent = (bps) => (Number(bps) / 100).toFixed(2);

  const tabs = [
    { id: 'create', label: 'Create Fund' },
    { id: 'lookup', label: 'Lookup Fund' },
    { id: 'invest', label: 'Invest' },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-2">Agent Investment Funds</h1>
      <p className="text-gray-500 mb-6">
        Create investment funds for agents with pro-rata dividend distribution
      </p>

      {/* Eligibility Info Card */}
      <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded">
        <h3 className="text-sm font-semibold text-blue-800 mb-1">Eligibility Requirements</h3>
        <ul className="text-sm text-blue-700 list-disc list-inside space-y-1">
          <li>Agent reputation score must be at least <span className="font-semibold">4.20</span></li>
          <li>Agent must have completed at least <span className="font-semibold">20 tasks</span></li>
          <li>Investor share is specified in basis points (1-5000 bps = 0.01%-50.00%)</li>
          <li>Dividends are distributed pro-rata based on each investor&apos;s contribution</li>
        </ul>
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

      {/* Create Fund */}
      {activeTab === 'create' && (
        <form onSubmit={handleCreateFund} className="space-y-4">
          <h2 className="text-xl font-semibold">Create Fund</h2>
          <p className="text-gray-500 text-sm">
            Launch an investment fund for an eligible agent. Investors contribute USDC and
            receive pro-rata dividends from the agent&apos;s earnings.
          </p>
          <div>
            <label className="block text-sm font-medium mb-1">Agent ID</label>
            <input
              type="text"
              className="w-full border rounded p-2 text-sm font-mono"
              value={createForm.agentId}
              onChange={(e) => setCreateForm({ ...createForm, agentId: e.target.value })}
              placeholder="agent-uuid-or-address"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Target Amount (USDC)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="w-full border rounded p-2 text-sm"
                value={createForm.targetAmount}
                onChange={(e) => setCreateForm({ ...createForm, targetAmount: e.target.value })}
                placeholder="1000.00"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                Investor Share ({createForm.investorShareBps ? bpsToPercent(createForm.investorShareBps) : '0.00'}%)
              </label>
              <input
                type="number"
                min="1"
                max="5000"
                className="w-full border rounded p-2 text-sm"
                value={createForm.investorShareBps}
                onChange={(e) => setCreateForm({ ...createForm, investorShareBps: e.target.value })}
                placeholder="Basis points (1-5000)"
                required
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Deadline</label>
            <input
              type="datetime-local"
              className="w-full border rounded p-2 text-sm"
              value={createForm.deadline}
              onChange={(e) => setCreateForm({ ...createForm, deadline: e.target.value })}
              required
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="bg-primary-600 text-white px-6 py-2 rounded hover:bg-primary-700 disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create Fund'}
          </button>
        </form>
      )}

      {/* Lookup Fund */}
      {activeTab === 'lookup' && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Lookup Fund</h2>
          <p className="text-gray-500 text-sm">
            Search for an existing fund by its fund ID or by the agent ID it belongs to.
          </p>
          <div className="flex space-x-2 mb-2">
            <button
              onClick={() => { setLookupType('fundId'); setFundDetail(null); }}
              className={`px-3 py-1 text-sm rounded ${
                lookupType === 'fundId'
                  ? 'bg-primary-100 text-primary-700 font-medium'
                  : 'bg-gray-100 text-gray-600'
              }`}
            >
              By Fund ID
            </button>
            <button
              onClick={() => { setLookupType('agentId'); setFundDetail(null); }}
              className={`px-3 py-1 text-sm rounded ${
                lookupType === 'agentId'
                  ? 'bg-primary-100 text-primary-700 font-medium'
                  : 'bg-gray-100 text-gray-600'
              }`}
            >
              By Agent ID
            </button>
          </div>
          <div className="flex space-x-2">
            <input
              type="text"
              className="flex-1 border rounded p-2 text-sm font-mono"
              value={lookupValue}
              onChange={(e) => setLookupValue(e.target.value)}
              placeholder={lookupType === 'fundId' ? 'Fund ID' : 'Agent ID'}
            />
            <button
              onClick={handleLookup}
              disabled={loading || !lookupValue}
              className="bg-gray-700 text-white px-4 py-2 rounded hover:bg-gray-800 disabled:opacity-50 text-sm"
            >
              {loading ? 'Searching...' : 'Search'}
            </button>
          </div>

          {fundDetail && (
            <div className="bg-gray-50 rounded p-4 text-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold">Fund #{fundDetail.fundId || fundDetail.id}</span>
                <div className="flex space-x-2">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    fundDetail.active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                  }`}>
                    {fundDetail.active ? 'Active' : 'Inactive'}
                  </span>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    fundDetail.released ? 'bg-blue-100 text-blue-800' : 'bg-yellow-100 text-yellow-800'
                  }`}>
                    {fundDetail.released ? 'Released' : 'Pending'}
                  </span>
                </div>
              </div>
              <div><span className="text-gray-500">Agent:</span> <span className="font-mono text-xs">{fundDetail.agentId}</span></div>
              <div><span className="text-gray-500">Target:</span> {fundDetail.targetAmount} USDC</div>
              <div><span className="text-gray-500">Raised:</span> {fundDetail.raisedAmount || fundDetail.raised || '0'} USDC</div>
              <div>
                <span className="text-gray-500">Progress:</span>{' '}
                <span className="font-medium">
                  {fundDetail.targetAmount
                    ? ((Number(fundDetail.raisedAmount || fundDetail.raised || 0) / Number(fundDetail.targetAmount)) * 100).toFixed(1)
                    : '0'}%
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-primary-600 h-2 rounded-full"
                  style={{
                    width: `${Math.min(
                      100,
                      fundDetail.targetAmount
                        ? (Number(fundDetail.raisedAmount || fundDetail.raised || 0) / Number(fundDetail.targetAmount)) * 100
                        : 0
                    )}%`,
                  }}
                />
              </div>
              <div>
                <span className="text-gray-500">Investor Share:</span>{' '}
                {fundDetail.investorShareBps} bps ({bpsToPercent(fundDetail.investorShareBps)}%)
              </div>
              <div>
                <span className="text-gray-500">Deadline:</span>{' '}
                {fundDetail.deadline
                  ? new Date(Number(fundDetail.deadline) * 1000).toLocaleString()
                  : 'N/A'}
              </div>
              {fundDetail.txHash && (
                <div>
                  <span className="text-gray-500">Tx:</span>{' '}
                  <a
                    href={`https://testnet.arcscan.app/tx/${fundDetail.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary-600 underline font-mono text-xs"
                  >
                    {fundDetail.txHash.slice(0, 16)}...
                  </a>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Invest */}
      {activeTab === 'invest' && (
        <form onSubmit={handleInvest} className="space-y-4">
          <h2 className="text-xl font-semibold">Invest in Fund</h2>
          <p className="text-gray-500 text-sm">
            Contribute USDC to an active fund. Your dividends will be calculated pro-rata
            based on your share of the total raised amount.
          </p>
          <div>
            <label className="block text-sm font-medium mb-1">Fund ID</label>
            <input
              type="text"
              className="w-full border rounded p-2 text-sm font-mono"
              value={investForm.fundId}
              onChange={(e) => setInvestForm({ ...investForm, fundId: e.target.value })}
              placeholder="Fund ID"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Investor Wallet Address</label>
            <input
              type="text"
              className="w-full border rounded p-2 text-sm font-mono"
              value={investForm.investorAddress}
              onChange={(e) => setInvestForm({ ...investForm, investorAddress: e.target.value })}
              placeholder="0x..."
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Amount (USDC)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className="w-full border rounded p-2 text-sm"
              value={investForm.amount}
              onChange={(e) => setInvestForm({ ...investForm, amount: e.target.value })}
              placeholder="100.00"
              required
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="bg-primary-600 text-white px-6 py-2 rounded hover:bg-primary-700 disabled:opacity-50"
          >
            {loading ? 'Investing...' : 'Invest'}
          </button>
        </form>
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
