// pages/ExecutionView.tsx - Execution team requisition form
import React, { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { requisitionAPI, userAPI } from '../api';
import PastRequisitionsTable from '../components/PastRequisitionsTable';
import RequisitionFilters, {
  defaultRequisitionFilters,
  filterRequisitions,
  formatOrderDate,
  RequisitionFilterState,
} from '../components/RequisitionFilters';
import RequisitionDetails from '../components/RequisitionDetails';
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
  contact_person: string;
  contact_number: string;
}

interface DraftOrder {
  draft_id: string;
  updated_at: string;
  data: ExecutionFormData;
}

const today = () => new Date().toISOString().slice(0, 10);

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

const locationOptions = ['Gorai IC', 'Charkop IC', 'Gorai Jetty', 'Main Carraigeway', 'Casting Yard'];
const structureTypeOptions = ['Permanent', 'Enabling'];
const structureNameOptions = [
  'Pile',
  'Pile Cap',
  'Pier',
  'Pier Cap',
  'I-Girder',
  'Segment',
  'Diaphragm',
  'Deck Slab',
  'Voided Slab',
];
const gradeOptions = ['M-10', 'M-20', 'M-25', 'M-30', 'M-45', 'M-45P', 'M-50', 'M-55', 'M-60'];

const fieldClass =
  'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-[#003F72] focus:ring-2 focus:ring-[#003F72]/15';

const readOnlyClass =
  'w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-700';

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
      <h2 className="text-sm font-bold uppercase tracking-wide text-[#003F72]">{title}</h2>
    </div>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{children}</div>
  </section>
);

const ExecutionView: React.FC<ExecutionViewProps> = ({ currentUser }) => {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    getValues,
    formState: { errors },
    reset,
  } = useForm<ExecutionFormData>({
    defaultValues: defaultValues(currentUser),
  });

  const [users, setUsers] = useState<User[]>([]);
  const [orders, setOrders] = useState<ConcreteRequisition[]>([]);
  const [drafts, setDrafts] = useState<DraftOrder[]>([]);
  const [filters, setFilters] = useState<RequisitionFilterState>(defaultRequisitionFilters);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [viewingOrder, setViewingOrder] = useState<ConcreteRequisition | null>(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [generatedSupplyId, setGeneratedSupplyId] = useState('');

  const draftStorageKey = `executionDrafts:${currentUser?.id || 'anonymous'}`;

  const locationValue = watch('location');
  const structureNameValue = watch('structure_name');
  const structureIdValue = watch('structure_id');
  const theoreticalQty = watch('theoretical_qty');
  const actualQty = watch('actual_qty');
  const inChargeValue = watch('in_charge_id');

  const selectedInChargeName = useMemo(() => {
    return users.find((user) => user.id === inChargeValue)?.name || currentUser?.name || '';
  }, [currentUser?.name, inChargeValue, users]);

  const currentOrders = useMemo(
    () => orders.filter((order) => order.status === RequisitionStatus.PENDING),
    [orders]
  );
  const historyOrders = useMemo(
    () => orders.filter((order) => order.status !== RequisitionStatus.PENDING),
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

  const fetchOrders = async () => {
    const reqs = await requisitionAPI.getRequisitions();
    setOrders(reqs.filter((req) => req.in_charge_id === currentUser?.id));
  };

  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const fetchedUsers = await userAPI.getUsers();
        setUsers(fetchedUsers);
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
    const difference = Number(theoreticalQty || 0) - Number(actualQty || 0);
    setValue('qty_difference', Number.isFinite(difference) ? Number(difference.toFixed(2)) : undefined);
  }, [actualQty, setValue, theoreticalQty]);

  useEffect(() => {
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
  }, [locationValue, structureNameValue, structureIdValue]);

  const openNewOrder = () => {
    reset(defaultValues(currentUser));
    setActiveDraftId(null);
    setGeneratedSupplyId('');
    setIsModalOpen(true);
  };

  const resumeDraft = (draft: DraftOrder) => {
    reset(draft.data);
    setActiveDraftId(draft.draft_id);
    setIsModalOpen(true);
  };

  const deleteDraft = (draftId: string) => {
    saveDrafts(drafts.filter((draft) => draft.draft_id !== draftId));
  };

  const saveDraft = () => {
    const draft: DraftOrder = {
      draft_id: activeDraftId || crypto.randomUUID(),
      updated_at: new Date().toISOString(),
      data: getValues(),
    };
    const nextDrafts = activeDraftId
      ? drafts.map((item) => (item.draft_id === activeDraftId ? draft : item))
      : [draft, ...drafts];

    saveDrafts(nextDrafts);
    setActiveDraftId(draft.draft_id);
    setSuccessMessage('Draft saved.');
    setTimeout(() => setSuccessMessage(''), 3000);
  };

  const buildPayload = (data: ExecutionFormData) => ({
    ...data,
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
      const response = await requisitionAPI.createRequisition(buildPayload(data));
      setSuccessMessage(`Requisition created successfully. Supply ID: ${response.supply_id}`);
      if (activeDraftId) {
        saveDrafts(drafts.filter((draft) => draft.draft_id !== activeDraftId));
      }
      reset(defaultValues(currentUser));
      setActiveDraftId(null);
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
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-[#003F72]"></div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Execution Orders</h1>
          <p className="text-sm text-gray-600">Track submitted requisitions and resume saved drafts</p>
        </div>
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
          <RequisitionFilters
            filters={filters}
            onChange={setFilters}
            resultCount={filteredCurrentOrders.length + filteredHistoryOrders.length}
            totalCount={orders.length}
            className="xl:w-[760px]"
          />
          <button
            type="button"
            onClick={openNewOrder}
            className="h-10 shrink-0 rounded-md bg-[#003F72] px-5 text-sm font-semibold text-white shadow-sm hover:bg-[#002B4E]"
          >
            Create New Order
          </button>
        </div>
      </div>

      {successMessage && <div className="alert alert-success">{successMessage}</div>}
      {errorMessage && <div className="alert alert-danger">{errorMessage}</div>}

      <div className="overflow-hidden rounded-lg bg-white shadow-md">
        <div className="border-b border-gray-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Current Orders ({filteredCurrentOrders.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px]">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase text-gray-600">Supply ID</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase text-gray-600">Date</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase text-gray-600">Location</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase text-gray-600">Structure</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase text-gray-600">Grade</th>
                <th className="px-4 py-3 text-right text-xs font-bold uppercase text-gray-600">Order Qty</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase text-gray-600">Process Status</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase text-gray-600">Decision</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase text-gray-600">Remarks</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase text-gray-600">Action</th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((draft) => (
                <tr key={draft.draft_id} className="border-t border-gray-100 bg-amber-50/60">
                  <td className="px-4 py-3 text-sm font-semibold text-amber-800">Draft</td>
                  <td className="px-4 py-3 text-sm">{draft.data.requisition_date || new Date(draft.updated_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-sm">{draft.data.location || '-'}</td>
                  <td className="px-4 py-3 text-sm">{draft.data.structure_name || '-'}</td>
                  <td className="px-4 py-3 text-sm">{draft.data.grade || '-'}</td>
                  <td className="px-4 py-3 text-right text-sm">
                    {draft.data.requested_qty ? draft.data.requested_qty.toFixed(2) : '-'}
                  </td>
                  <td className="px-4 py-3 text-sm">Draft</td>
                  <td className="px-4 py-3 text-sm">-</td>
                  <td className="px-4 py-3 text-sm">Saved {new Date(draft.updated_at).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => resumeDraft(draft)}
                        className="rounded bg-[#003F72] px-3 py-1 text-xs font-semibold text-white"
                      >
                        Resume
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteDraft(draft.draft_id)}
                        className="rounded bg-gray-200 px-3 py-1 text-xs font-semibold text-gray-700"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {filteredCurrentOrders.map((order) => (
                <tr key={order.supply_id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-sm">{order.supply_id}</td>
                  <td className="px-4 py-3 text-sm">{formatOrderDate(order)}</td>
                  <td className="px-4 py-3 text-sm">{order.location}</td>
                  <td className="px-4 py-3 text-sm">{order.structure_name}</td>
                  <td className="px-4 py-3 text-sm">{order.grade}</td>
                  <td className="px-4 py-3 text-right text-sm">{order.requested_qty.toFixed(2)}</td>
                  <td className="px-4 py-3 text-sm">{order.status}</td>
                  <td className="px-4 py-3 text-sm">{order.approval_status || '-'}</td>
                  <td className="max-w-[220px] truncate px-4 py-3 text-sm" title={order.planning_remarks || ''}>
                    {order.planning_remarks || '-'}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setViewingOrder(order)}
                      className="rounded bg-[#003F72]/10 px-3 py-1 text-xs font-semibold text-[#003F72]"
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}

              {drafts.length === 0 && filteredCurrentOrders.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-sm text-gray-500">
                    No orders yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PastRequisitionsTable
        requisitions={filteredHistoryOrders}
        emptyText="No past requisitions found."
        onView={setViewingOrder}
      />

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
            <RequisitionDetails requisition={viewingOrder} />
          </div>
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[92vh] w-full max-w-7xl overflow-y-auto rounded-lg bg-white shadow-xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Concrete Requisition Slip</h2>
                <p className="min-h-6 font-mono text-sm font-semibold text-[#003F72]">{generatedSupplyId}</p>
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
                  <select className={fieldClass} {...register('location', { required: 'Location is required' })}>
                    <option value=""></option>
                    {locationOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Structure Type">
                  <select className={fieldClass} {...register('structure_type')}>
                    <option value=""></option>
                    {structureTypeOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Structure Name" required error={errors.structure_name?.message}>
                  <select className={fieldClass} {...register('structure_name', { required: 'Structure name is required' })}>
                    <option value=""></option>
                    {structureNameOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Structure ID" required error={errors.structure_id?.message}>
                  <input className={fieldClass} {...register('structure_id', { required: 'Structure ID is required' })} />
                </Field>

                <Field label="Element ID">
                  <input className={fieldClass} {...register('pile_lift_id')} />
                </Field>

                <Field label="Concrete Grade" required error={errors.grade?.message}>
                  <select className={fieldClass} {...register('grade', { required: 'Grade is required' })}>
                    <option value=""></option>
                    {gradeOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
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
                  <input className={fieldClass} {...register('placement_by')} />
                </Field>
              </Section>

              <Section title="Contact Details">
                <Field label="In-charge Name" required error={errors.in_charge_id?.message}>
                  <select
                    className={fieldClass}
                    {...register('in_charge_id', { required: 'Please select an in-charge person' })}
                  >
                    <option value=""></option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name} ({user.email})
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Selected In-charge">
                  <input className={readOnlyClass} readOnly value={selectedInChargeName} />
                </Field>

                <Field label="Contact Person / Engineer">
                  <input className={fieldClass} {...register('contact_person')} />
                </Field>

                <Field label="Contact Number">
                  <input className={fieldClass} {...register('contact_number')} />
                </Field>
              </Section>

              <div className="sticky bottom-0 flex justify-end gap-3 border-t border-gray-200 bg-white pt-5">
                <button
                  type="button"
                  onClick={saveDraft}
                  className="rounded-md border border-[#003F72] px-5 py-3 text-sm font-semibold text-[#003F72] hover:bg-[#003F72]/10"
                >
                  Save as Draft
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-md bg-[#003F72] px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-[#002B4E] disabled:bg-gray-400"
                >
                  {submitting ? 'Creating...' : 'Create Requisition'}
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
