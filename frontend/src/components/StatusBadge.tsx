import React from 'react';

type StatusTone = {
  label: string;
  className: string;
};

const statusTones: Record<string, StatusTone> = {
  Pending: {
    label: 'Pending',
    className: 'bg-yellow-100 text-yellow-800 ring-yellow-200',
  },
  'Sent Back': {
    label: 'Sent Back',
    className: 'bg-orange-100 text-orange-800 ring-orange-200',
  },
  Draft: {
    label: 'Draft',
    className: 'bg-amber-100 text-amber-800 ring-amber-200',
  },
  Validated: {
    label: 'Approved',
    className: 'bg-cyan-100 text-cyan-800 ring-cyan-200',
  },
  Dispatched: {
    label: 'Dispatched',
    className: 'bg-fuchsia-100 text-fuchsia-800 ring-fuchsia-200',
  },
  Returning: {
    label: 'Returning',
    className: 'bg-violet-100 text-violet-800 ring-violet-200',
  },
  Reconciled: {
    label: 'Reconciled',
    className: 'bg-green-100 text-green-800 ring-green-200',
  },
  Approved: {
    label: 'Approved',
    className: 'bg-green-100 text-green-800 ring-green-200',
  },
  Rejected: {
    label: 'Rejected',
    className: 'bg-red-100 text-red-800 ring-red-200',
  },
  OK: {
    label: 'OK',
    className: 'bg-green-100 text-green-800 ring-green-200',
  },
  VIOLATION: {
    label: 'VIOLATION',
    className: 'bg-red-100 text-red-800 ring-red-200',
  },
  Expired: {
    label: 'Expired',
    className: 'bg-red-100 text-red-800 ring-red-200',
  },
};

interface StatusBadgeProps {
  status?: string | null;
}

const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const tone = status ? statusTones[status] : undefined;
  const label = tone?.label || status || '-';
  const className = tone?.className || 'bg-gray-100 text-gray-700 ring-gray-200';

  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${className}`}>
      {label}
    </span>
  );
};

export default StatusBadge;
