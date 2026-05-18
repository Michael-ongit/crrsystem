import React, { useEffect, useMemo, useState } from 'react';
import Select from 'react-select';
import { hierarchyAPI } from '../api';
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
type HierarchyFilterField = 'location' | 'structure_type' | 'structure_name' | 'structure_id' | 'pile_lift_id';
type SelectOption = { value: string; label: string };
const MULTI_VALUE_SEPARATOR = '|||';
const categoricalFields: HierarchyFilterField[] = [
  'location',
  'structure_type',
  'structure_name',
  'structure_id',
  'pile_lift_id',
];
const toOptions = (values: string[]): SelectOption[] =>
  Array.from(new Set(values.filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((value) => ({ value, label: value }));

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
        'status',
        'approval_status',
        'planning_remarks',
        'contact_person',
      ] as ConcreteSearchField[]).some((field) =>
        searchTerms.some((term) => fieldValue(requisition, field).includes(term))
      );
    }

    const value = fieldValue(requisition, filters.searchField);
    if (isHierarchyFilterField(filters.searchField)) {
      return searchTerms.some((term) => value === term);
    }
    return searchTerms.some((term) => value.includes(term));
  });
};

const selectClassNames = {
  control: (state: any) =>
    `min-h-[38px] rounded-md border bg-white text-sm shadow-sm ${
      state.isFocused ? 'border-[#003F72] ring-2 ring-[#003F72]/15' : 'border-gray-300'
    }`,
  valueContainer: () => 'px-2',
  input: () => 'text-sm text-gray-900',
  placeholder: () => 'text-sm text-gray-400',
  multiValue: () => 'rounded bg-[#003F72]/10',
  multiValueLabel: () => 'text-xs text-[#003F72]',
  menu: () => 'z-50 rounded-md border border-gray-200 bg-white text-sm shadow-lg',
  option: (state: any) =>
    `cursor-pointer px-3 py-2 ${
      state.isSelected ? 'bg-[#003F72] text-white' : state.isFocused ? 'bg-[#003F72]/10 text-gray-900' : 'text-gray-900'
    }`,
};

const isHierarchyFilterField = (field: RequisitionSearchField): field is HierarchyFilterField =>
  categoricalFields.includes(field as HierarchyFilterField);

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
  const selectedOptions = useMemo(() => {
    const selectedValues = filters.searchTerm.split(MULTI_VALUE_SEPARATOR).filter(Boolean);
    return selectedValues.map((value) => ({ value, label: value }));
  }, [filters.searchTerm]);

  useEffect(() => {
    let cancelled = false;
    if (!isCategorical) {
      setCategoricalOptions([]);
      return;
    }

    setLoadingOptions(true);
    loadCategoricalOptions(filters.searchField)
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
  <div className={`w-full rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm transition-shadow duration-200 ease-out hover:shadow-md xl:w-fit ${className}`}>
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[150px_170px_220px_max-content] xl:items-end">
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
          onChange={(event) => onChange({ ...filters, searchField: event.target.value as RequisitionSearchField, searchTerm: '' })}
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
        {isCategorical ? (
          <Select
            classNames={selectClassNames}
            isMulti
            isSearchable
            isLoading={loadingOptions}
            options={categoricalOptions}
            value={selectedOptions}
            onChange={(options) =>
              onChange({
                ...filters,
                searchTerm: options.map((option) => option.value).join(MULTI_VALUE_SEPARATOR),
              })
            }
          />
        ) : (
          <input
            value={filters.searchTerm}
            onChange={(event) => onChange({ ...filters, searchTerm: event.target.value })}
            placeholder=""
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-[#003F72] focus:ring-2 focus:ring-[#003F72]/15"
          />
        )}
      </label>

      <div className="whitespace-nowrap pb-2 text-sm font-semibold text-gray-600">
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
};

export default RequisitionFilters;
