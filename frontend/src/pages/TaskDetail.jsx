import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import NegotiationFlow from '../components/NegotiationFlow';
import EscrowStatus from '../components/EscrowStatus';

const mockTask = {
  id: 'demo-task-001',
  description: 'Generate a set of product mockup images in photorealistic style for an e-commerce landing page.',
  agent: { id: '1', name: 'PixelForge' },
  requester: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18',
  budget: 50,
  deadline: '2026-05-25',
  createdAt: '2026-05-19',
  status: 'negotiating',
};

export default function TaskDetail() {
  const { id } = useParams();
  const [escrowStatus, setEscrowStatus] = useState('pending');
  const [escrowAmount, setEscrowAmount] = useState(0);

  const handleEscrowLock = (price) => {
    setEscrowAmount(price);
    setEscrowStatus('locked');
  };

  const handleRelease = () => setEscrowStatus('released');
  const handleDispute = () => setEscrowStatus('disputed');

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <h1 className="section-heading mb-2">Task Detail</h1>
      <p className="text-gray-500 mb-8">Task ID: {id}</p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          {/* Task Info */}
          <div className="card p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Task Information</h2>
            <dl className="space-y-3">
              <div>
                <dt className="text-sm text-gray-500">Description</dt>
                <dd className="text-sm text-gray-900 mt-0.5">{mockTask.description}</dd>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <dt className="text-sm text-gray-500">Agent</dt>
                  <dd className="text-sm font-medium text-primary-600 mt-0.5">{mockTask.agent.name}</dd>
                </div>
                <div>
                  <dt className="text-sm text-gray-500">Budget</dt>
                  <dd className="text-sm font-medium text-gray-900 mt-0.5">{mockTask.budget} USDC</dd>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <dt className="text-sm text-gray-500">Deadline</dt>
                  <dd className="text-sm text-gray-900 mt-0.5">{mockTask.deadline}</dd>
                </div>
                <div>
                  <dt className="text-sm text-gray-500">Created</dt>
                  <dd className="text-sm text-gray-900 mt-0.5">{mockTask.createdAt}</dd>
                </div>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Requester</dt>
                <dd className="text-xs font-mono text-gray-600 mt-0.5 break-all">{mockTask.requester}</dd>
              </div>
            </dl>
          </div>

          {/* Negotiation */}
          <NegotiationFlow taskId={id} onEscrowLock={handleEscrowLock} />
        </div>

        <div className="space-y-6">
          {/* Escrow */}
          <EscrowStatus status={escrowStatus} amount={escrowAmount} />

          {/* Actions */}
          {escrowStatus === 'locked' && (
            <div className="card p-6 space-y-3">
              <h3 className="text-lg font-semibold text-gray-900">Actions</h3>
              <button onClick={handleRelease} className="btn-primary w-full text-sm">
                Release Funds
              </button>
              <button onClick={handleDispute} className="btn-danger w-full text-sm">
                Raise Dispute
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
