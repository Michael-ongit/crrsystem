import React from 'react';
import { ConcreteRequisition } from '../types';

interface PastRequisitionsTableProps {
  requisitions: ConcreteRequisition[];
  title?: string;
  emptyText?: string;
  onView?: (requisition: ConcreteRequisition) => void;
}

const PastRequisitionsTable: React.FC<PastRequisitionsTableProps> = ({
  requisitions,
  title = 'Past Requisitions / Order History',
  emptyText = 'No past approved or dispatched requisitions found.',
  onView,
}) => (
  <div className="overflow-hidden rounded-lg bg-white shadow-md">
    <div className="border-b border-gray-200 px-5 py-4">
      <h2 className="text-lg font-semibold text-gray-900">
        {title} ({requisitions.length})
      </h2>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px]">
        <thead className="bg-gray-100">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-bold uppercase text-gray-600">Supply ID</th>
            <th className="px-4 py-3 text-left text-xs font-bold uppercase text-gray-600">Date</th>
            <th className="px-4 py-3 text-left text-xs font-bold uppercase text-gray-600">Location</th>
            <th className="px-4 py-3 text-left text-xs font-bold uppercase text-gray-600">Structure</th>
            <th className="px-4 py-3 text-left text-xs font-bold uppercase text-gray-600">Grade</th>
            <th className="px-4 py-3 text-right text-xs font-bold uppercase text-gray-600">Qty</th>
            <th className="px-4 py-3 text-left text-xs font-bold uppercase text-gray-600">Status</th>
            <th className="px-4 py-3 text-left text-xs font-bold uppercase text-gray-600">Planning Remarks</th>
            {onView && <th className="px-4 py-3 text-left text-xs font-bold uppercase text-gray-600">Action</th>}
          </tr>
        </thead>
        <tbody>
          {requisitions.map((req) => (
            <tr key={req.supply_id} className="border-t border-gray-100 hover:bg-gray-50">
              <td className="px-4 py-3 font-mono text-sm">{req.supply_id}</td>
              <td className="px-4 py-3 text-sm">{req.requisition_date || new Date(req.req_date).toLocaleDateString()}</td>
              <td className="px-4 py-3 text-sm">{req.location}</td>
              <td className="px-4 py-3 text-sm">{req.structure_name}</td>
              <td className="px-4 py-3 text-sm">{req.grade}</td>
              <td className="px-4 py-3 text-right text-sm">{req.requested_qty.toFixed(2)}</td>
              <td className="px-4 py-3 text-sm">{req.status}</td>
              <td className="max-w-[260px] truncate px-4 py-3 text-sm" title={req.planning_remarks || ''}>
                {req.planning_remarks || '-'}
              </td>
              {onView && (
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => onView(req)}
                    className="rounded bg-[#003F72]/10 px-3 py-1 text-xs font-semibold text-[#003F72]"
                  >
                    View
                  </button>
                </td>
              )}
            </tr>
          ))}

          {requisitions.length === 0 && (
            <tr>
              <td colSpan={onView ? 9 : 8} className="px-4 py-8 text-center text-sm text-gray-500">
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
