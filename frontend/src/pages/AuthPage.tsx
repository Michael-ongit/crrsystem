import React, { useState } from 'react';
import { authAPI } from '../api';
import { AuthResponse, UserRole } from '../types';

interface AuthPageProps {
  onLogin: (auth: AuthResponse) => void;
}

const AuthPage: React.FC<AuthPageProps> = ({ onLogin }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>(UserRole.EXECUTION);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      if (mode === 'register') {
        const result = await authAPI.register({ name, email, password, role });
        setMessage({ type: 'success', text: result.message });
        setMode('login');
      } else {
        const result = await authAPI.login({ email, password });
        onLogin(result);
      }
    } catch (error: any) {
      setMessage({
        type: 'error',
        text: error.response?.data?.detail || 'Authentication failed',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-lg shadow p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">
            Concrete Requisition & Reconciliation System
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            {mode === 'login' ? 'Sign in with your email' : 'Create your development account'}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-6">
          <button
            type="button"
            onClick={() => setMode('login')}
            className={`py-2 rounded text-sm font-semibold ${
              mode === 'login' ? 'bg-[#003F72] text-white' : 'bg-gray-100 text-gray-700'
            }`}
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => setMode('register')}
            className={`py-2 rounded text-sm font-semibold ${
              mode === 'register' ? 'bg-[#003F72] text-white' : 'bg-gray-100 text-gray-700'
            }`}
          >
            Register
          </button>
        </div>

        {message && (
          <div
            className={`mb-4 p-3 rounded text-sm border ${
              message.type === 'success'
                ? 'bg-green-50 text-green-700 border-green-200'
                : message.type === 'info'
                  ? 'bg-[#003F72]/10 text-[#003F72] border-[#003F72]/20'
                  : 'bg-red-50 text-red-700 border-red-200'
            }`}
          >
            {message.text}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Name</label>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={mode === 'register' ? 8 : 1}
              className="w-full px-3 py-2 border border-gray-300 rounded"
            />
          </div>

          {mode === 'register' && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Role</label>
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as UserRole)}
                className="w-full px-3 py-2 border border-gray-300 rounded"
              >
                {Object.values(UserRole).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#003F72] hover:bg-[#002B4E] disabled:bg-gray-400 text-white font-semibold py-2 rounded"
          >
            {loading ? 'Please wait...' : mode === 'login' ? 'Login' : 'Register'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default AuthPage;
