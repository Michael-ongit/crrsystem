// pages/ExecutionView.tsx - Execution team requisition form
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import Select from 'react-select';
import { hierarchyAPI, requisitionAPI } from '../api';
import CollapsibleTableSection from '../components/CollapsibleTableSection';
import PastRequisitionsModalButton from '../components/PastRequisitionsModalButton';
import PastRequisitionsTable from '../components/PastRequisitionsTable';
import RequisitionFilters, {
  defaultRequisitionFilters,
  filterRequisitions,
  formatOrderDate,
  RequisitionFilterState,
} from '../components/RequisitionFilters';
import RequisitionFullDetails from '../components/RequisitionFullDetails';
import StatusBadge from '../components/StatusBadge';
import {
  addHoursToApiDateTime,
  formatDateTimeIST,
  nowLocalIso,
  parseApiDateTime,
  toDateInputIST,
} from '../timeUtils';
import { ConcreteRequisition, RequisitionStatus, User } from '../types';

interface ExecutionViewProps {
  currentUser: User | null;
}

interface ExecutionFormData {
  rfi_no: string;
  requisition_date: string;
  location: string;
  structure_type: string;
  structure_name: string;
  structure_id: string;
  pile_lift_id: string;
  grade: string;
  drawing_no: string;
  drawing_length?: number;
  drawing_diameter?: number;
  theoretical_qty?: number;
  actual_length?: number;
  actual_diameter?: number;
  actual_qty?: number;
  qty_difference?: number;
  difference_reason: string;
  requested_qty?: number;
  pour_time: string;
  placement_by: string;
  in_charge_id: string;
  in_charge_name: string;
  selected_in_charge: string;
  contact_person: string;
  contact_number: string;
}

interface DraftOrder {
  draft_id: string;
  updated_at: string;
  data: ExecutionFormData;
}

const today = () => toDateInputIST();

const defaultValues = (currentUser?: User | null): ExecutionFormData => ({
  rfi_no: '',
  requisition_date: today(),
  location: '',
  structure_type: '',
  structure_name: '',
  structure_id: '',
  pile_lift_id: '',
  grade: '',
  drawing_no: '',
  drawing_length: undefined,
  drawing_diameter: undefined,
  theoretical_qty: undefined,
  actual_length: undefined,
  actual_diameter: undefined,
  actual_qty: undefined,
  qty_difference: undefined,
  difference_reason: '',
  requested_qty: undefined,
  pour_time: '',
  placement_by: '',
  in_charge_id: currentUser?.id || '',
  in_charge_name: currentUser?.name || '',
  selected_in_charge: currentUser?.name || '',
  contact_person: '',
  contact_number: '',
});

const getErrorMessage = (error: any, fallback: string) => {
  const detail = error.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail.map((item) => item?.msg || item?.message || String(item)).join(', ');
  }
  return fallback;
};

const numberOrUndefined = (value?: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

type SelectOption = { value: string; label: string };
const toOptions = (values: string[]): SelectOption[] => values.map((value) => ({ value, label: value }));

const fieldClass =
  'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-[#134377] focus:ring-2 focus:ring-[#134377]/15';

const readOnlyClass =
  'w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-700';

const tableHeaderClass = 'px-4 py-3 text-left text-xs font-bold uppercase text-[#134377]';
const numericTableHeaderClass = 'px-4 py-3 text-right text-xs font-bold uppercase text-[#134377]';
const tableActionButtonClass =
  'rounded bg-[#134377] px-3 py-1 text-xs font-semibold text-white shadow-sm transition-all duration-200 ease-out hover:bg-[#134377] hover:shadow';

const selectClassNames = {
  control: (state: any) =>
    `min-h-[38px] rounded-md border bg-white text-sm shadow-sm ${
      state.isFocused ? 'border-[#134377] ring-2 ring-[#134377]/15' : 'border-gray-300'
    }`,
  valueContainer: () => 'px-2',
  input: () => 'text-sm text-gray-900',
  placeholder: () => 'text-sm text-gray-400',
  singleValue: () => 'text-sm text-gray-900',
  menu: () => 'z-50 rounded-md border border-gray-200 bg-white text-sm shadow-lg',
  option: (state: any) =>
    `cursor-pointer px-3 py-2 ${
      state.isSelected ? 'bg-[#134377] text-white' : state.isFocused ? 'bg-[#134377]/10 text-gray-900' : 'text-gray-900'
    }`,
};

const Field: React.FC<{
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}> = ({ label, required, error, children }) => (
  <div className="min-w-0">
    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">
      {label}
      {required && <span className="text-red-600"> *</span>}
    </label>
    {children}
    {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
  </div>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="space-y-4">
    <div className="border-b border-gray-200 pb-2">
      <h2 className="text-sm font-bold uppercase tracking-wide text-[#134377]">{title}</h2>
    </div>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{children}</div>
  </section>
);

const ExecutionView: React.FC<ExecutionViewProps> = ({ currentUser }) => {
  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    getValues,
    formState: { errors },
    reset,
  } = useForm<ExecutionFormData>({
    defaultValues: defaultValues(currentUser),
  });

  const [locationOptions, setLocationOptions] = useState<SelectOption[]>([]);
  const [gradeOptions, setGradeOptions] = useState<SelectOption[]>([]);
  const [placementOptions, setPlacementOptions] = useState<SelectOption[]>([]);
  const [structureTypeOptions, setStructureTypeOptions] = useState<SelectOption[]>([]);
  const [structureNameOptions, setStructureNameOptions] = useState<SelectOption[]>([]);
  const [structureIdOptions, setStructureIdOptions] = useState<SelectOption[]>([]);
  const [elementIdOptions, setElementIdOptions] = useState<SelectOption[]>([]);
  const [orders, setOrders] = useState<ConcreteRequisition[]>([]);
  const [drafts, setDrafts] = useState<DraftOrder[]>([]);
  const [filters, setFilters] = useState<RequisitionFilterState>(defaultRequisitionFilters);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [editingSupplyId, setEditingSupplyId] = useState<string | null>(null);
  const [viewingOrder, setViewingOrder] = useState<ConcreteRequisition | null>(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [generatedSupplyId, setGeneratedSupplyId] = useState('');

  const draftStorageKey = `executionDrafts:${currentUser?.id || 'anonymous'}`;
  const editDraftStorageKey = `executionEditDrafts:${currentUser?.id || 'anonymous'}`;
  const isResettingFormRef = useRef(false);

  const locationValue = watch('location');
  const structureTypeValue = watch('structure_type');
  const structureNameValue = watch('structure_name');
  const structureIdValue = watch('structure_id');
  const theoreticalQty = watch('theoretical_qty');
  const actualQty = watch('actual_qty');
  const currentOrders = useMemo(
    () => orders.filter((order) => order.status === RequisitionStatus.PENDING),
    [orders]
  );
  const historyOrders = useMemo(
    () => orders.filter((order) =>
      [RequisitionStatus.VALIDATED, RequisitionStatus.DISPATCHED, RequisitionStatus.RETURNING].includes(order.status)
    ),
    [orders]
  );
  const pastOrders = useMemo(
    () => orders.filter((order) => order.status === RequisitionStatus.RECONCILED),
    [orders]
  );
  const filteredCurrentOrders = useMemo(
    () => filterRequisitions(currentOrders, filters),
    [currentOrders, filters]
  );
  const filteredHistoryOrders = useMemo(
    () => filterRequisitions(historyOrders, filters),
    [filters, historyOrders]
  );

  const loadDrafts = () => {
    const rawDrafts = localStorage.getItem(draftStorageKey);
    setDrafts(rawDrafts ? JSON.parse(rawDrafts) : []);
  };

  const saveDrafts = (nextDrafts: DraftOrder[]) => {
    localStorage.setItem(draftStorageKey, JSON.stringify(nextDrafts));
    setDrafts(nextDrafts);
  };

  const hasMeaningfulDraftData = (data: ExecutionFormData) =>
    Object.entries(data).some(([key, value]) =>
      key !== 'in_charge_id' &&
      value !== undefined &&
      value !== null &&
      value !== ''
    );

  const upsertDraft = (draft: DraftOrder) => {
    const rawDrafts = localStorage.getItem(draftStorageKey);
    const currentDrafts: DraftOrder[] = rawDrafts ? JSON.parse(rawDrafts) : [];
    const nextDrafts = currentDrafts.some((item) => item.draft_id === draft.draft_id)
      ? currentDrafts.map((item) => (item.draft_id === draft.draft_id ? draft : item))
      : [draft, ...currentDrafts];
    saveDrafts(nextDrafts);
  };

  const fetchOrders = async () => {
    const reqs = await requisitionAPI.getRequisitions(
      undefined,
      currentUser?.assigned_locations?.length ? 'assigned' : undefined
    );
    const assigned = new Set((currentUser?.assigned_locations || []).map((location) => location.toLowerCase()));
    setOrders(
      assigned.size > 0
        ? reqs.filter((req) => assigned.has(req.location.toLowerCase()))
        : reqs.filter((req) => req.in_charge_id === currentUser?.id || req.placed_by_id === currentUser?.id)
    );
  };

  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const [locations, grades, placements] = await Promise.all([
          hierarchyAPI.getLocations(),
          hierarchyAPI.getDropdownOptions('concrete_grade'),
          hierarchyAPI.getDropdownOptions('placement_by'),
        ]);
        setLocationOptions(toOptions(locations));
        setGradeOptions(toOptions(grades));
        setPlacementOptions(toOptions(placements));
        loadDrafts();
        await fetchOrders();
      } catch (error) {
        console.error('Failed to fetch execution data:', error);
        setErrorMessage('Failed to load execution data. Please refresh the page.');
      } finally {
        setLoading(false);
      }
    };

    fetchInitialData();
  }, [currentUser?.id]);

  useEffect(() => {
    if (!locationValue) {
      setStructureTypeOptions([]);
      return;
    }
    hierarchyAPI.getStructureTypes(locationValue)
      .then((values) => setStructureTypeOptions(toOptions(values)))
      .catch((error) => console.error('Failed to fetch structure types:', error));
  }, [locationValue]);

  useEffect(() => {
    if (!locationValue || !structureTypeValue) {
      setStructureNameOptions([]);
      return;
    }
    hierarchyAPI.getStructureNames(locationValue, structureTypeValue)
      .then((values) => setStructureNameOptions(toOptions(values)))
      .catch((error) => console.error('Failed to fetch structure names:', error));
  }, [locationValue, structureTypeValue]);

  useEffect(() => {
    if (!locationValue || !structureTypeValue || !structureNameValue) {
      setStructureIdOptions([]);
      return;
    }
    hierarchyAPI.getStructureIds(locationValue, structureTypeValue, structureNameValue)
      .then((values) => setStructureIdOptions(toOptions(values)))
      .catch((error) => console.error('Failed to fetch structure IDs:', error));
  }, [locationValue, structureNameValue, structureTypeValue]);

  useEffect(() => {
    if (!locationValue || !structureTypeValue || !structureNameValue || !structureIdValue) {
      setElementIdOptions([]);
      return;
    }
    hierarchyAPI.getElementIds(locationValue, structureTypeValue, structureNameValue, structureIdValue)
      .then((values) => setElementIdOptions(toOptions(values)))
      .catch((error) => console.error('Failed to fetch element IDs:', error));
  }, [locationValue, structureIdValue, structureNameValue, structureTypeValue]);

  useEffect(() => {
    const difference = Number(theoreticalQty || 0) - Number(actualQty || 0);
    setValue('qty_difference', Number.isFinite(difference) ? Number(difference.toFixed(2)) : undefined);
  }, [actualQty, setValue, theoreticalQty]);

  useEffect(() => {
    if (editingSupplyId) {
      setGeneratedSupplyId(editingSupplyId);
      return;
    }

    const canPreview =
      locationValue?.trim().length >= 3 &&
      structureNameValue?.trim().length > 0 &&
      structureIdValue?.trim().length > 0;

    if (!canPreview) {
      setGeneratedSupplyId('');
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      try {
        const preview = await requisitionAPI.previewSupplyId({
          location: locationValue,
          structure_name: structureNameValue,
          structure_id: structureIdValue,
        });
        setGeneratedSupplyId(preview.supply_id);
      } catch (error) {
        console.error('Failed to preview Supply ID:', error);
        setGeneratedSupplyId('');
      }
    }, 350);

    return () => window.clearTimeout(timeoutId);
  }, [editingSupplyId, locationValue, structureNameValue, structureIdValue]);

  useEffect(() => {
    if (!isModalOpen) return undefined;

    const subscription = watch((value) => {
      if (isResettingFormRef.current) return;
      const formData = value as ExecutionFormData;
      if (editingSupplyId) {
        localStorage.setItem(`${editDraftStorageKey}:${editingSupplyId}`, JSON.stringify(formData));
        return;
      }

      if (!activeDraftId || !hasMeaningfulDraftData(formData)) return;
      upsertDraft({
        draft_id: activeDraftId,
        updated_at: nowLocalIso(),
        data: formData,
      });
    });

    return () => subscription.unsubscribe();
  }, [activeDraftId, editDraftStorageKey, editingSupplyId, isModalOpen, watch]);

  const resetOrderForm = (values: ExecutionFormData) => {
    isResettingFormRef.current = true;
    reset(values);
    window.setTimeout(() => {
      isResettingFormRef.current = false;
    }, 0);
  };

  const openNewOrder = () => {
    const draftId = crypto.randomUUID();
    resetOrderForm(defaultValues(currentUser));
    setActiveDraftId(draftId);
    setEditingSupplyId(null);
    setGeneratedSupplyId('');
    setIsModalOpen(true);
  };

  const resumeDraft = (draft: DraftOrder) => {
    resetOrderForm(draft.data);
    setActiveDraftId(draft.draft_id);
    setEditingSupplyId(null);
    setIsModalOpen(true);
  };

  const optionFor = (options: SelectOption[], value?: string) =>
    options.find((option) => option.value === value) || (value ? { value, label: value } : null);

  const deleteDraft = (draftId: string) => {
    saveDrafts(drafts.filter((draft) => draft.draft_id !== draftId));
  };

  const isSentBack = (order: ConcreteRequisition) => order.approval_status === 'Sent Back';

  const sentBackExpiresAt = (order: ConcreteRequisition) =>
    order.sent_back_expires_at
      ? parseApiDateTime(order.sent_back_expires_at) || undefined
      : order.validation_timestamp
        ? addHoursToApiDateTime(order.validation_timestamp, 12)
        : undefined;

  const canEditSentBack = (order: ConcreteRequisition) => {
    const expiresAt = sentBackExpiresAt(order);
    return isSentBack(order) && !!expiresAt && expiresAt.getTime() > Date.now();
  };

  const orderStatusLabel = (order: ConcreteRequisition) => {
    if (isSentBack(order)) return canEditSentBack(order) ? 'Sent Back' : 'Expired';
    return order.status;
  };

  const formValuesFromOrder = (order: ConcreteRequisition): ExecutionFormData => ({
    rfi_no: order.rfi_no || '',
    requisition_date: order.requisition_date || today(),
    location: order.location || '',
    structure_type: order.structure_type || '',
    structure_name: order.structure_name || '',
    structure_id: order.structure_id || '',
    pile_lift_id: order.pile_lift_id || '',
    grade: order.grade || '',
    drawing_no: order.drawing_no || '',
    drawing_length: order.drawing_length,
    drawing_diameter: order.drawing_diameter,
    theoretical_qty: order.theoretical_qty,
    actual_length: order.actual_length,
    actual_diameter: order.actual_diameter,
    actual_qty: order.actual_qty,
    qty_difference: order.qty_difference,
    difference_reason: order.difference_reason || '',
    requested_qty: order.requested_qty,
    pour_time: order.pour_time || '',
    placement_by: order.placement_by || '',
    in_charge_id: order.in_charge_id || currentUser?.id || '',
    in_charge_name: order.in_charge_name || currentUser?.name || '',
    selected_in_charge: order.selected_in_charge || order.in_charge_name || currentUser?.name || '',
    contact_person: order.contact_person || '',
    contact_number: order.contact_number || '',
  });

  const openSentBackEdit = (order: ConcreteRequisition) => {
    const savedDraft = localStorage.getItem(`${editDraftStorageKey}:${order.supply_id}`);
    resetOrderForm(savedDraft ? JSON.parse(savedDraft) : formValuesFromOrder(order));
    setActiveDraftId(null);
    setEditingSupplyId(order.supply_id);
    setGeneratedSupplyId(order.supply_id);
    setIsModalOpen(true);
  };

  const saveDraft = () => {
    const draft: DraftOrder = {
      draft_id: activeDraftId || crypto.randomUUID(),
      updated_at: nowLocalIso(),
      data: getValues(),
    };
    upsertDraft(draft);
    setActiveDraftId(draft.draft_id);
    setSuccessMessage('Draft saved.');
    setTimeout(() => setSuccessMessage(''), 3000);
  };

  const buildPayload = (data: ExecutionFormData) => ({
    ...data,
    in_charge_id: currentUser?.id || data.in_charge_id,
    drawing_length: numberOrUndefined(data.drawing_length),
    drawing_diameter: numberOrUndefined(data.drawing_diameter),
    theoretical_qty: numberOrUndefined(data.theoretical_qty),
    actual_length: numberOrUndefined(data.actual_length),
    actual_diameter: numberOrUndefined(data.actual_diameter),
    actual_qty: numberOrUndefined(data.actual_qty),
    qty_difference: numberOrUndefined(data.qty_difference),
    requested_qty: numberOrUndefined(data.requested_qty) || 0,
  });

  const onSubmit = async (data: ExecutionFormData) => {
    setSubmitting(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const submittedEditingSupplyId = editingSupplyId;
      const response = editingSupplyId
        ? await requisitionAPI.resubmitRequisition(editingSupplyId, buildPayload(data))
        : await requisitionAPI.createRequisition(buildPayload(data));
      setSuccessMessage(
        editingSupplyId
          ? `Requisition resubmitted under Supply ID: ${response.supply_id}`
          : `Requisition created successfully. Supply ID: ${response.supply_id}`
      );
      if (activeDraftId) {
        saveDrafts(drafts.filter((draft) => draft.draft_id !== activeDraftId));
      }
      if (submittedEditingSupplyId) {
        localStorage.removeItem(`${editDraftStorageKey}:${submittedEditingSupplyId}`);
      }
      resetOrderForm(defaultValues(currentUser));
      setActiveDraftId(null);
      setEditingSupplyId(null);
      setGeneratedSupplyId('');
      setIsModalOpen(false);
      await fetchOrders();
      setTimeout(() => setSuccessMessage(''), 5000);
    } catch (error: any) {
      console.error('Error creating requisition:', error);
      setErrorMessage(getErrorMessage(error, 'Failed to create requisition. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-[#134377]"></div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-[2.15rem] font-bold leading-tight text-gray-900">Execution Orders</h1>
          <p className="text-sm text-gray-600">Track submitted requisitions and resume saved drafts</p>
        </div>
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
          <RequisitionFilters
            filters={filters}
            onChange={setFilters}
            resultCount={filteredCurrentOrders.length + filteredHistoryOrders.length}
            totalCount={currentOrders.length + historyOrders.length}
            className="xl:w-fit"
          />
        </div>
      </div>

      {successMessage && <div className="alert alert-success">{successMessage}</div>}
      {errorMessage && <div className="alert alert-danger">{errorMessage}</div>}

      <CollapsibleTableSection
        title={`Current Orders (${filteredCurrentOrders.length})`}
        actions={
          <button
            type="button"
            onClick={openNewOrder}
            className="h-10 shrink-0 rounded-md bg-white px-5 text-sm font-semibold text-[#134377] shadow-sm transition-all duration-200 ease-out hover:bg-blue-50 hover:shadow"
          >
            Create New Order
          </button>
        }
      >
        <table className="w-full min-w-[920px]">
          <thead className="bg-gray-100">
            <tr>
              <th className={tableHeaderClass}>Supply ID</th>
              <th className={tableHeaderClass}>Date</th>
              <th className={tableHeaderClass}>Location</th>
              <th className={tableHeaderClass}>Ordered By</th>
              <th className={tableHeaderClass}>Structure</th>
              <th className={tableHeaderClass}>Grade</th>
              <th className={numericTableHeaderClass}>Order Qty</th>
              <th className={tableHeaderClass}>Status</th>
              <th className={tableHeaderClass}>Action</th>
            </tr>
          </thead>
          <tbody>
            {drafts.map((draft) => (
              <tr key={draft.draft_id} className="border-t border-gray-100 bg-amber-50/60 transition-colors duration-150 ease-out hover:bg-amber-100/70">
                <td className="px-4 py-3 text-sm font-semibold text-amber-800">Draft</td>
                <td className="px-4 py-3 text-sm">{draft.data.requisition_date || toDateInputIST(draft.updated_at)}</td>
                <td className="px-4 py-3 text-sm">{draft.data.location || '-'}</td>
                <td className="px-4 py-3 text-sm">{currentUser?.name || '-'}</td>
                <td className="px-4 py-3 text-sm">{draft.data.structure_name || '-'}</td>
                <td className="px-4 py-3 text-sm">{draft.data.grade || '-'}</td>
                <td className="px-4 py-3 text-right text-sm">
                  {draft.data.requested_qty ? draft.data.requested_qty.toFixed(2) : '-'}
                </td>
                <td className="px-4 py-3 text-sm">
                  <StatusBadge status="Draft" />
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => resumeDraft(draft)}
                      className={tableActionButtonClass}
                    >
                      Resume
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteDraft(draft.draft_id)}
                      className={tableActionButtonClass}
                      title={`Saved ${formatDateTimeIST(draft.updated_at)}`}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}

            {filteredCurrentOrders.map((order) => (
              <tr key={order.supply_id} className="border-t border-gray-100 transition-colors duration-150 ease-out hover:bg-blue-50/45">
                <td className="px-4 py-3 font-mono text-sm">{order.supply_id}</td>
                <td className="px-4 py-3 text-sm">{formatOrderDate(order)}</td>
                <td className="px-4 py-3 text-sm">{order.location}</td>
                <td className="px-4 py-3 text-sm">{order.placed_by_name || order.placed_by_email || '-'}</td>
                <td className="px-4 py-3 text-sm">{order.structure_name}</td>
                <td className="px-4 py-3 text-sm">{order.grade}</td>
                <td className="px-4 py-3 text-right text-sm">{order.requested_qty.toFixed(2)}</td>
                <td className="px-4 py-3 text-sm">
                  <StatusBadge status={orderStatusLabel(order)} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    {canEditSentBack(order) && (
                      <button
                        type="button"
                        onClick={() => openSentBackEdit(order)}
                        className={tableActionButtonClass}
                        title={`Edit window closes at ${formatDateTimeIST(sentBackExpiresAt(order))}`}
                      >
                        Edit
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setViewingOrder(order)}
                      className={tableActionButtonClass}
                    >
                      View
                    </button>
                  </div>
                </td>
              </tr>
            ))}

            {drafts.length === 0 && filteredCurrentOrders.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-sm text-gray-500">
                  No orders yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </CollapsibleTableSection>

      <PastRequisitionsTable
        requisitions={filteredHistoryOrders}
        emptyText="No ongoing requisitions found."
        onView={setViewingOrder}
      />

      <PastRequisitionsModalButton requisitions={pastOrders} />

      {viewingOrder && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-5 flex items-center justify-between gap-4">
              <h2 className="text-xl font-bold text-gray-900">Order Details</h2>
              <button
                type="button"
                onClick={() => setViewingOrder(null)}
                className="rounded-md bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-700"
              >
                Close
              </button>
            </div>
            <RequisitionFullDetails requisition={viewingOrder} />
          </div>
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[92vh] w-full max-w-7xl overflow-y-auto rounded-lg bg-white shadow-xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  {editingSupplyId ? 'Revise Requisition Slip' : 'Concrete Requisition Slip'}
                </h2>
                <p className="min-h-6 font-mono text-sm font-semibold text-[#134377]">{generatedSupplyId}</p>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="rounded-md bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-700"
              >
                Close
              </button>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-7 p-6">
              <Section title="Reference Details">
                <Field label="RFI no.">
                  <input className={fieldClass} {...register('rfi_no')} />
                </Field>

                <Field label="Date" required error={errors.requisition_date?.message}>
                  <input
                    type="date"
                    className={fieldClass}
                    {...register('requisition_date', { required: 'Date is required' })}
                  />
                </Field>

                <Field label="Location" required error={errors.location?.message}>
                  <Controller
                    name="location"
                    control={control}
                    rules={{ required: 'Location is required' }}
                    render={({ field }) => (
                      <Select
                        classNames={selectClassNames}
                        isSearchable
                        options={locationOptions}
                        value={optionFor(locationOptions, field.value)}
                        onChange={(option) => {
                          field.onChange(option?.value || '');
                          setValue('structure_type', '');
                          setValue('structure_name', '');
                          setValue('structure_id', '');
                          setValue('pile_lift_id', '');
                          setStructureNameOptions([]);
                          setStructureIdOptions([]);
                          setElementIdOptions([]);
                        }}
                      />
                    )}
                  />
                </Field>

                <Field label="Structure Type" error={errors.structure_type?.message}>
                  <Controller
                    name="structure_type"
                    control={control}
                    render={({ field }) => (
                      <Select
                        classNames={selectClassNames}
                        isSearchable
                        isDisabled={!locationValue}
                        options={structureTypeOptions}
                        value={optionFor(structureTypeOptions, field.value)}
                        onChange={(option) => {
                          field.onChange(option?.value || '');
                          setValue('structure_name', '');
                          setValue('structure_id', '');
                          setValue('pile_lift_id', '');
                          setStructureIdOptions([]);
                          setElementIdOptions([]);
                        }}
                      />
                    )}
                  />
                </Field>

                <Field label="Structure Name" required error={errors.structure_name?.message}>
                  <Controller
                    name="structure_name"
                    control={control}
                    rules={{ required: 'Structure name is required' }}
                    render={({ field }) => (
                      <Select
                        classNames={selectClassNames}
                        isSearchable
                        isDisabled={!locationValue || !structureTypeValue}
                        options={structureNameOptions}
                        value={optionFor(structureNameOptions, field.value)}
                        onChange={(option) => {
                          field.onChange(option?.value || '');
                          setValue('structure_id', '');
                          setValue('pile_lift_id', '');
                          setElementIdOptions([]);
                        }}
                      />
                    )}
                  />
                </Field>

                <Field label="Structure ID" required error={errors.structure_id?.message}>
                  <input
                    className={fieldClass}
                    list="structure-id-options"
                    disabled={!locationValue || !structureTypeValue || !structureNameValue}
                    {...register('structure_id', {
                      required: 'Structure ID is required',
                      onChange: () => setValue('pile_lift_id', ''),
                    })}
                  />
                  <datalist id="structure-id-options">
                    {structureIdOptions.map((option) => (
                      <option key={option.value} value={option.value} />
                    ))}
                  </datalist>
                </Field>

                <Field label="Element ID">
                  <Controller
                    name="pile_lift_id"
                    control={control}
                    render={({ field }) => (
                      <Select
                        classNames={selectClassNames}
                        isClearable
                        isSearchable
                        isDisabled={!locationValue || !structureTypeValue || !structureNameValue || !structureIdValue || elementIdOptions.length === 0}
                        options={elementIdOptions}
                        value={optionFor(elementIdOptions, field.value)}
                        onChange={(option) => field.onChange(option?.value || '')}
                      />
                    )}
                  />
                </Field>

                <Field label="Concrete Grade" required error={errors.grade?.message}>
                  <select className={fieldClass} {...register('grade', { required: 'Grade is required' })}>
                    <option value=""></option>
                    {gradeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </Section>

              <Section title="Dimension as per Drawing">
                <Field label="Drawing No.">
                  <input className={fieldClass} {...register('drawing_no')} />
                </Field>

                <Field label="Length of Structure (m)">
                  <input type="number" step="0.01" placeholder="0" className={fieldClass} {...register('drawing_length', { valueAsNumber: true })} />
                </Field>

                <Field label="Diameter of Pile / Pier (m)">
                  <input type="number" step="0.01" placeholder="0" className={fieldClass} {...register('drawing_diameter', { valueAsNumber: true })} />
                </Field>

                <Field label="Theoretical Qty (cum)">
                  <input type="number" step="0.01" placeholder="0" className={fieldClass} {...register('theoretical_qty', { valueAsNumber: true })} />
                </Field>
              </Section>

              <Section title="Dimension as per Actual Site">
                <Field label="Length of Structure (m)">
                  <input type="number" step="0.01" placeholder="0" className={fieldClass} {...register('actual_length', { valueAsNumber: true })} />
                </Field>

                <Field label="Diameter of Pile / Pier (m)">
                  <input type="number" step="0.01" placeholder="0" className={fieldClass} {...register('actual_diameter', { valueAsNumber: true })} />
                </Field>

                <Field label="Actual Qty (cum)">
                  <input type="number" step="0.01" placeholder="0" className={fieldClass} {...register('actual_qty', { valueAsNumber: true })} />
                </Field>

                <Field label="Qty Difference (cum)">
                  <input className={readOnlyClass} readOnly placeholder="0" {...register('qty_difference')} />
                </Field>
              </Section>

              <Section title="Order Details">
                <Field label="Reason for Difference">
                  <input className={fieldClass} {...register('difference_reason')} />
                </Field>

                <Field label="Order Quantity (cum)" required error={errors.requested_qty?.message}>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0"
                    className={fieldClass}
                    {...register('requested_qty', {
                      required: 'Order quantity is required',
                      min: { value: 0.1, message: 'Quantity must be greater than 0' },
                      max: { value: 10000, message: 'Quantity cannot exceed 10000' },
                      valueAsNumber: true,
                    })}
                  />
                </Field>

                <Field label="Time of Pour">
                  <input type="time" className={fieldClass} {...register('pour_time')} />
                </Field>

                <Field label="Placement By">
                  <select className={fieldClass} {...register('placement_by')}>
                    <option value=""></option>
                    {placementOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </Section>

              <Section title="Contact Details">
                <input type="hidden" {...register('in_charge_id')} />

                <Field label="In-charge Name" required error={errors.in_charge_name?.message}>
                  <input
                    className={fieldClass}
                    {...register('in_charge_name', { required: 'In-charge name is required' })}
                  />
                </Field>

                <Field label="Selected In-charge" required error={errors.selected_in_charge?.message}>
                  <input
                    className={fieldClass}
                    {...register('selected_in_charge', { required: 'Selected in-charge is required' })}
                  />
                </Field>

                <Field label="Contact Person / Engineer">
                  <input className={fieldClass} {...register('contact_person')} />
                </Field>

                <Field label="Contact Number">
                  <input className={fieldClass} {...register('contact_number')} />
                </Field>
              </Section>

              <div className="sticky bottom-0 flex justify-end gap-3 border-t border-gray-200 bg-white pt-5">
                {!editingSupplyId && (
                  <button
                    type="button"
                    onClick={saveDraft}
                    className="rounded-md border border-[#134377] px-5 py-3 text-sm font-semibold text-[#134377] hover:bg-[#134377]/10"
                  >
                    Save as Draft
                  </button>
                )}
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-md bg-[#134377] px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-[#134377] disabled:bg-gray-400"
                >
                  {submitting ? 'Submitting...' : editingSupplyId ? 'Resubmit Requisition' : 'Create Requisition'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExecutionView;
