import React from 'react';
import { formatDateTimeIST } from '../timeUtils';
import { ConcreteRequisition } from '../types';
import { formatOrderDate } from './RequisitionFilters';
import StatusBadge from './StatusBadge';

export type RequisitionTableData = Partial<ConcreteRequisition> & {
  display_supply_id?: string;
  display_status?: string;
};

const headerClass = 'px-4 py-3 text-left text-xs font-bold uppercase text-[#003F72]';
const numericHeaderClass = 'px-4 py-3 text-right text-xs font-bold uppercase text-[#003F72]';
const cellClass = 'px-4 py-3 text-sm';
const numericCellClass = 'px-4 py-3 text-right text-sm';

const display = (value: unknown) => {
  if (value === undefined || value === null || value === '') return '-';
  if (value === 'Validated') return 'Approved';
  if (typeof value === 'number') return Number.isFinite(value) ? value.toFixed(2) : '-';
  return String(value);
};

const dateFor = (row: RequisitionTableData) => {
  if (row.req_date || row.requisition_date) {
    return formatOrderDate(row as Pick<ConcreteRequisition, 'req_date' | 'requisition_date'>);
  }
  return '-';
};

export const requisitionTableDataColumnCount = 27;

export const RequisitionTableHeader: React.FC<{
  includeAction?: boolean;
  extraHeaders?: React.ReactNode;
}> = ({ includeAction = false, extraHeaders }) => (
  <tr>
    <th className={headerClass}>Supply ID</th>
    <th className={headerClass}>RFI No.</th>
    <th className={headerClass}>Date</th>
    <th className={headerClass}>Location</th>
    <th className={headerClass}>Structure Type</th>
    <th className={headerClass}>Structure Name</th>
    <th className={headerClass}>Structure ID</th>
    <th className={headerClass}>Element ID</th>
    <th className={headerClass}>Grade</th>
    <th className={headerClass}>Drawing No.</th>
    <th className={numericHeaderClass}>Drawing Length</th>
    <th className={numericHeaderClass}>Drawing Diameter</th>
    <th className={numericHeaderClass}>Theoretical Qty</th>
    <th className={numericHeaderClass}>Actual Length</th>
    <th className={numericHeaderClass}>Actual Diameter</th>
    <th className={numericHeaderClass}>Actual Qty</th>
    <th className={numericHeaderClass}>Qty Diff.</th>
    <th className={headerClass}>Diff. Reason</th>
    <th className={numericHeaderClass}>Order Qty</th>
    <th className={headerClass}>Pour Time</th>
    <th className={headerClass}>Placement By</th>
    <th className={headerClass}>Contact Person</th>
    <th className={headerClass}>Contact Number</th>
    <th className={headerClass}>Status</th>
    <th className={headerClass}>Planning Decision</th>
    <th className={headerClass}>Planning Remarks</th>
    <th className={headerClass}>Updated</th>
    {extraHeaders}
    {includeAction && <th className={headerClass}>Action</th>}
  </tr>
);

export const RequisitionTableCells: React.FC<{
  row: RequisitionTableData;
  statusOverride?: string;
}> = ({ row, statusOverride }) => {
  const status = statusOverride || row.display_status || row.status;
  return (
    <>
      <td className="px-4 py-3 font-mono text-sm">{display(row.display_supply_id || row.supply_id)}</td>
      <td className={cellClass}>{display(row.rfi_no)}</td>
      <td className={cellClass}>{dateFor(row)}</td>
      <td className={cellClass}>{display(row.location)}</td>
      <td className={cellClass}>{display(row.structure_type)}</td>
      <td className={cellClass}>{display(row.structure_name)}</td>
      <td className={cellClass}>{display(row.structure_id)}</td>
      <td className={cellClass}>{display(row.pile_lift_id)}</td>
      <td className={cellClass}>{display(row.grade)}</td>
      <td className={cellClass}>{display(row.drawing_no)}</td>
      <td className={numericCellClass}>{display(row.drawing_length)}</td>
      <td className={numericCellClass}>{display(row.drawing_diameter)}</td>
      <td className={numericCellClass}>{display(row.theoretical_qty)}</td>
      <td className={numericCellClass}>{display(row.actual_length)}</td>
      <td className={numericCellClass}>{display(row.actual_diameter)}</td>
      <td className={numericCellClass}>{display(row.actual_qty)}</td>
      <td className={numericCellClass}>{display(row.qty_difference)}</td>
      <td className={cellClass}>{display(row.difference_reason)}</td>
      <td className={numericCellClass}>{display(row.requested_qty)}</td>
      <td className={cellClass}>{display(row.pour_time)}</td>
      <td className={cellClass}>{display(row.placement_by)}</td>
      <td className={cellClass}>{display(row.contact_person)}</td>
      <td className={cellClass}>{display(row.contact_number)}</td>
      <td className={cellClass}>{status ? <StatusBadge status={status} /> : '-'}</td>
      <td className={cellClass}>{display(row.approval_status)}</td>
      <td className={cellClass}>{display(row.planning_remarks)}</td>
      <td className={cellClass}>{formatDateTimeIST(row.updated_at)}</td>
    </>
  );
};
