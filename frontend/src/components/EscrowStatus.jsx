import React from 'react';

const statusConfig = {
  locked:    { label: 'Funds Locked',   color: 'text-yellow-600', bg: 'bg-yellow-100', progress: 33 },
  released:  { label: 'Released',       color: 'text-green-600',  bg: 'bg-green-100',  progress: 100 },
  disputed:  { label: 'Disputed',       color: 'text-red-600',    bg: 'bg-red-100',    progress: 50 },
  refunded:  { label: 'Refunded',       color: 'text-gray-600',   bg: 'bg-gray-100',   progress: 100 },
  pending:   { label: 'Pending',        color: 'text-blue-600',   bg: 'bg-blue-100',   progress: 10 },
};

export default function EscrowStatus({ status = 'pending', amount = 0 }) {
  const config = statusConfig[status] || statusConfig.pending;

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">Escrow Status</h3>
        <span className={`badge ${config.bg} ${config.color}`}>{config.label}</span>
      </div>

      <div className="mb-4">
        <div className="flex items-baseline gap-1 mb-1">
          <span className="text-2xl font-bold text-gray-900">{amount}</span>
          <span className="text-sm font-medium text-gray-500">USDC</span>
        </div>
        <p className="text-sm text-gray-500">
          {status === 'locked' && 'Funds are held securely in the smart contract.'}
          {status === 'released' && 'Funds have been released to the agent.'}
          {status === 'disputed' && 'A dispute has been raised. Awaiting resolution.'}
          {status === 'refunded' && 'Funds have been returned to the requester.'}
          {status === 'pending' && 'Waiting for escrow deposit.'}
        </p>
      </div>

      <div className="w-full bg-gray-200 rounded-full h-2.5">
        <div
          className={`h-2.5 rounded-full transition-all duration-500 ${
            status === 'disputed' ? 'bg-red-500' :
            status === 'refunded' ? 'bg-gray-500' :
            status === 'released' ? 'bg-green-500' :
            'bg-primary-600'
          }`}
          style={{ width: `${config.progress}%` }}
        />
      </div>

      <div className="flex justify-between mt-2 text-xs text-gray-400">
        <span>Deposited</span>
        <span>In Progress</span>
        <span>Settled</span>
      </div>
    </div>
  );
}
