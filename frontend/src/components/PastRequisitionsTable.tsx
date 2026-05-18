import React from 'react';
import { ConcreteRequisition } from '../types';
import StatusBadge from './StatusBadge';

interface PastRequisitionsTableProps {
  requisitions: ConcreteRequisition[];
  title?: string;
  emptyText?: string;
  onView?: (requisition: ConcreteRequisition) => void;
}

const PastRequisitionsTable: React.FC<PastRequisitionsTableProps> = ({
  requisitions,
  title = 'Past Requisitions',
  emptyText = 'No past approved or dispatched requisitions found.',
  onView,
}) => (
  <div className="overflow-hidden rounded-lg bg-white shadow-md transition-shadow duration-200 ease-out hover:shadow-lg">
    <div className="flex items-center bg-[#003F72] px-5 py-4 text-white">
      <h2 className="text-xl font-semibold">
        {title} ({requisitions.length})
      </h2>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px]">
        <thead className="bg-gray-100">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-bold uppercase text-[#003F72]">Supply ID</th>
            <th className="px-4 py-3 text-left text-xs font-bold uppercase text-[#003F72]">Date</th>
            <th className="px-4 py-3 text-left text-xs font-bold uppercase text-[#003F72]">Location</th>
            <th className="px-4 py-3 text-left text-xs font-bold uppercase text-[#003F72]">Structure</th>
            <th className="px-4 py-3 text-left text-xs font-bold uppercase text-[#003F72]">Grade</th>
            <th className="px-4 py-3 text-right text-xs font-bold uppercase text-[#003F72]">Qty</th>
            <th className="px-4 py-3 text-left text-xs font-bold uppercase text-[#003F72]">Status</th>
            {onView && <th className="px-4 py-3 text-left text-xs font-bold uppercase text-[#003F72]">Action</th>}
          </tr>
        </thead>
        <tbody>
          {requisitions.map((req) => (
            <tr key={req.supply_id} className="border-t border-gray-100 transition-colors duration-150 ease-out hover:bg-blue-50/45">
              <td className="px-4 py-3 font-mono text-sm">{req.supply_id}</td>
              <td className="px-4 py-3 text-sm">{req.requisition_date || new Date(req.req_date).toLocaleDateString()}</td>
              <td className="px-4 py-3 text-sm">{req.location}</td>
              <td className="px-4 py-3 text-sm">{req.structure_name}</td>
              <td className="px-4 py-3 text-sm">{req.grade}</td>
              <td className="px-4 py-3 text-right text-sm">{req.requested_qty.toFixed(2)}</td>
              <td className="px-4 py-3 text-sm">
                <StatusBadge status={req.status} />
              </td>
              {onView && (
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => onView(req)}
                    className="rounded bg-[#003F72] px-3 py-1 text-xs font-semibold text-white shadow-sm transition-all duration-200 ease-out hover:bg-[#002B4E] hover:shadow"
                  >
                    View
                  </button>
                </td>
              )}
            </tr>
          ))}

          {requisitions.length === 0 && (
            <tr>
              <td colSpan={onView ? 8 : 7} className="px-4 py-8 text-center text-sm text-gray-500">
                {emptyText}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  </div>
);

export default PastRequisitionsTable;
