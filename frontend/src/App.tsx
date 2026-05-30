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
import AdminView from './pages/AdminView';
import ProfileView from './pages/ProfileView';

const routeForRole = (role: UserRole) => {
  if (role === UserRole.PROJECT_MANAGER) return '/dashboard';
  if (role === UserRole.PLANNING_MANAGER) return '/admin';
  if (role === UserRole.HQ_PROJECT_COORDINATOR) return '/execution';
  if (role === UserRole.EXECUTION) return '/execution';
  if (role === UserRole.PLANNING) return '/planning';
  if (role === UserRole.PRODUCTION) return '/production';
  return '/admin';
};

const fullAccessRoles = [UserRole.ADMIN, UserRole.PLANNING_MANAGER];
const operationalAccessRoles = [...fullAccessRoles, UserRole.HQ_PROJECT_COORDINATOR];
const dashboardRoles = [...operationalAccessRoles, UserRole.PROJECT_MANAGER];

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
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#134377]"></div>
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
          {[UserRole.EXECUTION, ...operationalAccessRoles].includes(authState.currentRole) && (
            <Route path="/execution" element={<ExecutionView currentUser={authState.user} />} />
          )}

          {[UserRole.PLANNING, ...operationalAccessRoles].includes(authState.currentRole) && (
            <Route path="/planning" element={<PlanningView currentUser={authState.user} />} />
          )}

          {[UserRole.PRODUCTION, ...operationalAccessRoles].includes(authState.currentRole) && (
            <Route path="/production" element={<ProductionView />} />
          )}

          {[UserRole.EXECUTION, ...operationalAccessRoles].includes(authState.currentRole) && (
            <Route path="/dispatch-summary" element={<DispatchSummaryView currentUser={authState.user} />} />
          )}

          {dashboardRoles.includes(authState.currentRole) && (
            <Route path="/dashboard" element={<ReconciliationDashboard />} />
          )}
          {fullAccessRoles.includes(authState.currentRole) && (
            <Route path="/admin" element={<AdminView />} />
          )}
          <Route path="/profile" element={<ProfileView currentUser={authState.user} />} />
          <Route path="/" element={<Navigate to={routeForRole(authState.currentRole)} replace />} />
          <Route path="*" element={<Navigate to={routeForRole(authState.currentRole)} replace />} />
        </Routes>
      </Layout>
    </Router>
  );
};

export default App;
