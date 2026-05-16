// pages/ProductionView.tsx - Production team dispatch logging
import React, { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { productionAPI, requisitionAPI, userAPI } from '../api';
import PastRequisitionsTable from '../components/PastRequisitionsTable';
import RequisitionFilters, {
  defaultRequisitionFilters,
  filterRequisitions,
  formatOrderDate,
  RequisitionFilterState,
} from '../components/RequisitionFilters';
import RequisitionDetails from '../components/RequisitionDetails';
import { ConcreteRequisition, RequisitionStatus } from '../types';

interface DispatchFormData {
  batching_plant_id: string;
  tm_number: string;
  actual_dispatched_qty?: number;
  dispatch_time: string;
  receipt_location: string;
}

const getErrorMessage = (error: any, fallback: string) => {
  const detail = error.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail.map((item) => item?.msg || item?.message || String(item)).join(', ');
  }
  return fallback;
};

const fieldClass =
  'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-[#003F72] focus:ring-2 focus:ring-[#003F72]/15';

const display = (value: unknown) => {
  if (value === undefined || value === null || value === '') return '-';
  if (typeof value === 'number') return Number.isFinite(value) ? value.toFixed(2) : '-';
  return String(value);
};

const ProductionView: React.FC = () => {
  const [requisitions, setRequisitions] = useState<ConcreteRequisition[]>([]);
  const [history, setHistory] = useState<ConcreteRequisition[]>([]);
  const [filters, setFilters] = useState<RequisitionFilterState>(defaultRequisitionFilters);
  const [selectedRequisition, setSelectedRequisition] = useState<ConcreteRequisition | null>(null);
  const [viewingOrder, setViewingOrder] = useState<ConcreteRequisition | null>(null);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [dispatching, setDispatching] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<DispatchFormData>({
    defaultValues: {
      batching_plant_id: '',
      dispatch_time: new Date().toISOString().slice(0, 16),
      receipt_location: '',
    },
  });

  const fetchValidatedRequisitions = async () => {
    try {
      setLoading(true);
      const [validatedReqs, allReqs, users] = await Promise.all([
        requisitionAPI.getRequisitions(RequisitionStatus.VALIDATED),
        requisitionAPI.getRequisitions(),
        userAPI.getUsers(),
      ]);
      setRequisitions(validatedReqs);
      setHistory(
        allReqs.filter((req) =>
          [RequisitionStatus.VALIDATED, RequisitionStatus.DISPATCHED, RequisitionStatus.RECONCILED].includes(req.status)
        )
      );
      setUserNames(Object.fromEntries(users.map((user) => [user.id, user.name])));
    } catch (error) {
      console.error('Failed to fetch requisitions:', error);
      setMessage({
        type: 'error',
        text: 'Failed to load requisitions. Please refresh.',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchValidatedRequisitions();
  }, []);

  const filteredRequisitions = useMemo(
    () => filterRequisitions(requisitions, filters),
    [filters, requisitions]
  );
  const filteredHistory = useMemo(() => filterRequisitions(history, filters), [filters, history]);

  const openDispatch = (req: ConcreteRequisition) => {
    setSelectedRequisition(req);
    setMessage(null);
    reset({
      batching_plant_id: '',
      tm_number: '',
      actual_dispatched_qty: req.requested_qty,
      dispatch_time: new Date().toISOString().slice(0, 16),
      receipt_location: req.location,
    });
  };

  const onSubmit = async (data: DispatchFormData) => {
    if (!selectedRequisition || !data.actual_dispatched_qty) return;

    setDispatching(true);
    setMessage(null);

    try {
      const result = await productionAPI.createDispatch({
        supply_id: selectedRequisition.supply_id,
        batching_plant_id: data.batching_plant_id,
        tm_number: data.tm_number,
        actual_dispatched_qty: data.actual_dispatched_qty,
        dispatch_time: new Date(data.dispatch_time).toISOString(),
        receipt_location: data.receipt_location,
      });

      const wastage = selectedRequisition.requested_qty - result.actual_dispatched_qty;
      const wastagePercent = ((wastage / selectedRequisition.requested_qty) * 100).toFixed(2);

      setMessage({
        type: 'success',
        text: `Dispatch logged for TM ${data.tm_number}. Wastage: ${wastagePercent}%.`,
      });

      setSelectedRequisition(null);
      await fetchValidatedRequisitions();
    } catch (error: any) {
      console.error('Dispatch error:', error);
      setMessage({
        type: 'error',
        text: getErrorMessage(error, 'Failed to log dispatch'),
      });
    } finally {
      setDispatching(false);
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
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Production Dispatch</h1>
          <p className="text-sm text-gray-600">Log concrete dispatch and transit mixer details</p>
        </div>
        <RequisitionFilters
          filters={filters}
          onChange={setFilters}
          resultCount={filteredRequisitions.length + filteredHistory.length}
          totalCount={requisitions.length + history.length}
          className="xl:w-[760px]"
        />
      </div>

      {message && (
        <div className={`alert ${message.type === 'success' ? 'alert-success' : 'alert-danger'}`}>
          {message.text}
        </div>
      )}

      <div className="overflow-hidden rounded-lg bg-white shadow-md">
        <div className="bg-[#003F72] px-5 py-4 text-white">
          <h2 className="text-lg font-semibold">Validated Orders ({filteredRequisitions.length})</h2>
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
                <th className="px-4 py-3 text-right text-xs font-bold uppercase text-gray-600">Requested Qty</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase text-gray-600">Planning Remarks</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase text-gray-600">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredRequisitions.map((req) => (
                <tr key={req.supply_id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-sm">{req.supply_id}</td>
                  <td className="px-4 py-3 text-sm">{formatOrderDate(req)}</td>
                  <td className="px-4 py-3 text-sm">{req.location}</td>
                  <td className="px-4 py-3 text-sm">{req.structure_name}</td>
                  <td className="px-4 py-3 text-sm">{req.grade}</td>
                  <td className="px-4 py-3 text-right text-sm">{req.requested_qty.toFixed(2)}</td>
                  <td className="max-w-[260px] truncate px-4 py-3 text-sm" title={req.planning_remarks || ''}>
                    {req.planning_remarks || '-'}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => openDispatch(req)}
                      className="rounded bg-[#003F72] px-3 py-1 text-sm font-semibold text-white"
                    >
                      Dispatch
                    </button>
                  </td>
                </tr>
              ))}

              {filteredRequisitions.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-500">
                    No validated requisitions ready for dispatch
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PastRequisitionsTable requisitions={filteredHistory} onView={setViewingOrder} />

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

      {selectedRequisition && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[92vh] w-full max-w-7xl overflow-y-auto rounded-lg bg-white shadow-xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Dispatch Order</h2>
                <p className="font-mono text-sm font-semibold text-[#003F72]">
                  {selectedRequisition.supply_id}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRequisition(null)}
                className="rounded-md bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-700"
              >
                Close
              </button>
            </div>

            <div className="grid gap-6 p-6 xl:grid-cols-[1fr_380px]">
              <div className="h-fit space-y-4">
                <h3 className="text-sm font-bold uppercase tracking-wide text-[#003F72]">
                  Order Details
                </h3>
                <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {([
                    ['Date', selectedRequisition.requisition_date || new Date(selectedRequisition.req_date).toLocaleDateString()],
                    ['Supply ID', selectedRequisition.supply_id],
                    ['Location', selectedRequisition.location],
                    ['In-Charge', userNames[selectedRequisition.in_charge_id] || selectedRequisition.in_charge_id],
                    ['Engineer', selectedRequisition.contact_person],
                    ['Structure Name', selectedRequisition.structure_name],
                    ['Structure ID', selectedRequisition.structure_id],
                    ['Grade', selectedRequisition.grade],
                    ['Quantity', selectedRequisition.requested_qty],
                    ['Time', selectedRequisition.pour_time],
                    ['Placement by', selectedRequisition.placement_by],
                    ['Planning Remarks', selectedRequisition.planning_remarks],
                  ] as Array<[string, unknown]>).map(([label, value]) => (
                    <div key={label} className="min-w-0 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                      <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</dt>
                      <dd className="mt-1 truncate text-sm font-medium text-gray-900" title={display(value)}>
                        {display(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>

              <aside className="h-fit rounded-lg border border-gray-200 bg-gray-50 p-4">
                <h3 className="mb-4 text-sm font-bold uppercase tracking-wide text-[#003F72]">
                  Dispatch Details
                </h3>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">
                      Batching Plant ID
                    </label>
                    <input
                      className={fieldClass}
                      {...register('batching_plant_id', { required: 'Batching plant ID is required' })}
                    />
                    {errors.batching_plant_id && (
                      <p className="mt-1 text-xs text-red-600">{errors.batching_plant_id.message}</p>
                    )}
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">
                      Allocated Vehicle
                    </label>
                    <input
                      className={fieldClass}
                      {...register('tm_number', { required: 'Allocated vehicle is required' })}
                    />
                    {errors.tm_number && (
                      <p className="mt-1 text-xs text-red-600">{errors.tm_number.message}</p>
                    )}
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">
                      Quantity Dispatched (cum)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="0"
                      className={fieldClass}
                      {...register('actual_dispatched_qty', {
                        required: 'Quantity is required',
                        min: { value: 0.1, message: 'Must be greater than 0' },
                        valueAsNumber: true,
                      })}
                    />
                    {errors.actual_dispatched_qty && (
                      <p className="mt-1 text-xs text-red-600">{errors.actual_dispatched_qty.message}</p>
                    )}
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">
                      Dispatch time
                    </label>
                    <input
                      type="datetime-local"
                      className={fieldClass}
                      {...register('dispatch_time', { required: 'Dispatch time is required' })}
                    />
                    {errors.dispatch_time && (
                      <p className="mt-1 text-xs text-red-600">{errors.dispatch_time.message}</p>
                    )}
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">
                      Receipt Location
                    </label>
                    <input
                      className={fieldClass}
                      {...register('receipt_location', { required: 'Receipt location is required' })}
                    />
                    {errors.receipt_location && (
                      <p className="mt-1 text-xs text-red-600">{errors.receipt_location.message}</p>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={dispatching}
                    className="w-full rounded-md bg-[#003F72] px-5 py-3 text-sm font-semibold text-white hover:bg-[#002B4E] disabled:bg-gray-400"
                  >
                    {dispatching ? 'Submitting...' : 'Submit Dispatch'}
                  </button>
                </form>
              </aside>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductionView;
