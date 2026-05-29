import React, { useEffect, useMemo, useState } from 'react';
import Select from 'react-select';
import { hierarchyAPI } from '../api';
import { formatDateIST, parseApiDateTime, toDateInputIST } from '../timeUtils';
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
  | 'requested_qty'
  | 'status'
  | 'approval_status'
  | 'planning_remarks'
  | 'contact_person';
export type RequisitionSortField =
  | 'requisition_date'
  | 'supply_id'
  | 'location'
  | 'structure_name'
  | 'grade'
  | 'requested_qty'
  | 'status'
  | 'placed_by_name';

export interface RequisitionFilterState {
  dateRange: DateRangeFilter;
  searchField: RequisitionSearchField;
  searchTerm: string;
  sortField: RequisitionSortField;
  sortDirection: 'asc' | 'desc';
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
  sortField: 'requisition_date',
  sortDirection: 'desc',
  customFrom: '',
  customTo: '',
};

export const formatOrderDate = (requisition: Pick<ConcreteRequisition, 'req_date' | 'requisition_date'>) => {
  if (requisition.requisition_date) return requisition.requisition_date;
  return formatDateIST(requisition.req_date);
};

const getOrderDate = (requisition: Pick<ConcreteRequisition, 'req_date' | 'requisition_date'>) => {
  const rawDate = requisition.requisition_date || requisition.req_date;
  const parsed = parseApiDateTime(rawDate);
  if (!parsed || Number.isNaN(parsed.getTime())) return null;
  parsed.setHours(0, 0, 0, 0);
  return parsed;
};

type ConcreteSearchField = Exclude<RequisitionSearchField, 'all'>;
type HierarchyFilterField = 'location' | 'structure_type' | 'structure_name' | 'structure_id' | 'pile_lift_id';
type StaticSelectFilterField = 'grade' | 'status' | 'approval_status';
type SelectOption = { value: string; label: string };
const MULTI_VALUE_SEPARATOR = '|||';
const categoricalFields: HierarchyFilterField[] = [
  'location',
  'structure_type',
  'structure_name',
  'structure_id',
  'pile_lift_id',
];
const staticSelectOptions: Record<StaticSelectFilterField, string[]> = {
  grade: [],
  status: ['Pending', 'Approved', 'Dispatched', 'Returning', 'Reconciled'],
  approval_status: ['Approved', 'Sent Back', 'Pending'],
};
const toOptions = (values: string[]): SelectOption[] =>
  Array.from(new Set(values.filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((value) => ({ value, label: value }));

const normalizedOrderDate = (requisition: Pick<ConcreteRequisition, 'req_date' | 'requisition_date'>) => {
  const rawDate = requisition.requisition_date || requisition.req_date;
  if (!rawDate) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(rawDate)) return rawDate.slice(0, 10);

  const parsed = parseApiDateTime(rawDate);
  if (!parsed || Number.isNaN(parsed.getTime())) return String(rawDate);
  return toDateInputIST(parsed);
};

const fieldValue = (requisition: ConcreteRequisition, field: ConcreteSearchField) => {
  const displayStatus = requisition.status === 'Validated' ? 'Approved' : requisition.status;
  const values: Record<Exclude<RequisitionSearchField, 'all'>, unknown> = {
    supply_id: requisition.supply_id,
    requisition_date: normalizedOrderDate(requisition),
    location: requisition.location,
    structure_type: requisition.structure_type,
    structure_name: requisition.structure_name,
    structure_id: requisition.structure_id,
    pile_lift_id: requisition.pile_lift_id,
    grade: requisition.grade,
    requested_qty: requisition.requested_qty,
    status: displayStatus,
    approval_status: requisition.approval_status,
    planning_remarks: requisition.planning_remarks,
    contact_person: requisition.contact_person,
  };
  return String(values[field] || '').toLowerCase();
};

const sortValue = (requisition: ConcreteRequisition, field: RequisitionSortField) => {
  if (field === 'requisition_date') return getOrderDate(requisition)?.getTime() || 0;
  if (field === 'requested_qty') return requisition.requested_qty || 0;
  if (field === 'status') return requisition.status === 'Validated' ? 'Approved' : requisition.status;
  if (field === 'placed_by_name') return requisition.placed_by_name || requisition.placed_by_email || '';
  return String(requisition[field] || '');
};

export const filterRequisitions = (
  requisitions: ConcreteRequisition[],
  filters: RequisitionFilterState
) => {
  const searchTerm = filters.searchTerm.trim().toLowerCase();
  const searchTerms = filters.searchTerm
    .split(MULTI_VALUE_SEPARATOR)
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
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
        'requested_qty',
        'status',
        'approval_status',
        'planning_remarks',
        'contact_person',
      ] as ConcreteSearchField[]).some((field) =>
        searchTerms.some((term) => fieldValue(requisition, field).includes(term))
      );
    }

    if (filters.searchField === 'requested_qty') {
      const numericTerm = Number(searchTerm);
      return Number.isFinite(numericTerm)
        ? Math.abs(requisition.requested_qty - numericTerm) < 0.005
        : false;
    }

    if (filters.searchField === 'requisition_date') {
      return normalizedOrderDate(requisition) === searchTerm;
    }

    const value = fieldValue(requisition, filters.searchField);
    if (isHierarchyFilterField(filters.searchField) || isStaticSelectFilterField(filters.searchField)) {
      return searchTerms.some((term) => value === term);
    }
    return searchTerms.some((term) => value.includes(term));
  }).sort((left, right) => {
    const leftValue = sortValue(left, filters.sortField);
    const rightValue = sortValue(right, filters.sortField);
    const comparison = typeof leftValue === 'number' && typeof rightValue === 'number'
      ? leftValue - rightValue
      : String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true });
    return filters.sortDirection === 'asc' ? comparison : -comparison;
  });
};

const selectClassNames = {
  control: (state: any) =>
    `min-h-[32px] rounded-md border bg-white text-xs shadow-sm ${
      state.isFocused ? 'border-[#134377] ring-2 ring-[#134377]/15' : 'border-gray-300'
    }`,
  valueContainer: () => 'px-2',
  input: () => 'text-xs text-gray-900',
  placeholder: () => 'text-xs text-gray-400',
  multiValue: () => 'rounded bg-[#134377]/10',
  multiValueLabel: () => 'text-xs text-[#134377]',
  menu: () => 'z-50 rounded-md border border-gray-200 bg-white text-sm shadow-lg',
  option: (state: any) =>
    `cursor-pointer px-3 py-2 ${
      state.isSelected ? 'bg-[#134377] text-white' : state.isFocused ? 'bg-[#134377]/10 text-gray-900' : 'text-gray-900'
    }`,
};

const isHierarchyFilterField = (field: RequisitionSearchField): field is HierarchyFilterField =>
  categoricalFields.includes(field as HierarchyFilterField);

const isStaticSelectFilterField = (field: RequisitionSearchField): field is StaticSelectFilterField =>
  field === 'grade' || field === 'status' || field === 'approval_status';

async function loadCategoricalOptions(field: RequisitionSearchField): Promise<string[]> {
  if (!isHierarchyFilterField(field)) return [];
  return hierarchyAPI.getFilterOptions(field);
}

const RequisitionFilters: React.FC<RequisitionFiltersProps> = ({
  filters,
  onChange,
  resultCount,
  totalCount,
  className = '',
}) => {
  const [categoricalOptions, setCategoricalOptions] = useState<SelectOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const isCategorical = isHierarchyFilterField(filters.searchField);
  const isStaticSelect = isStaticSelectFilterField(filters.searchField);
  const isDateSearch = filters.searchField === 'requisition_date';
  const isNumberSearch = filters.searchField === 'requested_qty';
  const selectedOptions = useMemo(() => {
    const selectedValues = filters.searchTerm.split(MULTI_VALUE_SEPARATOR).filter(Boolean);
    return selectedValues.map((value) => ({ value, label: value }));
  }, [filters.searchTerm]);
  const staticOptions = isStaticSelect
    ? (filters.searchField === 'grade'
      ? categoricalOptions.map((option) => option.value)
      : staticSelectOptions[filters.searchField as StaticSelectFilterField])
    : [];

  useEffect(() => {
    let cancelled = false;
    if (!isCategorical && filters.searchField !== 'grade') {
      setCategoricalOptions([]);
      return;
    }

    setLoadingOptions(true);
    const optionsPromise = filters.searchField === 'grade'
      ? hierarchyAPI.getDropdownOptions('concrete_grade')
      : loadCategoricalOptions(filters.searchField);
    optionsPromise
      .then((values) => {
        if (!cancelled) setCategoricalOptions(toOptions(values));
      })
      .catch((error) => {
        console.error('Failed to load filter options:', error);
        if (!cancelled) setCategoricalOptions([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingOptions(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filters.searchField, isCategorical]);

  return (
  <div className={`w-full rounded-md border border-gray-200 bg-white px-3 py-2 shadow-sm transition-shadow duration-200 ease-out hover:shadow-md xl:w-fit ${className}`}>
    <div className="grid grid-cols-1 gap-2 xl:grid-cols-[128px_145px_180px_132px_104px_max-content] xl:items-end">
      <label className="block">
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-600">Date Range</span>
        <select
          value={filters.dateRange}
          onChange={(event) => onChange({ ...filters, dateRange: event.target.value as DateRangeFilter })}
          className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs focus:border-[#134377] focus:ring-2 focus:ring-[#134377]/15"
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
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-600">Search By</span>
        <select
          value={filters.searchField}
          onChange={(event) => onChange({ ...filters, searchField: event.target.value as RequisitionSearchField, searchTerm: '' })}
          className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs focus:border-[#134377] focus:ring-2 focus:ring-[#134377]/15"
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
          <option value="requested_qty">Order Quantity</option>
          <option value="status">Status</option>
          <option value="approval_status">Planning Decision</option>
          <option value="planning_remarks">Planning Remarks</option>
          <option value="contact_person">Engineer</option>
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-600">Search</span>
        {isCategorical ? (
          <Select
            classNames={selectClassNames}
            isMulti
            isSearchable
            isLoading={loadingOptions}
            options={categoricalOptions}
            value={selectedOptions}
            onChange={(options) => {
              const selected = options as readonly SelectOption[];
              onChange({
                ...filters,
                searchTerm: selected.map((option: SelectOption) => option.value).join(MULTI_VALUE_SEPARATOR),
              });
            }}
          />
        ) : isStaticSelect ? (
          <select
            value={filters.searchTerm}
            onChange={(event) => onChange({ ...filters, searchTerm: event.target.value })}
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs focus:border-[#134377] focus:ring-2 focus:ring-[#134377]/15"
          >
            <option value=""></option>
            {staticOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : isDateSearch ? (
          <input
            type="date"
            value={filters.searchTerm}
            onChange={(event) => onChange({ ...filters, searchTerm: event.target.value })}
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs focus:border-[#134377] focus:ring-2 focus:ring-[#134377]/15"
          />
        ) : isNumberSearch ? (
          <input
            type="number"
            step="0.01"
            value={filters.searchTerm}
            onChange={(event) => onChange({ ...filters, searchTerm: event.target.value })}
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs focus:border-[#134377] focus:ring-2 focus:ring-[#134377]/15"
          />
        ) : (
          <input
            value={filters.searchTerm}
            onChange={(event) => onChange({ ...filters, searchTerm: event.target.value })}
            placeholder=""
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs focus:border-[#134377] focus:ring-2 focus:ring-[#134377]/15"
          />
        )}
      </label>

      <label className="block">
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-600">Sort By</span>
        <select
          value={filters.sortField}
          onChange={(event) => onChange({ ...filters, sortField: event.target.value as RequisitionSortField })}
          className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs focus:border-[#134377] focus:ring-2 focus:ring-[#134377]/15"
        >
          <option value="requisition_date">Date</option>
          <option value="supply_id">Supply ID</option>
          <option value="location">Location</option>
          <option value="structure_name">Structure</option>
          <option value="grade">Grade</option>
          <option value="requested_qty">Quantity</option>
          <option value="status">Status</option>
          <option value="placed_by_name">Ordered By</option>
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-600">Direction</span>
        <select
          value={filters.sortDirection}
          onChange={(event) => onChange({ ...filters, sortDirection: event.target.value as 'asc' | 'desc' })}
          className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs focus:border-[#134377] focus:ring-2 focus:ring-[#134377]/15"
        >
          <option value="desc">Descending</option>
          <option value="asc">Ascending</option>
        </select>
      </label>

      <div className="whitespace-nowrap pb-1.5 text-xs font-semibold text-gray-600">
        {resultCount} of {totalCount}
      </div>
    </div>

    {filters.dateRange === 'custom' && (
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-600">From</span>
          <input
            type="date"
            value={filters.customFrom}
            onChange={(event) => onChange({ ...filters, customFrom: event.target.value })}
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs focus:border-[#134377] focus:ring-2 focus:ring-[#134377]/15"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-600">To</span>
          <input
            type="date"
            value={filters.customTo}
            onChange={(event) => onChange({ ...filters, customTo: event.target.value })}
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs focus:border-[#134377] focus:ring-2 focus:ring-[#134377]/15"
          />
        </label>
      </div>
    )}
  </div>
);
};

export default RequisitionFilters;
