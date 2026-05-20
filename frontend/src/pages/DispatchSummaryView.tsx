import React, { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { productionAPI, requisitionAPI, userAPI } from '../api';
import PastRequisitionsModalButton from '../components/PastRequisitionsModalButton';
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
  remarks: string;
}

interface DispatchOrder {
  supply_id: string;
  dispatches: ProductionDispatch[];
  requisition: ConcreteRequisition;
}

const fieldClass =
  'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-[#003F72] focus:ring-2 focus:ring-[#003F72]/15';

const tableHeaderClass = 'px-4 py-3 text-left text-xs font-bold uppercase text-[#003F72]';
const numericTableHeaderClass = 'px-4 py-3 text-right text-xs font-bold uppercase text-[#003F72]';

const today = () => new Date().toISOString().slice(0, 10);

const combineDateTime = (date: string, time: string) => new Date(`${date}T${time}`).toISOString();

const formatDateTime = (value?: string) => (value ? new Date(value).toLocaleString() : '-');

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
  const [allDispatches, setAllDispatches] = useState<ProductionDispatch[]>([]);
  const [history, setHistory] = useState<ConcreteRequisition[]>([]);
  const [pastRequisitions, setPastRequisitions] = useState<ConcreteRequisition[]>([]);
  const [filters, setFilters] = useState<RequisitionFilterState>(defaultRequisitionFilters);
  const [selectedOrder, setSelectedOrder] = useState<DispatchOrder | null>(null);
  const [selectedDispatchId, setSelectedDispatchId] = useState<string | null>(null);
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
      setAllDispatches(dispatches);
      const pendingDispatches = dispatches.filter((dispatch) =>
        !dispatch.return_to_plant_time &&
        (!dispatch.receipt_at_site_time || !dispatch.release_from_site_time)
      );
      const groupedOrders = Array.from(
        pendingDispatches.reduce((groups, dispatch) => {
          const requisition = requisitionsBySupplyId.get(dispatch.supply_id);
          if (!requisition) return groups;
          const existing = groups.get(dispatch.supply_id);
          if (existing) {
            existing.dispatches.push(dispatch);
          } else {
            groups.set(dispatch.supply_id, {
              supply_id: dispatch.supply_id,
              requisition,
              dispatches: [dispatch],
            });
          }
          return groups;
        }, new Map<string, DispatchOrder>()).values()
      ).map((order) => ({
        ...order,
        dispatches: order.dispatches.sort(
          (a, b) => new Date(a.dispatch_time).getTime() - new Date(b.dispatch_time).getTime()
        ),
      }));
      setOrders(groupedOrders);
      const acknowledgedSupplyIds = new Set(
        dispatches
          .filter((dispatch) =>
            dispatch.receipt_at_site_time &&
            dispatch.release_from_site_time &&
            !dispatch.return_to_plant_time
          )
          .map((dispatch) => dispatch.supply_id)
      );
      setHistory(
        requisitions.filter((req) =>
          [RequisitionStatus.DISPATCHED, RequisitionStatus.RETURNING].includes(req.status) &&
          acknowledgedSupplyIds.has(req.supply_id)
        )
      );
      setPastRequisitions(requisitions.filter((req) => req.status === RequisitionStatus.RECONCILED));
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

  const resetAcknowledgementForm = (dispatch: ProductionDispatch) => {
    const draft = readDrafts()[dispatch.dispatch_id];
    reset({
      receipt_at_site_date: draft?.receipt_at_site_date || (
        dispatch.receipt_at_site_time ? new Date(dispatch.receipt_at_site_time).toISOString().slice(0, 10) : today()
      ),
      receipt_at_site_time: draft?.receipt_at_site_time || (
        dispatch.receipt_at_site_time ? new Date(dispatch.receipt_at_site_time).toTimeString().slice(0, 5) : ''
      ),
      release_from_site_date: draft?.release_from_site_date || (
        dispatch.release_from_site_time ? new Date(dispatch.release_from_site_time).toISOString().slice(0, 10) : today()
      ),
      release_from_site_time: draft?.release_from_site_time || (
        dispatch.release_from_site_time ? new Date(dispatch.release_from_site_time).toTimeString().slice(0, 5) : ''
      ),
      remarks: draft?.remarks || dispatch.remarks || '',
    });
  };

  const openReconcile = (order: DispatchOrder) => {
    const firstDispatch = order.dispatches[0];
    if (!firstDispatch) return;
    setSelectedOrder(order);
    setSelectedDispatchId(firstDispatch.dispatch_id);
    setMessage(null);
    resetAcknowledgementForm(firstDispatch);
  };

  const selectDispatch = (dispatch: ProductionDispatch) => {
    setSelectedDispatchId(dispatch.dispatch_id);
    resetAcknowledgementForm(dispatch);
  };

  const selectedDispatch = useMemo(() => {
    if (!selectedOrder) return null;
    const orderDispatches = allDispatches.filter((dispatch) => dispatch.supply_id === selectedOrder.supply_id);
    return orderDispatches.find((dispatch) => dispatch.dispatch_id === selectedDispatchId)
      || selectedOrder.dispatches[0]
      || null;
  }, [allDispatches, selectedDispatchId, selectedOrder]);

  const saveDraft = () => {
    if (!selectedDispatch) return;
    const drafts = readDrafts();
    drafts[selectedDispatch.dispatch_id] = getValues();
    writeDrafts(drafts);
    setMessage({ type: 'success', text: 'Draft saved.' });
    setSelectedOrder(null);
    setSelectedDispatchId(null);
  };

  const onSubmit = async (data: ReconciliationFormData) => {
    if (!selectedDispatch) return;
    if (selectedDispatchAcknowledged) {
      setMessage({ type: 'error', text: 'This vehicle has already been acknowledged.' });
      return;
    }

    setSubmitting(true);
    setMessage(null);

    try {
      await productionAPI.acknowledgeDispatch(selectedDispatch.dispatch_id, {
        receipt_at_site_time: combineDateTime(data.receipt_at_site_date, data.receipt_at_site_time),
        release_from_site_time: combineDateTime(data.release_from_site_date, data.release_from_site_time),
        remarks: data.remarks || undefined,
      });
      const drafts = readDrafts();
      delete drafts[selectedDispatch.dispatch_id];
      writeDrafts(drafts);
      setMessage({ type: 'success', text: 'Dispatch acknowledged.' });
      setSelectedOrder(null);
      setSelectedDispatchId(null);
      await fetchData();
    } catch (error: any) {
      console.error('Reconciliation error:', error);
      setMessage({ type: 'error', text: getErrorMessage(error, 'Failed to reconcile dispatch') });
    } finally {
      setSubmitting(false);
    }
  };

  const selectedDetails = useMemo(() => {
    if (!selectedOrder || !selectedDispatch) return [];
    const { requisition } = selectedOrder;
    const dispatch = selectedDispatch;
    return [
      ['Date', requisition.requisition_date || new Date(requisition.req_date).toLocaleDateString()],
      ['Supply ID', dispatch.supply_id],
      ['Location', requisition.location],
      ['In-Charge', userNames[requisition.in_charge_id] || requisition.in_charge_id],
      ['Engineer', requisition.contact_person],
      ['Structure Name', requisition.structure_name],
      ['Structure ID', requisition.structure_id],
      ['Grade', requisition.grade],
      ['Quantity', requisition.requested_qty],
      ['Time', requisition.pour_time],
      ['Placement by', requisition.placement_by],
      ['Planning Remarks', requisition.planning_remarks],
      ['Batching Plant ID', dispatch.batching_plant_id],
      ['Vehicle Number', dispatch.tm_number],
      ['Quantity Dispatched', dispatch.actual_dispatched_qty],
      ['Dispatch time', new Date(dispatch.dispatch_time).toLocaleString()],
      ['Receipt Location', dispatch.receipt_location],
    ] as Array<[string, unknown]>;
  }, [selectedDispatch, selectedOrder, userNames]);

  const selectedVehicleDispatches = useMemo(() => {
    if (!selectedOrder) return [];
    return allDispatches
      .filter((dispatch) => dispatch.supply_id === selectedOrder.supply_id)
      .sort((a, b) => new Date(a.dispatch_time).getTime() - new Date(b.dispatch_time).getTime());
  }, [allDispatches, selectedOrder]);

  const selectedDispatchSummary = useMemo(() => {
    const requestedQty = selectedOrder?.requisition.requested_qty || 0;
    const dispatchedQty = selectedVehicleDispatches.reduce(
      (total, dispatch) => total + dispatch.actual_dispatched_qty,
      0
    );
    return {
      requestedQty,
      dispatchedQty,
      remainingQty: Math.max(0, requestedQty - dispatchedQty),
    };
  }, [selectedOrder?.requisition.requested_qty, selectedVehicleDispatches]);

  const selectedDispatchAcknowledged = Boolean(
    selectedDispatch?.receipt_at_site_time && selectedDispatch.release_from_site_time
  );

  const filteredOrders = useMemo(() => {
    const requisitions = orders.map((order) => order.requisition);
    const allowedSupplyIds = new Set(filterRequisitions(requisitions, filters).map((req) => req.supply_id));
    return orders.filter((order) => allowedSupplyIds.has(order.requisition.supply_id));
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
          <h1 className="text-[2.15rem] font-bold leading-tight text-gray-900">Dispatch Summary</h1>
          <p className="text-sm text-gray-600">Acknowledge site receipt for each dispatched TM vehicle</p>
        </div>
        <RequisitionFilters
          filters={filters}
          onChange={setFilters}
          resultCount={filteredOrders.length + filteredHistory.length}
          totalCount={orders.length + history.length}
          className="xl:w-fit"
        />
      </div>

      {message && (
        <div className={`alert ${message.type === 'success' ? 'alert-success' : 'alert-danger'}`}>
          {message.text}
        </div>
      )}

      <div className="overflow-hidden rounded-lg bg-white shadow-md transition-shadow duration-200 ease-out hover:shadow-lg">
        <div className="bg-[#003F72] px-5 py-4 text-white">
          <h2 className="text-xl font-semibold">Dispatched Orders ({filteredOrders.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1060px]">
            <thead className="bg-gray-100">
              <tr>
                <th className={tableHeaderClass}>Supply ID</th>
                <th className={tableHeaderClass}>Date</th>
                <th className={tableHeaderClass}>Location</th>
                <th className={tableHeaderClass}>Vehicles</th>
                <th className={tableHeaderClass}>Plants</th>
                <th className={numericTableHeaderClass}>Qty Dispatched</th>
                <th className={tableHeaderClass}>Pending Ack.</th>
                <th className={tableHeaderClass}>Destination</th>
                <th className={tableHeaderClass}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((order) => (
                <tr key={order.supply_id} className="border-t border-gray-100 transition-colors duration-150 ease-out hover:bg-blue-50/45">
                  <td className="px-4 py-3 font-mono text-sm">{order.supply_id}</td>
                  <td className="px-4 py-3 text-sm">{formatOrderDate(order.requisition)}</td>
                  <td className="px-4 py-3 text-sm">{order.requisition.location}</td>
                  <td className="px-4 py-3 text-sm">
                    {order.dispatches.map((dispatch) => dispatch.tm_number).join(', ')}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {Array.from(new Set(order.dispatches.map((dispatch) => dispatch.batching_plant_id || '-'))).join(', ')}
                  </td>
                  <td className="px-4 py-3 text-right text-sm">
                    {order.dispatches.reduce((total, dispatch) => total + dispatch.actual_dispatched_qty, 0).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-sm">{order.dispatches.length}</td>
                  <td className="px-4 py-3 text-sm">
                    {Array.from(new Set(order.dispatches.map((dispatch) => dispatch.receipt_location || '-'))).join(', ')}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => openReconcile(order)}
                      className="rounded bg-[#003F72] px-3 py-1 text-sm font-semibold text-white shadow-sm transition-all duration-200 ease-out hover:bg-[#002B4E] hover:shadow"
                    >
                      Open
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

      <PastRequisitionsModalButton requisitions={pastRequisitions} />

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
                  {selectedOrder.supply_id}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedOrder(null);
                  setSelectedDispatchId(null);
                }}
                className="rounded-md bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-700"
              >
                Close
              </button>
            </div>

            <div className="grid gap-6 p-6 xl:grid-cols-[340px_1fr]">
              <aside className="h-fit rounded-lg border border-gray-200 bg-gray-50 p-4">
                <h3 className="mb-4 text-sm font-bold uppercase tracking-wide text-[#003F72]">
                  Vehicle Summary
                </h3>

                <dl className="grid grid-cols-1 gap-3">
                  <div className="rounded-md bg-white px-3 py-2 shadow-sm">
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Total Qty</dt>
                    <dd className="mt-1 text-lg font-bold text-gray-900">
                      {selectedDispatchSummary.requestedQty.toFixed(2)} cum
                    </dd>
                  </div>
                  <div className="rounded-md bg-white px-3 py-2 shadow-sm">
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Qty Dispatched</dt>
                    <dd className="mt-1 text-lg font-bold text-[#003F72]">
                      {selectedDispatchSummary.dispatchedQty.toFixed(2)} cum
                    </dd>
                  </div>
                  <div className="rounded-md bg-white px-3 py-2 shadow-sm">
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Remaining Qty</dt>
                    <dd className="mt-1 text-lg font-bold text-gray-900">
                      {selectedDispatchSummary.remainingQty.toFixed(2)} cum
                    </dd>
                  </div>
                </dl>

                <div className="mt-5">
                  <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-gray-600">
                    Vehicles ({selectedVehicleDispatches.length})
                  </h4>
                  <div className="max-h-[42vh] space-y-3 overflow-y-auto pr-1">
                    {selectedVehicleDispatches.map((dispatch) => {
                      const isActive = dispatch.dispatch_id === selectedDispatch?.dispatch_id;
                      return (
                        <button
                          type="button"
                          onClick={() => selectDispatch(dispatch)}
                          key={dispatch.dispatch_id}
                          className={`w-full rounded-md border px-3 py-2 text-left shadow-sm transition-colors duration-150 ease-out ${
                            isActive ? 'border-[#003F72] bg-blue-50' : 'border-gray-200 bg-white hover:bg-blue-50/45'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold text-gray-900" title={dispatch.tm_number}>
                                {dispatch.tm_number}
                              </p>
                              <p className="text-xs text-gray-500">{dispatch.batching_plant_id || '-'}</p>
                            </div>
                            <span className="shrink-0 text-sm font-semibold text-[#003F72]">
                              {dispatch.actual_dispatched_qty.toFixed(2)}
                            </span>
                          </div>
                          <p className="mt-2 text-xs text-gray-600">
                            {dispatch.receipt_at_site_time ? 'Acknowledged' : 'Pending acknowledgement'}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </aside>

              <div className="min-w-0 space-y-6">
                <section className="h-fit space-y-4">
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
                </section>

                <section className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <h3 className="mb-4 text-sm font-bold uppercase tracking-wide text-[#003F72]">
                    Site Acknowledgement
                  </h3>

                  {selectedDispatchAcknowledged ? (
                    <div className="space-y-4">
                      <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm font-medium text-[#003F72]">
                        This vehicle has already been acknowledged. Details are view-only.
                      </div>

                      <dl className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                        {([
                          ['Receipt at Site', formatDateTime(selectedDispatch?.receipt_at_site_time)],
                          ['Release from Site', formatDateTime(selectedDispatch?.release_from_site_time)],
                          ['Remarks', selectedDispatch?.remarks],
                        ] as Array<[string, unknown]>).map(([label, value]) => (
                          <div key={label} className="min-w-0 rounded-md border border-gray-200 bg-white px-3 py-2">
                            <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</dt>
                            <dd className="mt-1 truncate text-sm font-medium text-gray-900" title={display(value)}>
                              {display(value)}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  ) : (
                    <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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

                      <div className="lg:col-span-2">
                        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">
                          Remarks
                        </label>
                        <textarea className={`${fieldClass} h-24 resize-none`} {...register('remarks')} />
                      </div>

                      <div className="grid grid-cols-2 gap-3 lg:col-span-2">
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
                  )}
                </section>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DispatchSummaryView;
