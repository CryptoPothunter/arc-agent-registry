import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getNegotiationStatus, respondToNegotiation, depositEscrow } from '../services/api';
import useWebSocket from '../hooks/useWebSocket';

export default function NegotiationFlow({ taskId, negotiationId, onEscrowLock }) {
  const [rounds, setRounds] = useState([]);
  const [isNegotiating, setIsNegotiating] = useState(true);
  const [counterPrice, setCounterPrice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [depositing, setDepositing] = useState(false);
  const pollRef = useRef(null);
  const effectiveNegId = negotiationId || taskId;

  // Fetch negotiation status from API
  const fetchStatus = useCallback(async () => {
    if (!effectiveNegId) return;
    try {
      const result = await getNegotiationStatus(effectiveNegId);
      const neg = result.negotiation || result;

      if (neg.history && neg.history.length > 0) {
        const mapped = neg.history.map((h, i) => ({
          round: i + 1,
          from: h.from === neg.toAgentId ? 'agent' : 'requester',
          type: h.action === 'propose' ? 'proposal' : h.action,
          price: h.price || neg.proposedPrice,
          message: h.action === 'propose'
            ? `Proposed ${h.price} USDC for this task.`
            : h.action === 'counter'
            ? `Counter offer at ${h.price} USDC.`
            : h.action === 'accept'
            ? `Agreed at ${h.price} USDC. Ready to proceed.`
            : h.action === 'reject'
            ? `Negotiation rejected${h.reason ? ': ' + h.reason : ''}.`
            : h.action,
          timestamp: h.timestamp,
        }));
        setRounds(mapped);
      }

      // Check if negotiation is terminal
      if (neg.status === 'accepted' || neg.status === 'rejected' || neg.status === 'expired') {
        setIsNegotiating(false);
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
    } catch (err) {
      // Negotiation not found yet - may still be processing
      if (!err.message.includes('not found')) {
        console.error('Failed to fetch negotiation:', err);
      }
    }
  }, [effectiveNegId]);

  // Poll for updates every 2 seconds while negotiating
  useEffect(() => {
    fetchStatus();
    if (isNegotiating && effectiveNegId) {
      pollRef.current = setInterval(fetchStatus, 2000);
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [fetchStatus, isNegotiating, effectiveNegId]);

  // #34: Use useWebSocket hook instead of inline WebSocket
  const { lastMessage: wsMessage } = useWebSocket({
    topics: effectiveNegId ? [`agent:requester:negotiation`] : [],
    autoConnect: !!effectiveNegId,
  });

  // Refresh when we get a WebSocket message for this negotiation
  useEffect(() => {
    if (wsMessage && wsMessage.negotiationId === effectiveNegId) {
      fetchStatus();
    }
  }, [wsMessage, effectiveNegId, fetchStatus]);

  // Handle counter-offer submission
  const handleCounter = async () => {
    if (!counterPrice || isNaN(Number(counterPrice))) return;
    setSubmitting(true);
    setError(null);
    try {
      await respondToNegotiation(effectiveNegId, {
        action: 'counter',
        counterPrice: Number(counterPrice),
        fromAgentId: 'requester',
      });
      setCounterPrice('');
      await fetchStatus();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Handle accept
  const handleAccept = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await respondToNegotiation(effectiveNegId, {
        action: 'accept',
      });
      await fetchStatus();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Handle reject
  const handleReject = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await respondToNegotiation(effectiveNegId, {
        action: 'reject',
        reason: 'Rejected by requester',
      });
      await fetchStatus();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Handle escrow deposit
  const handleDeposit = async (price) => {
    setDepositing(true);
    setError(null);
    try {
      const result = await depositEscrow({
        providerAddress: '0x0000000000000000000000000000000000000000',
        amount: price,
        deadline: Math.floor(Date.now() / 1000) + 86400,
        negotiationId: effectiveNegId,
      });
      if (onEscrowLock) {
        onEscrowLock(price, result.escrow);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setDepositing(false);
    }
  };

  const lastRound = rounds[rounds.length - 1];
  const isAccepted = lastRound?.type === 'accept';
  const isRejected = lastRound?.type === 'reject';
  const isCounterFromAgent = lastRound?.type === 'counter' && lastRound?.from === 'agent';

  const typeStyles = {
    proposal: 'bg-blue-50 border-blue-200',
    counter:  'bg-yellow-50 border-yellow-200',
    accept:   'bg-green-50 border-green-200',
    reject:   'bg-red-50 border-red-200',
  };

  const typeLabels = {
    proposal: 'Proposal',
    counter:  'Counter Offer',
    accept:   'Accepted',
    reject:   'Rejected',
  };

  return (
    <div className="card p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Negotiation</h3>

      {/* Rounds list */}
      <div className="space-y-3 mb-6">
        {rounds.map((r, i) => (
          <div key={i} className={`p-4 rounded-lg border ${typeStyles[r.type] || 'bg-gray-50 border-gray-200'} ${r.from === 'agent' ? 'ml-8' : 'mr-8'}`}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Round {r.round} &middot; {r.from === 'agent' ? 'Agent' : 'You'}
              </span>
              <span className={`badge ${
                r.type === 'accept' ? 'bg-green-100 text-green-700' :
                r.type === 'reject' ? 'bg-red-100 text-red-700' :
                r.type === 'counter' ? 'bg-yellow-100 text-yellow-700' :
                'bg-blue-100 text-blue-700'
              }`}>
                {typeLabels[r.type] || r.type}
              </span>
            </div>
            <p className="text-sm text-gray-700">{r.message}</p>
            <div className="flex items-center justify-between mt-1">
              <p className="text-sm font-bold text-gray-900">{r.price} USDC</p>
              {r.timestamp && (
                <p className="text-xs text-gray-400">{new Date(r.timestamp).toLocaleTimeString()}</p>
              )}
            </div>
          </div>
        ))}

        {isNegotiating && rounds.length === 0 && (
          <div className="text-center py-8 text-gray-400">
            <p className="text-sm">Waiting for negotiation data...</p>
          </div>
        )}

        {isNegotiating && rounds.length > 0 && (
          <div className="flex items-center gap-2 text-sm text-gray-500 pl-2">
            <div className="flex gap-1">
              <span className="w-2 h-2 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            Negotiating...
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Counter-offer controls (when agent sends a counter) */}
      {isCounterFromAgent && !isAccepted && !isRejected && (
        <div className="border-t border-gray-100 pt-4 space-y-3">
          <p className="text-sm text-gray-600">The agent has counter-offered. You can accept, counter, or reject.</p>
          <div className="flex gap-2">
            <button onClick={handleAccept} disabled={submitting} className="btn-primary text-sm py-2 flex-1 disabled:opacity-50">
              {submitting ? '...' : `Accept ${lastRound.price} USDC`}
            </button>
            <button onClick={handleReject} disabled={submitting} className="btn-danger text-sm py-2 disabled:opacity-50">
              Reject
            </button>
          </div>
          <div className="flex gap-2">
            <input
              type="number"
              placeholder="Your counter price"
              className="input-field text-sm flex-1"
              value={counterPrice}
              onChange={(e) => setCounterPrice(e.target.value)}
            />
            <button
              onClick={handleCounter}
              disabled={submitting || !counterPrice}
              className="btn-secondary text-sm py-2 disabled:opacity-50"
            >
              Counter
            </button>
          </div>
        </div>
      )}

      {/* Accepted - Lock escrow */}
      {isAccepted && (
        <div className="border-t border-gray-100 pt-4">
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm font-medium text-green-700">
              Agreement reached at {lastRound.price} USDC
            </span>
          </div>
          <button
            onClick={() => handleDeposit(lastRound.price)}
            disabled={depositing}
            className="btn-primary w-full disabled:opacity-50"
          >
            {depositing ? 'Depositing...' : 'Lock Funds in Escrow'}
          </button>
        </div>
      )}

      {/* Rejected */}
      {isRejected && (
        <div className="border-t border-gray-100 pt-4">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm font-medium text-red-700">Negotiation was rejected.</span>
          </div>
        </div>
      )}
    </div>
  );
}
