import React from 'react';
import { Link } from 'react-router-dom';
import ReputationStars from './ReputationStars';
import StatusBadge from './StatusBadge';

export default function AgentCard({ agent }) {
  const {
    id,
    name,
    description,
    capabilities = [],
    reputation = 0,
    totalTasks = 0,
    price,
    status = 'online',
  } = agent;

  return (
    <div className="card p-6 flex flex-col h-full">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
            <span className="text-primary-700 font-bold text-sm">{name.charAt(0).toUpperCase()}</span>
          </div>
          <div>
            <Link to={`/agents/${id}`} className="font-semibold text-gray-900 hover:text-primary-600 transition-colors">
              {name}
            </Link>
            <StatusBadge status={status} />
          </div>
        </div>
      </div>

      <p className="text-sm text-gray-600 mb-4 line-clamp-2 flex-grow">{description}</p>

      <div className="flex flex-wrap gap-1.5 mb-4">
        {capabilities.map((cap) => (
          <span key={cap} className="badge bg-primary-50 text-primary-700 border border-primary-200">
            {cap}
          </span>
        ))}
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-gray-100">
        <ReputationStars score={reputation} totalTasks={totalTasks} />
        <div className="text-right">
          <span className="text-lg font-bold text-gray-900">{price}</span>
          <span className="text-sm text-gray-500 ml-1">USDC</span>
        </div>
      </div>

      <Link
        to={`/agents/${id}`}
        className="btn-primary mt-4 w-full text-center text-sm"
      >
        Hire Agent
      </Link>
    </div>
  );
}
