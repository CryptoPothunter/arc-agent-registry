import React, { useState, useEffect, useCallback } from 'react';
import {
  getPredictionMarkets,
  getPredictionMarket,
  placeBet,
  getMarketPrices,
  getMarketTrades,
} from '../services/api';

const STATUS_COLORS = {
  active: 'bg-green-100 text-green-800',
  resolved: 'bg-blue-100 text-blue-800',
  cancelled: 'bg-gray-100 text-gray-800',
};

export default function PredictionMarkets() {
  const [activeTab, setActiveTab] = useState('markets');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Markets list state
  const [markets, setMarkets] = useState([]);
  const [selectedMarket, setSelectedMarket] = useState(null);

  // Bet form state
  const [betForm, setBetForm] = useState({
    marketId: '',
    bettorAddress: '',
    isAbove: true,
    amount: '',
  });
  const [betResult, setBetResult] = useState(null);

  // Prices and trades state
  const [prices, setPrices] = useState([]);
  const [trades, setTrades] = useState([]);

  // Fetch markets on mount and tab switch
  const fetchMarkets = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getPredictionMarkets();
      setMarkets(Array.isArray(res) ? res : res.markets || []);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, []);

  const fetchPrices = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getMarketPrices();
      setPrices(Array.isArray(res) ? res : res.prices || []);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, []);

  const fetchTrades = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getMarketTrades();
      setTrades(Array.isArray(res) ? res : res.trades || []);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (activeTab === 'markets') fetchMarkets();
    if (activeTab === 'prices') fetchPrices();
    if (activeTab === 'trades') fetchTrades();
  }, [activeTab, fetchMarkets, fetchPrices, fetchTrades]);

  const handleViewMarket = async (marketId) => {
    setLoading(true);
    setError('');
    try {
      const res = await getPredictionMarket(marketId);
      setSelectedMarket(res);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const handlePlaceBet = async (e) => {
    e.preventDefault();
    if (!betForm.marketId || !betForm.bettorAddress || !betForm.amount) return;
    setLoading(true);
    setError('');
    setBetResult(null);
    try {
      const res = await placeBet(betForm.marketId, {
        bettorAddress: betForm.bettorAddress,
        isAbove: betForm.isAbove,
        amount: betForm.amount,
      });
      setBetResult(res);
      setBetForm({ marketId: '', bettorAddress: '', isAbove: true, amount: '' });
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const computeImpliedProbability = (above, below) => {
    const a = parseFloat(above) || 0;
    const b = parseFloat(below) || 0;
    const total = a + b;
    if (total === 0) return '—';
    return `${((a / total) * 100).toFixed(1)}%`;
  };

  const tabs = [
    { id: 'markets', label: 'Active Markets' },
    { id: 'bet', label: 'Place Bet' },
    { id: 'prices', label: 'Market Prices' },
    { id: 'trades', label: 'Recent Trades' },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-2">Prediction Markets</h1>
      <p className="text-gray-500 mb-6">
        Bet on agent task quality scores. Markets resolve based on evaluator ratings (1.00 - 5.00).
      </p>

      {/* Tabs */}
      <div className="flex space-x-1 mb-6 border-b border-gray-200">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setError(''); setBetResult(null); setSelectedMarket(null); }}
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

      {loading && (
        <div className="mb-4 text-sm text-gray-500">Loading...</div>
      )}

      {/* Active Markets Tab */}
      {activeTab === 'markets' && !loading && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Active Prediction Markets</h2>
          {markets.length === 0 ? (
            <p className="text-gray-400 text-sm">No markets found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-gray-500">
                    <th className="py-2 pr-3">Market ID</th>
                    <th className="py-2 pr-3">Agent ID</th>
                    <th className="py-2 pr-3">Task ID</th>
                    <th className="py-2 pr-3">Threshold</th>
                    <th className="py-2 pr-3">Above Pool</th>
                    <th className="py-2 pr-3">Below Pool</th>
                    <th className="py-2 pr-3">Implied Prob.</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {markets.map((m) => (
                    <tr key={m.marketId || m.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2 pr-3 font-mono text-xs">{m.marketId || m.id}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{m.agentId || '—'}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{m.taskId || '—'}</td>
                      <td className="py-2 pr-3">{parseFloat(m.threshold || 0).toFixed(2)}</td>
                      <td className="py-2 pr-3 text-green-700">{m.totalAbove || m.abovePool || '0'} USDC</td>
                      <td className="py-2 pr-3 text-red-700">{m.totalBelow || m.belowPool || '0'} USDC</td>
                      <td className="py-2 pr-3 font-medium">
                        {computeImpliedProbability(
                          m.totalAbove || m.abovePool || 0,
                          m.totalBelow || m.belowPool || 0
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${STATUS_COLORS[m.status] || 'bg-gray-100 text-gray-800'}`}>
                          {m.status || 'active'}
                        </span>
                      </td>
                      <td className="py-2">
                        <button
                          onClick={() => handleViewMarket(m.marketId || m.id)}
                          className="text-primary-600 hover:text-primary-800 text-xs underline"
                        >
                          Details
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Market Detail Panel */}
          {selectedMarket && (
            <div className="bg-gray-50 rounded-lg p-4 text-sm space-y-2 mt-4">
              <div className="flex items-center justify-between">
                <span className="font-semibold">Market #{selectedMarket.marketId || selectedMarket.id}</span>
                <span className={`px-2 py-1 rounded text-xs font-medium ${STATUS_COLORS[selectedMarket.status] || 'bg-gray-100'}`}>
                  {selectedMarket.status || 'active'}
                </span>
              </div>
              <div><span className="text-gray-500">Agent:</span> <span className="font-mono text-xs">{selectedMarket.agentId}</span></div>
              <div><span className="text-gray-500">Task:</span> <span className="font-mono text-xs">{selectedMarket.taskId}</span></div>
              <div><span className="text-gray-500">Threshold:</span> {parseFloat(selectedMarket.threshold || 0).toFixed(2)}</div>
              <div><span className="text-gray-500">Above Pool:</span> <span className="text-green-700">{selectedMarket.totalAbove || selectedMarket.abovePool || '0'} USDC</span></div>
              <div><span className="text-gray-500">Below Pool:</span> <span className="text-red-700">{selectedMarket.totalBelow || selectedMarket.belowPool || '0'} USDC</span></div>
              {selectedMarket.resolvedScore && (
                <div><span className="text-gray-500">Resolved Score:</span> <span className="font-semibold">{parseFloat(selectedMarket.resolvedScore).toFixed(2)}</span></div>
              )}
              {selectedMarket.createdAt && (
                <div><span className="text-gray-500">Created:</span> {new Date(selectedMarket.createdAt).toLocaleString()}</div>
              )}
              <button
                onClick={() => setSelectedMarket(null)}
                className="text-gray-400 hover:text-gray-600 text-xs mt-2"
              >
                Close
              </button>
            </div>
          )}
        </div>
      )}

      {/* Place Bet Tab */}
      {activeTab === 'bet' && (
        <form onSubmit={handlePlaceBet} className="space-y-4">
          <h2 className="text-xl font-semibold">Place a Bet</h2>
          <p className="text-gray-500 text-sm">
            Bet on whether an agent's task quality score will be above or below the market threshold.
          </p>
          <div>
            <label className="block text-sm font-medium mb-1">Market ID</label>
            <input
              type="text"
              className="w-full border rounded p-2 text-sm font-mono"
              value={betForm.marketId}
              onChange={(e) => setBetForm({ ...betForm, marketId: e.target.value })}
              placeholder="Enter market ID"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Wallet Address</label>
            <input
              type="text"
              className="w-full border rounded p-2 text-sm font-mono"
              value={betForm.bettorAddress}
              onChange={(e) => setBetForm({ ...betForm, bettorAddress: e.target.value })}
              placeholder="0x..."
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Position</label>
            <div className="flex space-x-3">
              <button
                type="button"
                onClick={() => setBetForm({ ...betForm, isAbove: true })}
                className={`flex-1 py-2 rounded text-sm font-medium border ${
                  betForm.isAbove
                    ? 'bg-green-600 text-white border-green-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                Above Threshold
              </button>
              <button
                type="button"
                onClick={() => setBetForm({ ...betForm, isAbove: false })}
                className={`flex-1 py-2 rounded text-sm font-medium border ${
                  !betForm.isAbove
                    ? 'bg-red-600 text-white border-red-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                Below Threshold
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Amount (USDC)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className="w-full border rounded p-2 text-sm"
              value={betForm.amount}
              onChange={(e) => setBetForm({ ...betForm, amount: e.target.value })}
              placeholder="10.00"
              required
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="bg-primary-600 text-white px-6 py-2 rounded hover:bg-primary-700 disabled:opacity-50"
          >
            {loading ? 'Placing Bet...' : 'Place Bet'}
          </button>

          {betResult && (
            <div className="mt-4 bg-gray-50 rounded-lg p-4">
              <h3 className="text-sm font-semibold mb-2">Bet Placed</h3>
              <pre className="text-xs overflow-x-auto whitespace-pre-wrap font-mono text-gray-700">
                {JSON.stringify(betResult, null, 2)}
              </pre>
            </div>
          )}
        </form>
      )}

      {/* Market Prices Tab */}
      {activeTab === 'prices' && !loading && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Market Prices</h2>
          <p className="text-gray-500 text-sm">Dynamic capability pricing based on market activity.</p>
          {prices.length === 0 ? (
            <p className="text-gray-400 text-sm">No pricing data available.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-gray-500">
                    <th className="py-2 pr-3">Capability</th>
                    <th className="py-2 pr-3">Current Price</th>
                    <th className="py-2 pr-3">24h Change</th>
                    <th className="py-2 pr-3">Volume</th>
                  </tr>
                </thead>
                <tbody>
                  {prices.map((p, idx) => (
                    <tr key={p.capability || p.id || idx} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2 pr-3 font-medium">{p.capability || p.name || p.id}</td>
                      <td className="py-2 pr-3 font-mono">{p.price || p.currentPrice || '—'} USDC</td>
                      <td className={`py-2 pr-3 font-mono ${
                        parseFloat(p.change24h || p.priceChange || 0) >= 0
                          ? 'text-green-700'
                          : 'text-red-700'
                      }`}>
                        {p.change24h || p.priceChange
                          ? `${parseFloat(p.change24h || p.priceChange) >= 0 ? '+' : ''}${p.change24h || p.priceChange}%`
                          : '—'}
                      </td>
                      <td className="py-2 pr-3 font-mono">{p.volume || p.volume24h || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Recent Trades Tab */}
      {activeTab === 'trades' && !loading && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Recent Trades</h2>
          <p className="text-gray-500 text-sm">Latest bets placed across all prediction markets.</p>
          {trades.length === 0 ? (
            <p className="text-gray-400 text-sm">No trades recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-gray-500">
                    <th className="py-2 pr-3">Time</th>
                    <th className="py-2 pr-3">Market</th>
                    <th className="py-2 pr-3">Bettor</th>
                    <th className="py-2 pr-3">Position</th>
                    <th className="py-2 pr-3">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t, idx) => (
                    <tr key={t.id || t.tradeId || idx} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2 pr-3 text-xs text-gray-500">
                        {t.timestamp || t.createdAt
                          ? new Date(t.timestamp || t.createdAt).toLocaleString()
                          : '—'}
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">{t.marketId || '—'}</td>
                      <td className="py-2 pr-3 font-mono text-xs">
                        {t.bettorAddress
                          ? `${t.bettorAddress.slice(0, 6)}...${t.bettorAddress.slice(-4)}`
                          : t.bettor || '—'}
                      </td>
                      <td className="py-2 pr-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          t.isAbove || t.position === 'above'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {t.isAbove || t.position === 'above' ? 'Above' : 'Below'}
                        </span>
                      </td>
                      <td className="py-2 pr-3 font-mono">{t.amount || '—'} USDC</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
