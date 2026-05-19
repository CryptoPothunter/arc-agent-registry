import React, { useState, useEffect } from 'react';

const mockRounds = [
  { round: 1, from: 'requester', type: 'proposal', price: 50, message: 'I need this image generated in high resolution.' },
  { round: 2, from: 'agent', type: 'counter', price: 65, message: 'High-res rendering requires more compute. Counter at 65 USDC.' },
  { round: 3, from: 'requester', type: 'counter', price: 55, message: 'How about 55 USDC? That should cover the extra compute.' },
  { round: 4, from: 'agent', type: 'accept', price: 55, message: 'Agreed. 55 USDC works. Ready to proceed.' },
];

export default function NegotiationFlow({ taskId, onEscrowLock }) {
  const [rounds, setRounds] = useState([]);
  const [currentRound, setCurrentRound] = useState(0);
  const [isNegotiating, setIsNegotiating] = useState(true);

  // Simulate real-time negotiation rounds arriving
  useEffect(() => {
    if (currentRound >= mockRounds.length) {
      setIsNegotiating(false);
      return;
    }
    const timer = setTimeout(() => {
      setRounds((prev) => [...prev, mockRounds[currentRound]]);
      setCurrentRound((prev) => prev + 1);
    }, 1500);
    return () => clearTimeout(timer);
  }, [currentRound]);

  const lastRound = rounds[rounds.length - 1];
  const isAccepted = lastRound?.type === 'accept';
  const isRejected = lastRound?.type === 'reject';

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
          <div key={i} className={`p-4 rounded-lg border ${typeStyles[r.type]} ${r.from === 'agent' ? 'ml-8' : 'mr-8'}`}>
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
                {typeLabels[r.type]}
              </span>
            </div>
            <p className="text-sm text-gray-700">{r.message}</p>
            <p className="text-sm font-bold text-gray-900 mt-1">{r.price} USDC</p>
          </div>
        ))}

        {isNegotiating && (
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

      {/* Actions */}
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
            onClick={() => onEscrowLock && onEscrowLock(lastRound.price)}
            className="btn-primary w-full"
          >
            Lock Funds in Escrow
          </button>
        </div>
      )}

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
