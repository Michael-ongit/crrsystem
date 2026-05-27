import React, { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { productionAPI, requisitionAPI, userAPI } from '../api';
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
import { getAllocatedQty, getRemainingQty, getVehicleRemainingQty, isDispatchFullyAllocated } from '../dispatchUtils';
import {
  combineISTDateTimeForApi,
  formatDateTimeIST,
  parseApiDateTime,
  toDateInputIST,
  toTimeInputIST,
} from '../timeUtils';
import { ConcreteRequisition, ProductionDispatch, RequisitionStatus } from '../types';

interface ReconciliationFormData {
  details_match: boolean;
  deposited_qty?: number;
  remaining_disposition: '' | 'Secondary Location' | 'Back to Plant';
  receipt_location: string;
  receipt_structure_name: string;
  receipt_structure_id: string;
  secondary_receipt_location: string;
  secondary_receipt_structure_name: string;
  secondary_receipt_structure_id: string;
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

const today = () => toDateInputIST();

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
    watch,
    formState: { errors },
    reset,
  } = useForm<ReconciliationFormData>();

  const draftStorageKey = 'dispatchReconciliationDrafts';
  const detailsMatch = watch('details_match');
  const depositedQty = watch('deposited_qty');
  const remainingDisposition = watch('remaining_disposition');

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
        !isDispatchFullyAllocated(dispatch)
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
          (a, b) =>
            (parseApiDateTime(a.dispatch_time)?.getTime() || 0) -
            (parseApiDateTime(b.dispatch_time)?.getTime() || 0)
        ),
      }));
      setOrders(groupedOrders);
      const acknowledgedSupplyIds = new Set(
        dispatches
          .filter((dispatch) =>
            isDispatchFullyAllocated(dispatch) &&
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

  const resetAcknowledgementForm = (dispatch: ProductionDispatch, order: DispatchOrder | null = selectedOrder) => {
    const draft = readDrafts()[dispatch.dispatch_id];
    const requisition = order?.requisition;
    reset({
      details_match: draft?.details_match ?? true,
      deposited_qty: draft?.deposited_qty ?? getRemainingQty(dispatch),
      remaining_disposition: draft?.remaining_disposition || '',
      receipt_location: draft?.receipt_location || dispatch.receipt_location || requisition?.location || '',
      receipt_structure_name: draft?.receipt_structure_name || requisition?.structure_name || '',
      receipt_structure_id: draft?.receipt_structure_id || requisition?.structure_id || '',
      secondary_receipt_location: draft?.secondary_receipt_location || '',
      secondary_receipt_structure_name: draft?.secondary_receipt_structure_name || '',
      secondary_receipt_structure_id: draft?.secondary_receipt_structure_id || '',
      receipt_at_site_date: draft?.receipt_at_site_date || (
        dispatch.receipt_at_site_time ? toDateInputIST(dispatch.receipt_at_site_time) : today()
      ),
      receipt_at_site_time: draft?.receipt_at_site_time || (
        dispatch.receipt_at_site_time ? toTimeInputIST(dispatch.receipt_at_site_time) : ''
      ),
      release_from_site_date: draft?.release_from_site_date || (
        dispatch.release_from_site_time ? toDateInputIST(dispatch.release_from_site_time) : today()
      ),
      release_from_site_time: draft?.release_from_site_time || (
        dispatch.release_from_site_time ? toTimeInputIST(dispatch.release_from_site_time) : ''
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
    resetAcknowledgementForm(firstDispatch, order);
  };

  const selectDispatch = (dispatch: ProductionDispatch) => {
    if (selectedDispatch && !selectedDispatchAcknowledged) {
      const drafts = readDrafts();
      drafts[selectedDispatch.dispatch_id] = getValues();
      writeDrafts(drafts);
    }
    setSelectedDispatchId(dispatch.dispatch_id);
    resetAcknowledgementForm(dispatch, selectedOrder);
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
        details_match: data.details_match,
        receipt_at_site_time: combineISTDateTimeForApi(data.receipt_at_site_date, data.receipt_at_site_time),
        release_from_site_time: combineISTDateTimeForApi(data.release_from_site_date, data.release_from_site_time),
        deposited_qty: data.details_match ? undefined : data.deposited_qty,
        receipt_location: data.details_match ? undefined : data.receipt_location,
        receipt_structure_name: data.details_match ? undefined : data.receipt_structure_name,
        receipt_structure_id: data.details_match ? undefined : data.receipt_structure_id,
        remaining_disposition: data.details_match ? undefined : data.remaining_disposition || undefined,
        secondary_receipt_location: data.remaining_disposition === 'Secondary Location'
          ? data.secondary_receipt_location
          : undefined,
        secondary_receipt_structure_name: data.remaining_disposition === 'Secondary Location'
          ? data.secondary_receipt_structure_name
          : undefined,
        secondary_receipt_structure_id: data.remaining_disposition === 'Secondary Location'
          ? data.secondary_receipt_structure_id
          : undefined,
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
      ['Date', formatOrderDate(requisition)],
      ['Supply ID', dispatch.supply_id],
      ['Location', requisition.location],
      ['In-Charge', requisition.selected_in_charge || requisition.in_charge_name || userNames[requisition.in_charge_id] || requisition.in_charge_id],
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
      ['Quantity Deposited', getAllocatedQty(dispatch)],
      ['Remaining in Vehicle', getVehicleRemainingQty(dispatch)],
      ['Dispatch time', formatDateTimeIST(dispatch.dispatch_time)],
      ['Receipt Location', dispatch.receipt_location],
    ] as Array<[string, unknown]>;
  }, [selectedDispatch, selectedOrder, userNames]);

  const selectedVehicleDispatches = useMemo(() => {
    if (!selectedOrder) return [];
    return allDispatches
      .filter((dispatch) => dispatch.supply_id === selectedOrder.supply_id)
      .sort(
        (a, b) =>
          (parseApiDateTime(a.dispatch_time)?.getTime() || 0) -
          (parseApiDateTime(b.dispatch_time)?.getTime() || 0)
      );
  }, [allDispatches, selectedOrder]);

  const selectedDispatchSummary = useMemo(() => {
    const dispatches = selectedVehicleDispatches;
    const dispatchedQty = dispatches.reduce((total, dispatch) => total + dispatch.actual_dispatched_qty, 0);
    const arrivedQty = dispatches.reduce((total, dispatch) => total + getAllocatedQty(dispatch), 0);
    return {
      dispatchedQty,
      arrivedQty,
      remainingQty: dispatches.reduce((total, dispatch) => total + getVehicleRemainingQty(dispatch), 0),
    };
  }, [selectedVehicleDispatches]);

  const selectedDispatchAcknowledged = Boolean(selectedDispatch && isDispatchFullyAllocated(selectedDispatch));
  const selectedVehicleRemaining = selectedDispatch ? getRemainingQty(selectedDispatch) : 0;
  const remainingAfterDeposit = !detailsMatch
    ? Math.max(0, selectedVehicleRemaining - Number(depositedQty || 0))
    : 0;
  const needsRemainingRoute = remainingAfterDeposit > 0.0001;

  useEffect(() => {
    if (!selectedDispatch || selectedDispatchAcknowledged) return undefined;

    const subscription = watch((value) => {
      const drafts = readDrafts();
      drafts[selectedDispatch.dispatch_id] = value as ReconciliationFormData;
      writeDrafts(drafts);
    });

    return () => subscription.unsubscribe();
  }, [selectedDispatch?.dispatch_id, selectedDispatchAcknowledged, watch]);

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

      <CollapsibleTableSection title={`Dispatched Orders (${filteredOrders.length})`}>
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
      </CollapsibleTableSection>

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
            <RequisitionFullDetails requisition={viewingOrder} />
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
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Qty Dispatched</dt>
                    <dd className="mt-1 text-lg font-bold text-gray-900">
                      {selectedDispatchSummary.dispatchedQty.toFixed(2)} cum
                    </dd>
                  </div>
                  <div className="rounded-md bg-white px-3 py-2 shadow-sm">
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Qty Arrived</dt>
                    <dd className="mt-1 text-lg font-bold text-[#003F72]">
                      {selectedDispatchSummary.arrivedQty.toFixed(2)} cum
                    </dd>
                  </div>
                  <div className="rounded-md bg-white px-3 py-2 shadow-sm">
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Remaining in Vehicles</dt>
                    <dd className="mt-1 text-lg font-bold text-amber-700">
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
                            {isDispatchFullyAllocated(dispatch)
                              ? 'Fully acknowledged'
                              : `Remaining ${getRemainingQty(dispatch).toFixed(2)} cum`}
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
                          ['Receipt at Site', formatDateTimeIST(selectedDispatch?.receipt_at_site_time)],
                          ['Release from Site', formatDateTimeIST(selectedDispatch?.release_from_site_time)],
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
                      <label className="flex items-center gap-3 rounded-md border border-gray-200 bg-white px-3 py-2 lg:col-span-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-gray-300 text-[#003F72] focus:ring-[#003F72]"
                          {...register('details_match')}
                        />
                        <span className="text-sm font-semibold text-gray-700">
                          All receipt details match the requisition
                        </span>
                      </label>

                      {!detailsMatch && (
                        <>
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

                          <div>
                            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">
                              Receipt Structure Name
                            </label>
                            <input
                              className={fieldClass}
                              {...register('receipt_structure_name', { required: 'Receipt structure name is required' })}
                            />
                            {errors.receipt_structure_name && (
                              <p className="mt-1 text-xs text-red-600">{errors.receipt_structure_name.message}</p>
                            )}
                          </div>

                          <div>
                            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">
                              Receipt Structure ID
                            </label>
                            <input
                              className={fieldClass}
                              {...register('receipt_structure_id', { required: 'Receipt structure ID is required' })}
                            />
                            {errors.receipt_structure_id && (
                              <p className="mt-1 text-xs text-red-600">{errors.receipt_structure_id.message}</p>
                            )}
                          </div>

                          <div>
                            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">
                              Quantity Deposited Here (cum)
                            </label>
                            <input
                              type="number"
                              step="0.01"
                              className={fieldClass}
                              {...register('deposited_qty', {
                                required: 'Deposited quantity is required',
                                min: { value: 0.01, message: 'Must be greater than 0' },
                                max: {
                                  value: selectedDispatch ? getRemainingQty(selectedDispatch) : 0,
                                  message: 'Cannot exceed remaining vehicle quantity',
                                },
                                valueAsNumber: true,
                              })}
                            />
                            {errors.deposited_qty && (
                              <p className="mt-1 text-xs text-red-600">{errors.deposited_qty.message}</p>
                            )}
                          </div>

                          {needsRemainingRoute && (
                            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 lg:col-span-2">
                              <p className="mb-3 text-sm font-semibold text-amber-900">
                                Remaining concrete to account: {remainingAfterDeposit.toFixed(2)} cum
                              </p>
                              <div className="grid gap-3 sm:grid-cols-2">
                                <label className="flex items-center gap-3 rounded-md border border-amber-200 bg-white px-3 py-2">
                                  <input
                                    type="radio"
                                    value="Secondary Location"
                                    className="h-4 w-4 border-gray-300 text-[#003F72] focus:ring-[#003F72]"
                                    {...register('remaining_disposition', {
                                      required: needsRemainingRoute ? 'Choose where the remaining concrete went' : false,
                                    })}
                                  />
                                  <span className="text-sm font-semibold text-gray-700">Secondary Location</span>
                                </label>
                                <label className="flex items-center gap-3 rounded-md border border-amber-200 bg-white px-3 py-2">
                                  <input
                                    type="radio"
                                    value="Back to Plant"
                                    className="h-4 w-4 border-gray-300 text-[#003F72] focus:ring-[#003F72]"
                                    {...register('remaining_disposition', {
                                      required: needsRemainingRoute ? 'Choose where the remaining concrete went' : false,
                                    })}
                                  />
                                  <span className="text-sm font-semibold text-gray-700">Back to Plant</span>
                                </label>
                              </div>
                              {errors.remaining_disposition && (
                                <p className="mt-2 text-xs text-red-600">{errors.remaining_disposition.message}</p>
                              )}
                            </div>
                          )}

                          {needsRemainingRoute && remainingDisposition === 'Secondary Location' && (
                            <>
                              <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">
                                  Secondary Receipt Location
                                </label>
                                <input
                                  className={fieldClass}
                                  {...register('secondary_receipt_location', {
                                    required: 'Secondary receipt location is required',
                                  })}
                                />
                                {errors.secondary_receipt_location && (
                                  <p className="mt-1 text-xs text-red-600">{errors.secondary_receipt_location.message}</p>
                                )}
                              </div>

                              <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">
                                  Secondary Structure Name
                                </label>
                                <input
                                  className={fieldClass}
                                  {...register('secondary_receipt_structure_name', {
                                    required: 'Secondary structure name is required',
                                  })}
                                />
                                {errors.secondary_receipt_structure_name && (
                                  <p className="mt-1 text-xs text-red-600">{errors.secondary_receipt_structure_name.message}</p>
                                )}
                              </div>

                              <div>
                                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">
                                  Secondary Structure ID
                                </label>
                                <input
                                  className={fieldClass}
                                  {...register('secondary_receipt_structure_id', {
                                    required: 'Secondary structure ID is required',
                                  })}
                                />
                                {errors.secondary_receipt_structure_id && (
                                  <p className="mt-1 text-xs text-red-600">{errors.secondary_receipt_structure_id.message}</p>
                                )}
                              </div>
                            </>
                          )}
                        </>
                      )}

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
