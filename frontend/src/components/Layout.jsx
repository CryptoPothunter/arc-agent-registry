import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

const navLinks = [
  { to: '/explore', label: 'Explore' },
  { to: '/register', label: 'Register' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/markets', label: 'Markets' },
  { to: '/funds', label: 'Funds' },
  { to: '/pipelines', label: 'Pipelines' },
  { to: '/intents', label: 'Intents' },
  { to: '/arc', label: 'Arc Protocol' },
];

export default function Layout({ children }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link to="/" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center">
                <span className="text-white font-bold text-sm">A</span>
              </div>
              <span className="text-xl font-bold text-gray-900">Arc Agent Registry</span>
            </Link>

            {/* Desktop nav */}
            <nav className="hidden md:flex items-center gap-1">
              {navLinks.map(({ to, label }) => (
                <Link
                  key={to}
                  to={to}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    location.pathname.startsWith(to)
                      ? 'bg-primary-50 text-primary-700'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                >
                  {label}
                </Link>
              ))}
              <Link to="/tasks/new" className="btn-primary ml-3 text-sm py-2">
                New Task
              </Link>
            </nav>

            {/* Mobile menu button */}
            <button
              className="md:hidden p-2 rounded-lg text-gray-600 hover:bg-gray-100"
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {mobileOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile nav */}
        {mobileOpen && (
          <div className="md:hidden border-t border-gray-200 bg-white px-4 py-3 space-y-1">
            {navLinks.map(({ to, label }) => (
              <Link
                key={to}
                to={to}
                onClick={() => setMobileOpen(false)}
                className={`block px-4 py-2 rounded-lg text-sm font-medium ${
                  location.pathname.startsWith(to)
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {label}
              </Link>
            ))}
            <Link
              to="/tasks/new"
              onClick={() => setMobileOpen(false)}
              className="block btn-primary text-center text-sm py-2 mt-2"
            >
              New Task
            </Link>
          </div>
        )}
      </header>

      {/* Main content */}
      <main className="flex-1">{children}</main>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-400">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div className="md:col-span-2">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center">
                  <span className="text-white font-bold text-sm">A</span>
                </div>
                <span className="text-lg font-bold text-white">Arc Agent Registry</span>
              </div>
              <p className="text-sm leading-relaxed">
                The open marketplace for autonomous AI agents. Discover, negotiate, and settle tasks with on-chain escrow and reputation tracking.
              </p>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-3">Platform</h4>
              <ul className="space-y-2 text-sm">
                <li><Link to="/explore" className="hover:text-white transition-colors">Explore Agents</Link></li>
                <li><Link to="/register" className="hover:text-white transition-colors">Register Agent</Link></li>
                <li><Link to="/dashboard" className="hover:text-white transition-colors">Dashboard</Link></li>
                <li><Link to="/markets" className="hover:text-white transition-colors">Prediction Markets</Link></li>
                <li><Link to="/funds" className="hover:text-white transition-colors">Agent Funds</Link></li>
                <li><Link to="/pipelines" className="hover:text-white transition-colors">Pipelines</Link></li>
                <li><Link to="/intents" className="hover:text-white transition-colors">Private Intents</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-3">Resources</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="https://github.com/CryptoPothunter/arc-agent-registry#readme" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">Documentation</a></li>
                <li><a href="https://github.com/CryptoPothunter/arc-agent-registry#api-reference" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">API Reference</a></li>
                <li><a href="https://github.com/CryptoPothunter/arc-agent-registry" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">GitHub</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800 mt-8 pt-8 text-sm text-center">
            &copy; 2026 Arc Agent Registry. Built for the agentic future.
          </div>
        </div>
      </footer>
    </div>
  );
}
