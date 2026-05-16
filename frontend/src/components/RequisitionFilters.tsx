import React from 'react';
import { ConcreteRequisition } from '../types';

export type DateRangeFilter = 'all' | '7' | '30' | '90' | '365' | 'custom';

export type RequisitionSearchField =
  | 'all'
  | 'supply_id'
  | 'requisition_date'
  | 'location'
  | 'structure_type'
  | 'structure_name'
  | 'structure_id'
  | 'pile_lift_id'
  | 'grade'
  | 'status'
  | 'approval_status'
  | 'planning_remarks'
  | 'contact_person';

export interface RequisitionFilterState {
  dateRange: DateRangeFilter;
  searchField: RequisitionSearchField;
  searchTerm: string;
  customFrom: string;
  customTo: string;
}

interface RequisitionFiltersProps {
  filters: RequisitionFilterState;
  onChange: (filters: RequisitionFilterState) => void;
  resultCount: number;
  totalCount: number;
  className?: string;
}

export const defaultRequisitionFilters: RequisitionFilterState = {
  dateRange: 'all',
  searchField: 'all',
  searchTerm: '',
  customFrom: '',
  customTo: '',
};

export const formatOrderDate = (requisition: Pick<ConcreteRequisition, 'req_date' | 'requisition_date'>) => {
  if (requisition.requisition_date) return requisition.requisition_date;
  return new Date(requisition.req_date).toLocaleDateString();
};

const getOrderDate = (requisition: Pick<ConcreteRequisition, 'req_date' | 'requisition_date'>) => {
  const rawDate = requisition.requisition_date || requisition.req_date;
  const parsed = new Date(rawDate);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setHours(0, 0, 0, 0);
  return parsed;
};

type ConcreteSearchField = Exclude<RequisitionSearchField, 'all'>;

const fieldValue = (requisition: ConcreteRequisition, field: ConcreteSearchField) => {
  const values: Record<Exclude<RequisitionSearchField, 'all'>, unknown> = {
    supply_id: requisition.supply_id,
    requisition_date: formatOrderDate(requisition),
    location: requisition.location,
    structure_type: requisition.structure_type,
    structure_name: requisition.structure_name,
    structure_id: requisition.structure_id,
    pile_lift_id: requisition.pile_lift_id,
    grade: requisition.grade,
    status: requisition.status,
    approval_status: requisition.approval_status,
    planning_remarks: requisition.planning_remarks,
    contact_person: requisition.contact_person,
  };
  return String(values[field] || '').toLowerCase();
};

export const filterRequisitions = (
  requisitions: ConcreteRequisition[],
  filters: RequisitionFilterState
) => {
  const searchTerm = filters.searchTerm.trim().toLowerCase();
  const cutoff = filters.dateRange === 'all' || filters.dateRange === 'custom'
    ? null
    : new Date(Date.now() - Number(filters.dateRange) * 24 * 60 * 60 * 1000);
  cutoff?.setHours(0, 0, 0, 0);
  const customFrom = filters.dateRange === 'custom' && filters.customFrom ? new Date(filters.customFrom) : null;
  customFrom?.setHours(0, 0, 0, 0);
  const customTo = filters.dateRange === 'custom' && filters.customTo ? new Date(filters.customTo) : null;
  customTo?.setHours(23, 59, 59, 999);

  return requisitions.filter((requisition) => {
    const orderDate = cutoff || customFrom || customTo ? getOrderDate(requisition) : null;
    if (cutoff) {
      if (!orderDate || orderDate < cutoff) return false;
    }
    if (customFrom && (!orderDate || orderDate < customFrom)) return false;
    if (customTo && (!orderDate || orderDate > customTo)) return false;

    if (!searchTerm) return true;

    if (filters.searchField === 'all') {
      return ([
        'supply_id',
        'requisition_date',
        'location',
        'structure_type',
        'structure_name',
        'structure_id',
        'pile_lift_id',
        'grade',
        'status',
        'approval_status',
        'planning_remarks',
        'contact_person',
      ] as ConcreteSearchField[]).some((field) => fieldValue(requisition, field).includes(searchTerm));
    }

    return fieldValue(requisition, filters.searchField).includes(searchTerm);
  });
};

const RequisitionFilters: React.FC<RequisitionFiltersProps> = ({
  filters,
  onChange,
  resultCount,
  totalCount,
  className = '',
}) => (
  <div className={`rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm ${className}`}>
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[160px_180px_220px_auto] xl:items-end">
      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">Date Range</span>
        <select
          value={filters.dateRange}
          onChange={(event) => onChange({ ...filters, dateRange: event.target.value as DateRangeFilter })}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-[#003F72] focus:ring-2 focus:ring-[#003F72]/15"
        >
          <option value="all">All orders</option>
          <option value="7">Past 7 days</option>
          <option value="30">Past 30 days</option>
          <option value="90">Past 3 months</option>
          <option value="365">Past 12 months</option>
          <option value="custom">Custom range</option>
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">Search By</span>
        <select
          value={filters.searchField}
          onChange={(event) => onChange({ ...filters, searchField: event.target.value as RequisitionSearchField })}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-[#003F72] focus:ring-2 focus:ring-[#003F72]/15"
        >
          <option value="all">Any datapoint</option>
          <option value="supply_id">Supply ID</option>
          <option value="requisition_date">Date</option>
          <option value="location">Location</option>
          <option value="structure_type">Structure Type</option>
          <option value="structure_name">Structure Name</option>
          <option value="structure_id">Structure ID</option>
          <option value="pile_lift_id">Element ID</option>
          <option value="grade">Concrete Grade</option>
          <option value="status">Status</option>
          <option value="approval_status">Planning Decision</option>
          <option value="planning_remarks">Planning Remarks</option>
          <option value="contact_person">Engineer</option>
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">Search</span>
        <input
          value={filters.searchTerm}
          onChange={(event) => onChange({ ...filters, searchTerm: event.target.value })}
          placeholder=""
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-[#003F72] focus:ring-2 focus:ring-[#003F72]/15"
        />
      </label>

      <div className="text-sm font-semibold text-gray-600">
        {resultCount} of {totalCount}
      </div>
    </div>

    {filters.dateRange === 'custom' && (
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">From</span>
          <input
            type="date"
            value={filters.customFrom}
            onChange={(event) => onChange({ ...filters, customFrom: event.target.value })}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-[#003F72] focus:ring-2 focus:ring-[#003F72]/15"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">To</span>
          <input
            type="date"
            value={filters.customTo}
            onChange={(event) => onChange({ ...filters, customTo: event.target.value })}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-[#003F72] focus:ring-2 focus:ring-[#003F72]/15"
          />
        </label>
      </div>
    )}
  </div>
);

export default RequisitionFilters;
