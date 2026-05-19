import React from 'react';

export default function StatusBadge({ status = 'online' }) {
  const isOnline = status === 'online';
  return (
    <span className={`badge ${isOnline ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
      <span className={`w-2 h-2 rounded-full mr-1.5 ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
      {isOnline ? 'Online' : 'Offline'}
    </span>
  );
}
