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
import { ConcreteRequisition, ProductionDispatch, RequisitionStatus } from '../types';

interface ReconciliationFormData {
  receipt_at_site_date: string;
  receipt_at_site_time: string;
  release_from_site_date: string;
  release_from_site_time: string;
  return_to_plant_date: string;
  return_to_plant_time: string;
  remarks: string;
}

interface DispatchOrder {
  dispatch: ProductionDispatch;
  requisition?: ConcreteRequisition;
}

const fieldClass =
  'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-[#003F72] focus:ring-2 focus:ring-[#003F72]/15';

const today = () => new Date().toISOString().slice(0, 10);

const combineDateTime = (date: string, time: string) => new Date(`${date}T${time}`).toISOString();

const display = (value: unknown) => {
  if (value === undefined || value === null || value === '') return '-';
  if (typeof value === 'number') return Number.isFinite(value) ? value.toFixed(2) : '-';
  return String(value);
};

const getErrorMessage = (error: any, fallback: string) => {
  const detail = error.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail.map((item) => item?.msg || item?.message || String(item)).join(', ');
  }
  return fallback;
};

const DispatchSummaryView: React.FC = () => {
  const [orders, setOrders] = useState<DispatchOrder[]>([]);
  const [history, setHistory] = useState<ConcreteRequisition[]>([]);
  const [filters, setFilters] = useState<RequisitionFilterState>(defaultRequisitionFilters);
  const [selectedOrder, setSelectedOrder] = useState<DispatchOrder | null>(null);
  const [viewingOrder, setViewingOrder] = useState<ConcreteRequisition | null>(null);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
    reset,
  } = useForm<ReconciliationFormData>();

  const draftStorageKey = 'dispatchReconciliationDrafts';

  const readDrafts = (): Record<string, ReconciliationFormData> => {
    const rawDrafts = localStorage.getItem(draftStorageKey);
    return rawDrafts ? JSON.parse(rawDrafts) : {};
  };

  const writeDrafts = (drafts: Record<string, ReconciliationFormData>) => {
    localStorage.setItem(draftStorageKey, JSON.stringify(drafts));
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      const [dispatches, requisitions, users] = await Promise.all([
        productionAPI.getAllDispatches(0, 200),
        requisitionAPI.getRequisitions(),
        userAPI.getUsers(),
      ]);

      const requisitionsBySupplyId = new Map(requisitions.map((req) => [req.supply_id, req]));
      setOrders(
        dispatches
          .map((dispatch) => ({
            dispatch,
            requisition: requisitionsBySupplyId.get(dispatch.supply_id),
          }))
          .filter((order) => !order.dispatch.return_to_plant_time)
      );
      setHistory(
        requisitions.filter((req) =>
          [RequisitionStatus.VALIDATED, RequisitionStatus.DISPATCHED, RequisitionStatus.RECONCILED].includes(req.status)
        )
      );
      setUserNames(Object.fromEntries(users.map((user) => [user.id, user.name])));
    } catch (error) {
      console.error('Failed to fetch dispatch summary:', error);
      setMessage({ type: 'error', text: 'Failed to load dispatch summary. Please refresh.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const openReconcile = (order: DispatchOrder) => {
    setSelectedOrder(order);
    setMessage(null);
    const draft = readDrafts()[order.dispatch.dispatch_id];
    reset({
      receipt_at_site_date: draft?.receipt_at_site_date || today(),
      receipt_at_site_time: draft?.receipt_at_site_time || '',
      release_from_site_date: draft?.release_from_site_date || today(),
      release_from_site_time: draft?.release_from_site_time || '',
      return_to_plant_date: draft?.return_to_plant_date || today(),
      return_to_plant_time: draft?.return_to_plant_time || '',
      remarks: draft?.remarks || order.dispatch.remarks || '',
    });
  };

  const saveDraft = () => {
    if (!selectedOrder) return;
    const drafts = readDrafts();
    drafts[selectedOrder.dispatch.dispatch_id] = getValues();
    writeDrafts(drafts);
    setMessage({ type: 'success', text: 'Draft saved.' });
    setSelectedOrder(null);
  };

  const onSubmit = async (data: ReconciliationFormData) => {
    if (!selectedOrder) return;

    setSubmitting(true);
    setMessage(null);

    try {
      await productionAPI.reconcileDispatch(selectedOrder.dispatch.dispatch_id, {
        receipt_at_site_time: combineDateTime(data.receipt_at_site_date, data.receipt_at_site_time),
        release_from_site_time: combineDateTime(data.release_from_site_date, data.release_from_site_time),
        return_to_plant_time: combineDateTime(data.return_to_plant_date, data.return_to_plant_time),
        remarks: data.remarks || undefined,
      });
      const drafts = readDrafts();
      delete drafts[selectedOrder.dispatch.dispatch_id];
      writeDrafts(drafts);
      setMessage({ type: 'success', text: 'Dispatch reconciled.' });
      setSelectedOrder(null);
      await fetchData();
    } catch (error: any) {
      console.error('Reconciliation error:', error);
      setMessage({ type: 'error', text: getErrorMessage(error, 'Failed to reconcile dispatch') });
    } finally {
      setSubmitting(false);
    }
  };

  const selectedDetails = useMemo(() => {
    if (!selectedOrder) return [];
    const { dispatch, requisition } = selectedOrder;
    return [
      ['Date', requisition?.requisition_date || (requisition ? new Date(requisition.req_date).toLocaleDateString() : '-')],
      ['Supply ID', dispatch.supply_id],
      ['Location', requisition?.location],
      ['In-Charge', requisition ? userNames[requisition.in_charge_id] || requisition.in_charge_id : '-'],
      ['Engineer', requisition?.contact_person],
      ['Structure Name', requisition?.structure_name],
      ['Structure ID', requisition?.structure_id],
      ['Grade', requisition?.grade],
      ['Quantity', requisition?.requested_qty],
      ['Time', requisition?.pour_time],
      ['Placement by', requisition?.placement_by],
      ['Planning Remarks', requisition?.planning_remarks],
      ['Batching Plant ID', dispatch.batching_plant_id],
      ['Allocated Vehicle', dispatch.tm_number],
      ['Quantity Dispatched', dispatch.actual_dispatched_qty],
      ['Dispatch time', new Date(dispatch.dispatch_time).toLocaleString()],
      ['Receipt Location', dispatch.receipt_location],
    ] as Array<[string, unknown]>;
  }, [selectedOrder, userNames]);

  const filteredOrders = useMemo(() => {
    const requisitions = orders
      .map((order) => order.requisition)
      .filter((requisition): requisition is ConcreteRequisition => Boolean(requisition));
    const allowedSupplyIds = new Set(filterRequisitions(requisitions, filters).map((req) => req.supply_id));
    return orders.filter((order) => order.requisition && allowedSupplyIds.has(order.requisition.supply_id));
  }, [filters, orders]);

  const filteredHistory = useMemo(() => filterRequisitions(history, filters), [filters, history]);

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
          <h1 className="text-3xl font-bold text-gray-900">Dispatch Summary</h1>
          <p className="text-sm text-gray-600">Acknowledge site receipt and reconcile dispatched orders</p>
        </div>
        <RequisitionFilters
          filters={filters}
          onChange={setFilters}
          resultCount={filteredOrders.length + filteredHistory.length}
          totalCount={orders.length + history.length}
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
          <h2 className="text-lg font-semibold">Dispatched Orders ({filteredOrders.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1060px]">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase text-gray-600">Supply ID</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase text-gray-600">Date</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase text-gray-600">Location</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase text-gray-600">Vehicle</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase text-gray-600">Plant</th>
                <th className="px-4 py-3 text-right text-xs font-bold uppercase text-gray-600">Qty Dispatched</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase text-gray-600">Dispatch Time</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase text-gray-600">Receipt Location</th>
                <th className="px-4 py-3 text-left text-xs font-bold uppercase text-gray-600">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((order) => (
                <tr key={order.dispatch.dispatch_id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-sm">{order.dispatch.supply_id}</td>
                  <td className="px-4 py-3 text-sm">{order.requisition ? formatOrderDate(order.requisition) : '-'}</td>
                  <td className="px-4 py-3 text-sm">{order.requisition?.location || '-'}</td>
                  <td className="px-4 py-3 text-sm">{order.dispatch.tm_number}</td>
                  <td className="px-4 py-3 text-sm">{order.dispatch.batching_plant_id || '-'}</td>
                  <td className="px-4 py-3 text-right text-sm">{order.dispatch.actual_dispatched_qty.toFixed(2)}</td>
                  <td className="px-4 py-3 text-sm">{new Date(order.dispatch.dispatch_time).toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm">{order.dispatch.receipt_location || '-'}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => openReconcile(order)}
                      className="h-8 w-8 rounded bg-[#003F72] text-lg font-semibold leading-none text-white"
                      aria-label="Add acknowledgement"
                      title="Add acknowledgement"
                    >
                      +
                    </button>
                  </td>
                </tr>
              ))}

              {filteredOrders.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-sm text-gray-500">
                    No dispatched orders waiting for acknowledgement.
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

      {selectedOrder && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[92vh] w-full max-w-7xl overflow-y-auto rounded-lg bg-white shadow-xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Acknowledge Dispatch</h2>
                <p className="font-mono text-sm font-semibold text-[#003F72]">
                  {selectedOrder.dispatch.supply_id}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                className="rounded-md bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-700"
              >
                Close
              </button>
            </div>

            <div className="grid gap-6 p-6 xl:grid-cols-[1fr_380px]">
              <div className="h-fit space-y-4">
                <h3 className="text-sm font-bold uppercase tracking-wide text-[#003F72]">
                  Dispatch Details
                </h3>
                <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {selectedDetails.map(([label, value]) => (
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
                  Site Acknowledgement
                </h3>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">
                      Receipt at site
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="date"
                        className={fieldClass}
                        {...register('receipt_at_site_date', { required: 'Receipt date is required' })}
                      />
                      <input
                        type="time"
                        className={fieldClass}
                        {...register('receipt_at_site_time', { required: 'Receipt time is required' })}
                      />
                    </div>
                    {(errors.receipt_at_site_date || errors.receipt_at_site_time) && (
                      <p className="mt-1 text-xs text-red-600">
                        {errors.receipt_at_site_date?.message || errors.receipt_at_site_time?.message}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">
                      Release from site
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="date"
                        className={fieldClass}
                        {...register('release_from_site_date', { required: 'Release date is required' })}
                      />
                      <input
                        type="time"
                        className={fieldClass}
                        {...register('release_from_site_time', { required: 'Release time is required' })}
                      />
                    </div>
                    {(errors.release_from_site_date || errors.release_from_site_time) && (
                      <p className="mt-1 text-xs text-red-600">
                        {errors.release_from_site_date?.message || errors.release_from_site_time?.message}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">
                      Return to Plant
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="date"
                        className={fieldClass}
                        {...register('return_to_plant_date', { required: 'Return date is required' })}
                      />
                      <input
                        type="time"
                        className={fieldClass}
                        {...register('return_to_plant_time', { required: 'Return time is required' })}
                      />
                    </div>
                    {(errors.return_to_plant_date || errors.return_to_plant_time) && (
                      <p className="mt-1 text-xs text-red-600">
                        {errors.return_to_plant_date?.message || errors.return_to_plant_time?.message}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">
                      Remarks
                    </label>
                    <textarea className={`${fieldClass} h-28 resize-none`} {...register('remarks')} />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={saveDraft}
                      disabled={submitting}
                      className="rounded-md border border-[#003F72] px-5 py-3 text-sm font-semibold text-[#003F72] hover:bg-[#003F72]/10 disabled:border-gray-300 disabled:text-gray-400"
                    >
                      Save as Draft
                    </button>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="rounded-md bg-[#003F72] px-5 py-3 text-sm font-semibold text-white hover:bg-[#002B4E] disabled:bg-gray-400"
                    >
                      {submitting ? 'Submitting...' : 'Submit'}
                    </button>
                  </div>
                </form>
              </aside>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DispatchSummaryView;
