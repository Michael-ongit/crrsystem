import React from 'react';
import { ConcreteRequisition } from '../types';

interface RequisitionDetailsProps {
  requisition: Partial<ConcreteRequisition>;
  hideWorkflowFields?: boolean;
  hidePlanningFields?: boolean;
}

const display = (value: unknown) => {
  if (value === undefined || value === null || value === '') return '-';
  if (value === 'Validated') return 'Approved';
  if (typeof value === 'number') return Number.isFinite(value) ? value.toFixed(2) : '-';
  return String(value);
};

const DetailItem: React.FC<{ label: string; value: unknown }> = ({ label, value }) => (
  <div className="min-w-0 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
    <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</dt>
    <dd className="mt-1 truncate text-sm font-medium text-gray-900" title={display(value)}>
      {display(value)}
    </dd>
  </div>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="space-y-3">
    <h3 className="border-b border-gray-200 pb-1 text-xs font-bold uppercase tracking-wide text-[#003F72]">
      {title}
    </h3>
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</dl>
  </section>
);

const RequisitionDetails: React.FC<RequisitionDetailsProps> = ({
  requisition,
  hideWorkflowFields = false,
  hidePlanningFields = false,
}) => (
  <div className="space-y-5">
    <Section title="Reference Details">
      <DetailItem label="Supply ID" value={requisition.supply_id} />
      <DetailItem label="RFI no." value={requisition.rfi_no} />
      <DetailItem label="Date" value={requisition.requisition_date} />
      <DetailItem label="Location" value={requisition.location} />
      <DetailItem label="Structure Type" value={requisition.structure_type} />
      <DetailItem label="Structure Name" value={requisition.structure_name} />
      <DetailItem label="Structure ID" value={requisition.structure_id} />
      <DetailItem label="Element ID" value={requisition.pile_lift_id} />
      <DetailItem label="Concrete Grade" value={requisition.grade} />
    </Section>

    <Section title="Dimension as per Drawing">
      <DetailItem label="Drawing No." value={requisition.drawing_no} />
      <DetailItem label="Length of Structure (m)" value={requisition.drawing_length} />
      <DetailItem label="Diameter of Pile / Pier (m)" value={requisition.drawing_diameter} />
      <DetailItem label="Theoretical Qty (cum)" value={requisition.theoretical_qty} />
    </Section>

    <Section title="Dimension as per Actual Site">
      <DetailItem label="Length of Structure (m)" value={requisition.actual_length} />
      <DetailItem label="Diameter of Pile / Pier (m)" value={requisition.actual_diameter} />
      <DetailItem label="Actual Qty (cum)" value={requisition.actual_qty} />
      <DetailItem label="Qty Difference (cum)" value={requisition.qty_difference} />
    </Section>

    <Section title="Order and Contact Details">
      <DetailItem label="Reason for Difference" value={requisition.difference_reason} />
      <DetailItem label="Order Quantity (cum)" value={requisition.requested_qty} />
      <DetailItem label="Time of Pour" value={requisition.pour_time} />
      <DetailItem label="Placement By" value={requisition.placement_by} />
      <DetailItem label="Contact Person / Engineer" value={requisition.contact_person} />
      <DetailItem label="Contact Number" value={requisition.contact_number} />
      {!hideWorkflowFields && <DetailItem label="Status" value={requisition.status} />}
      {!hideWorkflowFields && !hidePlanningFields && (
        <DetailItem label="Planning Decision" value={requisition.approval_status} />
      )}
      {!hideWorkflowFields && !hidePlanningFields && (
        <DetailItem label="Planning Remarks" value={requisition.planning_remarks} />
      )}
    </Section>
  </div>
);

export default RequisitionDetails;
