import React, { useEffect, useMemo, useState } from 'react';
import { authAPI } from '../api';
import { formatDateTimeIST } from '../timeUtils';
import { User, UserRole } from '../types';

interface ProfileViewProps {
  currentUser: User | null;
}

const roleDescriptions: Record<UserRole, string> = {
  [UserRole.EXECUTION]: 'Places requisitions, acknowledges dispatches, and works within assigned site locations.',
  [UserRole.PLANNING]: 'Reviews requisitions, records planning decisions, and tracks approved concrete flow.',
  [UserRole.PRODUCTION]: 'Dispatches vehicles, manages plant returns, and records production-side movement.',
  [UserRole.ADMIN]: 'Manages users, reference data, dashboard analytics, and all requisitions.',
  [UserRole.PLANNING_MANAGER]: 'Accesses every operational area, dashboard analytics, and administration.',
  [UserRole.PROJECT_MANAGER]: 'Reviews dashboard analytics only.',
  [UserRole.HQ_PROJECT_COORDINATOR]: 'Coordinates operational pages and dashboard analytics without administration.',
};

const roleCapabilities: Record<UserRole, string[]> = {
  [UserRole.EXECUTION]: ['Create concrete requisitions', 'View assigned-location orders', 'Acknowledge site receipts'],
  [UserRole.PLANNING]: ['Approve or send back requisitions', 'Review current and past requisitions', 'Receive planning notifications'],
  [UserRole.PRODUCTION]: ['Dispatch concrete vehicles', 'Record return to plant', 'Receive production notifications'],
  [UserRole.ADMIN]: ['Manage users and invites', 'Maintain site reference data', 'View all locations and dashboard analytics'],
  [UserRole.PLANNING_MANAGER]: ['Access all pages', 'Manage users and reference data', 'View dashboard analytics'],
  [UserRole.PROJECT_MANAGER]: ['View dashboard analytics'],
  [UserRole.HQ_PROJECT_COORDINATOR]: ['Create and track requisitions', 'Review planning and production pages', 'View dashboard analytics'],
};

const ProfileView: React.FC<ProfileViewProps> = ({ currentUser }) => {
  const [user, setUser] = useState<User | null>(currentUser);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setUser(currentUser);
  }, [currentUser]);

  const initials = useMemo(() => {
    const source = user?.name || user?.email || 'User';
    return source
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || 'U';
  }, [user]);

  const refreshProfile = async () => {
    try {
      setRefreshing(true);
      setMessage(null);
      const latestUser = await authAPI.me();
      setUser(latestUser);
      setMessage('Profile refreshed.');
    } catch {
      setMessage('Could not refresh profile. Please sign in again if the session has expired.');
    } finally {
      setRefreshing(false);
    }
  };

  if (!user) {
    return (
      <div className="rounded-md border border-gray-200 bg-white p-6 text-sm text-gray-600 shadow-sm">
        No profile is available for the current session.
      </div>
    );
  }

  const assignedLocations = user.assigned_locations || [];
  const locationSummary = assignedLocations.length
    ? `${assignedLocations.length} assigned location${assignedLocations.length === 1 ? '' : 's'}`
    : [UserRole.ADMIN, UserRole.PLANNING_MANAGER, UserRole.HQ_PROJECT_COORDINATOR].includes(user.role)
      ? 'All locations'
      : 'No assigned locations';

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-col gap-5 border-b border-gray-100 px-6 py-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md bg-[#134377] text-xl font-bold text-white">
              {initials}
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-bold text-gray-900">{user.name}</h1>
              <p className="truncate text-sm text-gray-600">{user.email}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-[#134377]/10 px-3 py-1 text-xs font-semibold text-[#134377]">
                  {user.role}
                </span>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  user.is_email_verified ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-800'
                }`}>
                  {user.is_email_verified ? 'Email verified' : 'Email not verified'}
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={refreshProfile}
            disabled={refreshing}
            className="h-10 rounded-md border border-[#134377] px-4 text-sm font-semibold text-[#134377] transition-colors hover:bg-[#134377]/10 disabled:border-gray-300 disabled:text-gray-400"
          >
            {refreshing ? 'Refreshing...' : 'Refresh Profile'}
          </button>
        </div>

        {message && (
          <div className="border-b border-gray-100 px-6 py-3 text-sm font-medium text-gray-700">
            {message}
          </div>
        )}

        <div className="grid gap-0 lg:grid-cols-3">
          <section className="border-b border-gray-100 p-6 lg:border-b-0 lg:border-r">
            <h2 className="text-sm font-bold uppercase tracking-wide text-[#134377]">Account</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="font-semibold text-gray-500">User ID</dt>
                <dd className="mt-1 break-all font-mono text-gray-900">{user.id}</dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-500">Created</dt>
                <dd className="mt-1 text-gray-900">{formatDateTimeIST(user.created_at)}</dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-500">Location Scope</dt>
                <dd className="mt-1 text-gray-900">{locationSummary}</dd>
              </div>
            </dl>
          </section>

          <section className="border-b border-gray-100 p-6 lg:border-b-0 lg:border-r">
            <h2 className="text-sm font-bold uppercase tracking-wide text-[#134377]">Role Access</h2>
            <p className="mt-4 text-sm leading-6 text-gray-700">{roleDescriptions[user.role]}</p>
            <ul className="mt-4 space-y-2">
              {roleCapabilities[user.role].map((capability) => (
                <li key={capability} className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                  {capability}
                </li>
              ))}
            </ul>
          </section>

          <section className="p-6">
            <h2 className="text-sm font-bold uppercase tracking-wide text-[#134377]">Security</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="font-semibold text-gray-500">Session</dt>
                <dd className="mt-1 text-gray-900">Authenticated with the current browser token.</dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-500">Password</dt>
                <dd className="mt-1 text-gray-900">Managed by the sign-in system.</dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-500">Notifications</dt>
                <dd className="mt-1 text-gray-900">Sent to the profile email according to role and location scope.</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>

      <section className="rounded-md border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wide text-[#134377]">Assigned Locations</h2>
            <p className="mt-1 text-sm text-gray-600">Controls location-filtered requisitions, dispatch summary rows, and execution notifications.</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {assignedLocations.length ? (
            assignedLocations.map((location) => (
              <span key={location} className="rounded-full bg-[#134377]/10 px-3 py-1 text-sm font-semibold text-[#134377]">
                {location}
              </span>
            ))
          ) : (
            <span className="text-sm text-gray-500">
              {[UserRole.ADMIN, UserRole.PLANNING_MANAGER, UserRole.HQ_PROJECT_COORDINATOR].includes(user.role)
                ? 'This role can access every location.'
                : 'No locations are currently assigned.'}
            </span>
          )}
        </div>
      </section>
    </div>
  );
};

export default ProfileView;
