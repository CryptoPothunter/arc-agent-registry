import React, { useState } from 'react';
import { registerAgent } from '../services/api';

const initialForm = {
  name: '', description: '', walletAddress: '',
  capabilities: [],
  availability: { schedule: 'always', timezone: 'UTC', maxConcurrent: 5 },
};

const emptyCapability = { name: '', description: '', inputSchema: '', outputSchema: '', price: '' };

export default function Register() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(initialForm);
  const [newCap, setNewCap] = useState({ ...emptyCapability });
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [registeredAgent, setRegisteredAgent] = useState(null);

  const update = (field, value) => setForm((f) => ({ ...f, [field]: value }));

  const addCapability = () => {
    if (!newCap.name) return;
    setForm((f) => ({ ...f, capabilities: [...f.capabilities, { ...newCap, price: Number(newCap.price) }] }));
    setNewCap({ ...emptyCapability });
  };

  const removeCapability = (i) => {
    setForm((f) => ({ ...f, capabilities: f.capabilities.filter((_, idx) => idx !== i) }));
  };

  const canNext = () => {
    if (step === 1) return form.name && form.description && form.walletAddress;
    if (step === 2) return form.capabilities.length > 0;
    return true;
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const metadata = {
        name: form.name,
        description: form.description,
        capabilities: form.capabilities.map((c) => c.name),
        capabilityDetails: form.capabilities,
        pricePerTask: form.capabilities.length > 0
          ? Math.min(...form.capabilities.map((c) => c.price))
          : 0,
        endpoint: `https://agent.arc.network/${form.name.toLowerCase().replace(/\s+/g, '-')}`,
        availability: form.availability,
      };

      const result = await registerAgent({
        metadata,
        walletAddress: form.walletAddress,
      });

      setRegisteredAgent(result.agent);
      setSubmitted(true);
    } catch (err) {
      console.error('Registration failed:', err);
      setSubmitError(err.message || 'Registration failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-green-100 flex items-center justify-center">
          <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Agent Registered!</h2>
        <p className="text-gray-500 mb-2">Your agent <span className="font-semibold">{form.name}</span> has been successfully registered on the Arc Agent Registry.</p>
        {registeredAgent && (
          <div className="text-left bg-gray-50 rounded-lg p-4 mb-6 max-w-md mx-auto">
            <p className="text-sm text-gray-600"><span className="font-medium">Agent ID:</span> {registeredAgent.agentId}</p>
            {registeredAgent.txHash && (
              <p className="text-sm text-gray-600 mt-1">
                <span className="font-medium">TX:</span>{' '}
                <a href={`https://testnet.arcscan.app/tx/${registeredAgent.txHash}`} target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:underline font-mono text-xs">
                  {registeredAgent.txHash.slice(0, 10)}...{registeredAgent.txHash.slice(-8)}
                </a>
              </p>
            )}
            <p className="text-sm text-gray-600 mt-1"><span className="font-medium">Metadata CID:</span> <span className="font-mono text-xs">{registeredAgent.metadataURI?.slice(0, 20)}...</span></p>
          </div>
        )}
        {!registeredAgent && <div className="mb-6" />}
        <a href="/dashboard" className="btn-primary">Go to Dashboard</a>
      </div>
    );
  }

  const stepLabels = ['Basic Info', 'Capabilities', 'Availability', 'Review'];

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <h1 className="section-heading mb-2">Register Your Agent</h1>
      <p className="text-gray-500 mb-8">Set up your AI agent in four simple steps.</p>

      {/* Progress */}
      <div className="flex items-center mb-10">
        {stepLabels.map((label, i) => (
          <React.Fragment key={label}>
            <div className="flex flex-col items-center">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold ${
                step > i + 1 ? 'bg-green-500 text-white' :
                step === i + 1 ? 'bg-primary-600 text-white' :
                'bg-gray-200 text-gray-500'
              }`}>
                {step > i + 1 ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                ) : i + 1}
              </div>
              <span className="text-xs mt-1 text-gray-500 hidden sm:block">{label}</span>
            </div>
            {i < 3 && <div className={`flex-1 h-0.5 mx-2 ${step > i + 1 ? 'bg-green-500' : 'bg-gray-200'}`} />}
          </React.Fragment>
        ))}
      </div>

      <div className="card p-8">
        {/* Step 1 */}
        {step === 1 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-gray-900">Basic Information</h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Agent Name</label>
              <input className="input-field" placeholder="e.g. PixelForge" value={form.name} onChange={(e) => update('name', e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea className="input-field h-28 resize-none" placeholder="Describe what your agent does..." value={form.description} onChange={(e) => update('description', e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Wallet Address</label>
              <input className="input-field font-mono" placeholder="0x..." value={form.walletAddress} onChange={(e) => update('walletAddress', e.target.value)} />
            </div>
          </div>
        )}

        {/* Step 2 */}
        {step === 2 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-gray-900">Capabilities</h2>
            {form.capabilities.length > 0 && (
              <div className="space-y-3">
                {form.capabilities.map((cap, i) => (
                  <div key={i} className="flex items-start justify-between border border-gray-200 rounded-lg p-3">
                    <div>
                      <span className="badge bg-primary-50 text-primary-700 border border-primary-200">{cap.name}</span>
                      <p className="text-sm text-gray-600 mt-1">{cap.description}</p>
                      <span className="text-sm font-medium text-gray-900">{cap.price} USDC</span>
                    </div>
                    <button onClick={() => removeCapability(i)} className="text-red-500 hover:text-red-700 text-sm ml-2">Remove</button>
                  </div>
                ))}
              </div>
            )}
            <div className="border border-dashed border-gray-300 rounded-lg p-4 space-y-3">
              <p className="text-sm font-medium text-gray-700">Add a capability</p>
              <div className="grid grid-cols-2 gap-3">
                <input className="input-field" placeholder="Capability name" value={newCap.name} onChange={(e) => setNewCap({ ...newCap, name: e.target.value })} />
                <input className="input-field" placeholder="Price (USDC)" type="number" value={newCap.price} onChange={(e) => setNewCap({ ...newCap, price: e.target.value })} />
              </div>
              <textarea className="input-field h-16 resize-none" placeholder="Description" value={newCap.description} onChange={(e) => setNewCap({ ...newCap, description: e.target.value })} />
              <div className="grid grid-cols-2 gap-3">
                <input className="input-field font-mono text-sm" placeholder='Input schema (JSON)' value={newCap.inputSchema} onChange={(e) => setNewCap({ ...newCap, inputSchema: e.target.value })} />
                <input className="input-field font-mono text-sm" placeholder='Output schema (JSON)' value={newCap.outputSchema} onChange={(e) => setNewCap({ ...newCap, outputSchema: e.target.value })} />
              </div>
              <button onClick={addCapability} className="btn-secondary text-sm py-2">+ Add Capability</button>
            </div>
          </div>
        )}

        {/* Step 3 */}
        {step === 3 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-gray-900">Availability Settings</h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Schedule</label>
              <select className="input-field" value={form.availability.schedule} onChange={(e) => update('availability', { ...form.availability, schedule: e.target.value })}>
                <option value="always">Always Available</option>
                <option value="business">Business Hours (9-5)</option>
                <option value="custom">Custom Schedule</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Timezone</label>
              <select className="input-field" value={form.availability.timezone} onChange={(e) => update('availability', { ...form.availability, timezone: e.target.value })}>
                <option value="UTC">UTC</option>
                <option value="US/Eastern">US/Eastern</option>
                <option value="US/Pacific">US/Pacific</option>
                <option value="Europe/London">Europe/London</option>
                <option value="Asia/Tokyo">Asia/Tokyo</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Max Concurrent Tasks</label>
              <input className="input-field" type="number" min={1} max={100} value={form.availability.maxConcurrent} onChange={(e) => update('availability', { ...form.availability, maxConcurrent: Number(e.target.value) })} />
            </div>
          </div>
        )}

        {/* Step 4 */}
        {step === 4 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-gray-900">Review & Submit</h2>
            <div className="space-y-4">
              <div className="border border-gray-200 rounded-lg p-4">
                <h3 className="text-sm font-medium text-gray-500 mb-2">Basic Info</h3>
                <p className="font-medium text-gray-900">{form.name}</p>
                <p className="text-sm text-gray-600">{form.description}</p>
                <p className="text-sm font-mono text-gray-500 mt-1">{form.walletAddress}</p>
              </div>
              <div className="border border-gray-200 rounded-lg p-4">
                <h3 className="text-sm font-medium text-gray-500 mb-2">Capabilities ({form.capabilities.length})</h3>
                <div className="flex flex-wrap gap-2">
                  {form.capabilities.map((c, i) => (
                    <span key={i} className="badge bg-primary-50 text-primary-700 border border-primary-200">{c.name} - {c.price} USDC</span>
                  ))}
                </div>
              </div>
              <div className="border border-gray-200 rounded-lg p-4">
                <h3 className="text-sm font-medium text-gray-500 mb-2">Availability</h3>
                <p className="text-sm text-gray-900">{form.availability.schedule} &middot; {form.availability.timezone} &middot; Max {form.availability.maxConcurrent} concurrent</p>
              </div>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex justify-between mt-8 pt-6 border-t border-gray-100">
          <button
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            className={`btn-secondary text-sm py-2 ${step === 1 ? 'invisible' : ''}`}
          >
            Back
          </button>
          {step < 4 ? (
            <button onClick={() => setStep((s) => s + 1)} disabled={!canNext()} className="btn-primary text-sm py-2 disabled:opacity-50 disabled:cursor-not-allowed">
              Continue
            </button>
          ) : (
            <button onClick={handleSubmit} disabled={submitting} className="btn-primary text-sm py-2 disabled:opacity-50 disabled:cursor-not-allowed">
              {submitting ? 'Registering...' : 'Register Agent'}
            </button>
          )}
        </div>
        {submitError && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-700">{submitError}</p>
          </div>
        )}
      </div>
    </div>
  );
}
