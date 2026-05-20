import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import NegotiationFlow from '../components/NegotiationFlow';
import EscrowStatus from '../components/EscrowStatus';
import { getNegotiationStatus, getEscrowStatus, releaseEscrow, disputeEscrow, settleTask } from '../services/api';

export default function TaskDetail() {
  const { id } = useParams();
  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [escrowStatus, setEscrowStatus] = useState('pending');
  const [escrowAmount, setEscrowAmount] = useState(0);
  const [escrowData, setEscrowData] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [settled, setSettled] = useState(false);

  // Fetch negotiation/task data
  const fetchTaskData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getNegotiationStatus(id);
      const neg = result.negotiation || result;

      setTask({
        id: neg.negotiationId || id,
        description: neg.taskDescription || 'Task details',
        agent: {
          id: neg.toAgentId || 'unknown',
          name: neg.toAgentId || 'Agent',
        },
        requester: neg.fromAgentId || 'requester',
        budget: neg.proposedPrice || 0,
        agreedPrice: neg.agreedPrice,
        deadline: neg.deadline
          ? new Date(neg.deadline * 1000).toISOString().split('T')[0]
          : '',
        createdAt: neg.createdAt
          ? new Date(neg.createdAt).toISOString().split('T')[0]
          : new Date().toISOString().split('T')[0],
        status: neg.status || 'negotiating',
        negotiationId: neg.negotiationId || id,
      });

      // If negotiation is accepted, check escrow status
      if (neg.status === 'accepted' && neg.agreedPrice) {
        setEscrowAmount(neg.agreedPrice);
        try {
          const escrow = await getEscrowStatus(id);
          if (escrow.escrow) {
            setEscrowStatus(escrow.escrow.status || 'pending');
            setEscrowData(escrow.escrow);
          }
        } catch {
          // Escrow not deposited yet
        }
      }
    } catch (err) {
      console.error('Failed to fetch task:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchTaskData();
  }, [fetchTaskData]);

  // Handle escrow lock from NegotiationFlow
  const handleEscrowLock = (price, escrow) => {
    setEscrowAmount(price);
    setEscrowStatus('locked');
    if (escrow) setEscrowData(escrow);
  };

  // Release escrowed funds
  const handleRelease = async () => {
    setActionLoading('release');
    setActionError(null);
    try {
      await releaseEscrow(escrowData?.taskId || id, {});
      setEscrowStatus('released');
      // After release, settle the task (reputation update)
      if (task?.agent?.id) {
        try {
          await settleTask({
            taskId: escrowData?.taskId || id,
            providerAgentId: task.agent.id,
            qualityScore: 90,
          });
          setSettled(true);
        } catch (err) {
          console.warn('Settlement failed:', err.message);
        }
      }
    } catch (err) {
      setActionError(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  // Raise dispute
  const handleDispute = async () => {
    const reason = window.prompt('Please describe the reason for this dispute:');
    if (!reason) return;

    setActionLoading('dispute');
    setActionError(null);
    try {
      await disputeEscrow(escrowData?.taskId || id, { reason });
      setEscrowStatus('disputed');
    } catch (err) {
      setActionError(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <div className="flex gap-1 justify-center mb-4">
          <span className="w-3 h-3 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-3 h-3 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-3 h-3 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
        <p className="text-gray-500">Loading task details...</p>
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Task Not Found</h2>
        <p className="text-gray-500 mb-4">{error || 'This task could not be found.'}</p>
        <Link to="/dashboard" className="btn-primary text-sm">Go to Dashboard</Link>
      </div>
    );
  }

  const statusColor = {
    proposed: 'bg-blue-100 text-blue-700',
    counter_offered: 'bg-yellow-100 text-yellow-700',
    accepted: 'bg-green-100 text-green-700',
    rejected: 'bg-red-100 text-red-700',
    negotiating: 'bg-blue-100 text-blue-700',
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div className="flex items-center gap-3 mb-2">
        <h1 className="section-heading">Task Detail</h1>
        <span className={`badge ${statusColor[task.status] || 'bg-gray-100 text-gray-700'}`}>
          {task.status}
        </span>
      </div>
      <p className="text-gray-500 mb-8 font-mono text-sm">ID: {id}</p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          {/* Task Info */}
          <div className="card p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Task Information</h2>
            <dl className="space-y-3">
              <div>
                <dt className="text-sm text-gray-500">Description</dt>
                <dd className="text-sm text-gray-900 mt-0.5">{task.description}</dd>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <dt className="text-sm text-gray-500">Agent</dt>
                  <dd className="text-sm font-medium text-primary-600 mt-0.5">
                    <Link to={`/agents/${task.agent.id}`} className="hover:underline">
                      {task.agent.name}
                    </Link>
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-gray-500">Budget</dt>
                  <dd className="text-sm font-medium text-gray-900 mt-0.5">{task.budget} USDC</dd>
                </div>
              </div>
              {task.agreedPrice && (
                <div>
                  <dt className="text-sm text-gray-500">Agreed Price</dt>
                  <dd className="text-sm font-bold text-green-700 mt-0.5">{task.agreedPrice} USDC</dd>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <dt className="text-sm text-gray-500">Deadline</dt>
                  <dd className="text-sm text-gray-900 mt-0.5">{task.deadline || 'Not set'}</dd>
                </div>
                <div>
                  <dt className="text-sm text-gray-500">Created</dt>
                  <dd className="text-sm text-gray-900 mt-0.5">{task.createdAt}</dd>
                </div>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Requester</dt>
                <dd className="text-xs font-mono text-gray-600 mt-0.5 break-all">{task.requester}</dd>
              </div>
            </dl>
          </div>

          {/* Negotiation */}
          <NegotiationFlow
            taskId={id}
            negotiationId={task.negotiationId}
            onEscrowLock={handleEscrowLock}
          />
        </div>

        <div className="space-y-6">
          {/* Escrow */}
          <EscrowStatus status={escrowStatus} amount={escrowAmount} />

          {/* Escrow on-chain info */}
          {escrowData && escrowData.txHash && (
            <div className="card p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">On-Chain</h3>
              <dl className="space-y-2">
                <div>
                  <dt className="text-sm text-gray-500">Escrow TX</dt>
                  <dd>
                    <a href={`https://testnet.arcscan.app/tx/${escrowData.txHash}`}
                       target="_blank" rel="noopener noreferrer"
                       className="text-xs font-mono text-primary-600 hover:underline break-all">
                      {escrowData.txHash.slice(0, 14)}...{escrowData.txHash.slice(-8)}
                    </a>
                  </dd>
                </div>
                {escrowData.taskId && (
                  <div>
                    <dt className="text-sm text-gray-500">Task Hash</dt>
                    <dd className="text-xs font-mono text-gray-600 break-all">{escrowData.taskId.slice(0, 14)}...{escrowData.taskId.slice(-8)}</dd>
                  </div>
                )}
              </dl>
            </div>
          )}

          {/* Settlement success */}
          {settled && (
            <div className="card p-6 bg-green-50 border-green-200">
              <div className="flex items-center gap-2 mb-2">
                <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <h3 className="text-lg font-semibold text-green-900">Settled</h3>
              </div>
              <p className="text-sm text-green-700">
                Task completed. Funds released and reputation updated.
              </p>
            </div>
          )}

          {/* Action error */}
          {actionError && (
            <div className="card p-4 bg-red-50 border-red-200">
              <p className="text-sm text-red-700">{actionError}</p>
            </div>
          )}

          {/* Actions */}
          {escrowStatus === 'locked' && !settled && (
            <div className="card p-6 space-y-3">
              <h3 className="text-lg font-semibold text-gray-900">Actions</h3>
              <button
                onClick={handleRelease}
                disabled={actionLoading === 'release'}
                className="btn-primary w-full text-sm disabled:opacity-50"
              >
                {actionLoading === 'release' ? 'Releasing...' : 'Release Funds'}
              </button>
              <button
                onClick={handleDispute}
                disabled={actionLoading === 'dispute'}
                className="w-full text-sm py-2.5 px-4 rounded-lg font-medium bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {actionLoading === 'dispute' ? 'Submitting...' : 'Raise Dispute'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
