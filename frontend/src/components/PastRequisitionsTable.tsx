import React from 'react';
import { ConcreteRequisition } from '../types';
import CollapsibleTableSection from './CollapsibleTableSection';
import { formatOrderDate } from './RequisitionFilters';
import StatusBadge from './StatusBadge';

interface PastRequisitionsTableProps {
  requisitions: ConcreteRequisition[];
  title?: string;
  emptyText?: string;
  onView?: (requisition: ConcreteRequisition) => void;
  enableDownload?: boolean;
}

const excelColumns: Array<[string, keyof ConcreteRequisition]> = [
  ['Supply ID', 'supply_id'],
  ['Date', 'requisition_date'],
  ['Created At', 'created_at'],
  ['Location', 'location'],
  ['Structure Type', 'structure_type'],
  ['Structure Name', 'structure_name'],
  ['Structure ID', 'structure_id'],
  ['Element ID', 'pile_lift_id'],
  ['Grade', 'grade'],
  ['Requested Qty', 'requested_qty'],
  ['Status', 'status'],
  ['Ordered By', 'placed_by_name'],
  ['Ordered By Email', 'placed_by_email'],
  ['RFI No.', 'rfi_no'],
  ['Drawing No.', 'drawing_no'],
  ['Drawing Length', 'drawing_length'],
  ['Drawing Diameter', 'drawing_diameter'],
  ['Theoretical Qty', 'theoretical_qty'],
  ['Actual Length', 'actual_length'],
  ['Actual Diameter', 'actual_diameter'],
  ['Actual Qty', 'actual_qty'],
  ['Qty Difference', 'qty_difference'],
  ['Difference Reason', 'difference_reason'],
  ['Pour Time', 'pour_time'],
  ['Placement By', 'placement_by'],
  ['Contact Person', 'contact_person'],
  ['Contact Number', 'contact_number'],
  ['Planning Decision', 'approval_status'],
  ['Planning Remarks', 'planning_remarks'],
  ['Updated At', 'updated_at'],
];

const escapeCell = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const downloadRequisitionsExcel = (requisitions: ConcreteRequisition[], title: string) => {
  const rows = requisitions.map((requisition) =>
    excelColumns.map(([, key]) => {
      const value = key === 'requisition_date'
        ? formatOrderDate(requisition)
        : requisition[key];
      return `<td>${escapeCell(value)}</td>`;
    }).join('')
  );
  const worksheet = `
    <html>
      <head><meta charset="utf-8" /></head>
      <body>
        <table>
          <thead><tr>${excelColumns.map(([label]) => `<th>${escapeCell(label)}</th>`).join('')}</tr></thead>
          <tbody>${rows.map((row) => `<tr>${row}</tr>`).join('')}</tbody>
        </table>
      </body>
    </html>
  `;
  const blob = new Blob([worksheet], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'requisitions'}-${new Date().toISOString().slice(0, 10)}.xls`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const PastRequisitionsTable: React.FC<PastRequisitionsTableProps> = ({
  requisitions,
  title = 'Ongoing Requisitions',
  emptyText = 'No ongoing requisitions found.',
  onView,
  enableDownload = false,
}) => (
  <CollapsibleTableSection
    title={`${title} (${requisitions.length})`}
    actions={enableDownload && (
      <button
        type="button"
        onClick={() => downloadRequisitionsExcel(requisitions, title)}
        disabled={requisitions.length === 0}
        className="rounded-md bg-white px-3 py-2 text-xs font-semibold text-[#134377] shadow-sm hover:bg-blue-50 disabled:cursor-not-allowed disabled:bg-white/50"
      >
        Download
      </button>
    )}
  >
      <table className="w-full min-w-[860px]">
        <thead className="bg-gray-100">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-bold uppercase text-[#134377]">Supply ID</th>
            <th className="px-4 py-3 text-left text-xs font-bold uppercase text-[#134377]">Date</th>
            <th className="px-4 py-3 text-left text-xs font-bold uppercase text-[#134377]">Location</th>
            <th className="px-4 py-3 text-left text-xs font-bold uppercase text-[#134377]">Ordered By</th>
            <th className="px-4 py-3 text-left text-xs font-bold uppercase text-[#134377]">Structure</th>
            <th className="px-4 py-3 text-left text-xs font-bold uppercase text-[#134377]">Grade</th>
            <th className="px-4 py-3 text-right text-xs font-bold uppercase text-[#134377]">Qty</th>
            <th className="px-4 py-3 text-left text-xs font-bold uppercase text-[#134377]">Status</th>
            {onView && <th className="px-4 py-3 text-left text-xs font-bold uppercase text-[#134377]">Action</th>}
          </tr>
        </thead>
        <tbody>
          {requisitions.map((req) => (
            <tr key={req.supply_id} className="border-t border-gray-100 transition-colors duration-150 ease-out hover:bg-blue-50/45">
              <td className="px-4 py-3 font-mono text-sm">{req.supply_id}</td>
              <td className="px-4 py-3 text-sm">{formatOrderDate(req)}</td>
              <td className="px-4 py-3 text-sm">{req.location}</td>
              <td className="px-4 py-3 text-sm">{req.placed_by_name || req.placed_by_email || '-'}</td>
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
                    className="rounded bg-[#134377] px-3 py-1 text-xs font-semibold text-white shadow-sm transition-all duration-200 ease-out hover:bg-[#134377] hover:shadow"
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
  </CollapsibleTableSection>
);

export default PastRequisitionsTable;
