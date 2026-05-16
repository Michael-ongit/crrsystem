// App.tsx - Root React component with routing and authentication
import React, { useEffect, useState } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from 'react-router-dom';
import { authAPI, setAuthToken } from './api';
import { AuthResponse, AuthState, UserRole } from './types';
import Layout from './components/Layout';
import ExecutionView from './pages/ExecutionView';
import PlanningView from './pages/PlanningView';
import ProductionView from './pages/ProductionView';
import DispatchSummaryView from './pages/DispatchSummaryView';
import ReconciliationDashboard from './pages/ReconciliationDashboard';
import AuthPage from './pages/AuthPage';

const routeForRole = (role: UserRole) => {
  if (role === UserRole.EXECUTION) return '/execution';
  if (role === UserRole.PLANNING) return '/planning';
  if (role === UserRole.PRODUCTION) return '/production';
  return '/dashboard';
};

const resetAuthState = (): AuthState => ({
  user: null,
  isAuthenticated: false,
  currentRole: UserRole.EXECUTION,
  token: null,
});

const App: React.FC = () => {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    currentRole: UserRole.EXECUTION,
    token: localStorage.getItem('authToken'),
  });
  const [checkingSession, setCheckingSession] = useState(Boolean(authState.token));

  useEffect(() => {
    const handleExpiredSession = () => setAuthState(resetAuthState());
    window.addEventListener('auth:expired', handleExpiredSession);
    return () => window.removeEventListener('auth:expired', handleExpiredSession);
  }, []);

  useEffect(() => {
    if (!authState.token) {
      setCheckingSession(false);
      return;
    }

    const restoreSession = async () => {
      try {
        const user = await authAPI.me();
        setAuthState({
          user,
          isAuthenticated: true,
          currentRole: user.role,
          token: authState.token,
        });
      } catch {
        setAuthToken(null);
        setAuthState(resetAuthState());
      } finally {
        setCheckingSession(false);
      }
    };

    restoreSession();
  }, [authState.token]);

  const handleLogin = (auth: AuthResponse) => {
    setAuthToken(auth.access_token);
    setAuthState({
      user: auth.user,
      isAuthenticated: true,
      currentRole: auth.user.role,
      token: auth.access_token,
    });
  };

  const handleLogout = async () => {
    try {
      await authAPI.logout();
    } catch {
      // Session may already be invalid; local logout should still complete.
    } finally {
      setAuthToken(null);
      setAuthState(resetAuthState());
    }
  };

  if (checkingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#003F72]"></div>
      </div>
    );
  }

  if (!authState.isAuthenticated) {
    return <AuthPage onLogin={handleLogin} />;
  }

  return (
    <Router>
      <Layout
        currentUser={authState.user}
        currentRole={authState.currentRole}
        onLogout={handleLogout}
      >
        <Routes>
          {[UserRole.EXECUTION, UserRole.ADMIN].includes(authState.currentRole) && (
            <Route path="/execution" element={<ExecutionView currentUser={authState.user} />} />
          )}

          {[UserRole.PLANNING, UserRole.ADMIN].includes(authState.currentRole) && (
            <Route path="/planning" element={<PlanningView currentUser={authState.user} />} />
          )}

          {[UserRole.PRODUCTION, UserRole.ADMIN].includes(authState.currentRole) && (
            <Route path="/production" element={<ProductionView />} />
          )}

          {[UserRole.PRODUCTION, UserRole.ADMIN].includes(authState.currentRole) && (
            <Route path="/dispatch-summary" element={<DispatchSummaryView />} />
          )}

          {authState.currentRole === UserRole.ADMIN && (
            <Route path="/dashboard" element={<ReconciliationDashboard />} />
          )}
          <Route path="/" element={<Navigate to={routeForRole(authState.currentRole)} replace />} />
          <Route path="*" element={<Navigate to={routeForRole(authState.currentRole)} replace />} />
        </Routes>
      </Layout>
    </Router>
  );
};

export default App;
