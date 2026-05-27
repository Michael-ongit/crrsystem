// pages/ProductionView.tsx - Production team dispatch logging
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
import { getRemainingQty, isDispatchFullyAllocated } from '../dispatchUtils';
import {
  combineISTDateTimeForApi,
  dateTimeLocalInputToApi,
  formatDateTimeIST,
  parseApiDateTime,
  toDateInputIST,
  toDateTimeLocalInputIST,
  toTimeInputIST,
} from '../timeUtils';
import { ConcreteRequisition, ProductionDispatch, RequisitionStatus } from '../types';

interface DispatchFormData {
  batching_plant_id: string;
  tm_number: string;
  actual_dispatched_qty?: number;
  dispatch_time: string;
  receipt_location: string;
}

interface StagedDispatchVehicle {
  vehicle_id: string;
  batching_plant_id: string;
  tm_number: string;
  actual_dispatched_qty: number;
  dispatch_time: string;
  receipt_location: string;
}

interface ReturnToPlantFormData {
  return_to_plant_date: string;
  return_to_plant_time: string;
  remarks: string;
}

interface ReturnToPlantOrder {
  supply_id: string;
  dispatches: ProductionDispatch[];
  requisition: ConcreteRequisition;
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

const tableHeaderClass = 'px-4 py-3 text-left text-xs font-bold uppercase text-[#003F72]';
const numericTableHeaderClass = 'px-4 py-3 text-right text-xs font-bold uppercase text-[#003F72]';
const tableActionButtonClass =
  'rounded bg-[#003F72] px-3 py-1 text-sm font-semibold text-white shadow-sm transition-all duration-200 ease-out hover:bg-[#002B4E] hover:shadow';

const today = () => toDateInputIST();

const display = (value: unknown) => {
  if (value === undefined || value === null || value === '') return '-';
  if (typeof value === 'number') return Number.isFinite(value) ? value.toFixed(2) : '-';
  return String(value);
};

const ProductionView: React.FC = () => {
  const [requisitions, setRequisitions] = useState<ConcreteRequisition[]>([]);
  const [history, setHistory] = useState<ConcreteRequisition[]>([]);
  const [returnOrders, setReturnOrders] = useState<ReturnToPlantOrder[]>([]);
  const [pastRequisitions, setPastRequisitions] = useState<ConcreteRequisition[]>([]);
  const [dispatchTotals, setDispatchTotals] = useState<Record<string, number>>({});
  const [filters, setFilters] = useState<RequisitionFilterState>(defaultRequisitionFilters);
  const [selectedRequisition, setSelectedRequisition] = useState<ConcreteRequisition | null>(null);
  const [dispatchVehicles, setDispatchVehicles] = useState<StagedDispatchVehicle[]>([]);
  const [selectedDispatchVehicleId, setSelectedDispatchVehicleId] = useState<string | null>(null);
  const [selectedReturnOrder, setSelectedReturnOrder] = useState<ReturnToPlantOrder | null>(null);
  const [selectedReturnDispatchId, setSelectedReturnDispatchId] = useState<string | null>(null);
  const [viewingOrder, setViewingOrder] = useState<ConcreteRequisition | null>(null);
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [dispatching, setDispatching] = useState(false);
  const [finalizingDispatch, setFinalizingDispatch] = useState(false);
  const [returning, setReturning] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [dispatchMessage, setDispatchMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const dispatchDraftStorageKey = 'productionDispatchDrafts';
  const returnDraftStorageKey = 'productionReturnDrafts';

  const {
    register,
    handleSubmit,
    watch,
    getValues,
    formState: { errors },
    reset,
  } = useForm<DispatchFormData>({
    defaultValues: {
      batching_plant_id: '',
      dispatch_time: toDateTimeLocalInputIST(),
      receipt_location: '',
    },
  });

  const {
    register: registerReturn,
    handleSubmit: handleReturnSubmit,
    watch: watchReturn,
    formState: { errors: returnErrors },
    reset: resetReturn,
  } = useForm<ReturnToPlantFormData>({
    defaultValues: {
      return_to_plant_date: today(),
      return_to_plant_time: '',
      remarks: '',
    },
  });

  const readDispatchDrafts = (): Record<string, { form: DispatchFormData; vehicles: StagedDispatchVehicle[] }> => {
    const rawDrafts = localStorage.getItem(dispatchDraftStorageKey);
    return rawDrafts ? JSON.parse(rawDrafts) : {};
  };

  const writeDispatchDrafts = (
    drafts: Record<string, { form: DispatchFormData; vehicles: StagedDispatchVehicle[] }>
  ) => {
    localStorage.setItem(dispatchDraftStorageKey, JSON.stringify(drafts));
  };

  const readReturnDrafts = (): Record<string, ReturnToPlantFormData> => {
    const rawDrafts = localStorage.getItem(returnDraftStorageKey);
    return rawDrafts ? JSON.parse(rawDrafts) : {};
  };

  const writeReturnDrafts = (drafts: Record<string, ReturnToPlantFormData>) => {
    localStorage.setItem(returnDraftStorageKey, JSON.stringify(drafts));
  };

  const fetchValidatedRequisitions = async () => {
    try {
      setLoading(true);
      const [validatedReqs, allReqs, users, dispatches] = await Promise.all([
        requisitionAPI.getRequisitions(RequisitionStatus.VALIDATED),
        requisitionAPI.getRequisitions(),
        userAPI.getUsers(),
        productionAPI.getAllDispatches(0, 200),
      ]);
      const requisitionsBySupplyId = new Map(allReqs.map((req) => [req.supply_id, req]));
      const totals = dispatches.reduce<Record<string, number>>((acc, dispatch) => {
        acc[dispatch.supply_id] = (acc[dispatch.supply_id] || 0) + dispatch.actual_dispatched_qty;
        return acc;
      }, {});
      const returnReadyDispatches = dispatches.filter((dispatch) =>
        isDispatchFullyAllocated(dispatch) &&
        !dispatch.return_to_plant_time
      );
      const returnReadyOrders = Array.from(
        returnReadyDispatches.reduce((groups, dispatch) => {
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
        }, new Map<string, ReturnToPlantOrder>()).values()
      ).map((order) => ({
        ...order,
        dispatches: order.dispatches.sort(
          (a, b) =>
            (parseApiDateTime(a.dispatch_time)?.getTime() || 0) -
            (parseApiDateTime(b.dispatch_time)?.getTime() || 0)
        ),
      }));
      const returnReadySupplyIds = new Set(returnReadyOrders.map((order) => order.supply_id));
      setRequisitions(validatedReqs);
      setHistory(
        allReqs.filter((req) =>
          [RequisitionStatus.DISPATCHED, RequisitionStatus.RETURNING].includes(req.status) &&
          !returnReadySupplyIds.has(req.supply_id)
        )
      );
      setReturnOrders(returnReadyOrders);
      setPastRequisitions(allReqs.filter((req) => req.status === RequisitionStatus.RECONCILED));
      setDispatchTotals(totals);
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
  const filteredReturnOrders = useMemo(() => {
    const returnRequisitions = returnOrders.map((order) => order.requisition);
    const allowedSupplyIds = new Set(filterRequisitions(returnRequisitions, filters).map((req) => req.supply_id));
    return returnOrders.filter((order) => allowedSupplyIds.has(order.requisition.supply_id));
  }, [filters, returnOrders]);

  const dispatchSummary = useMemo(() => {
    const totalQty = selectedRequisition?.requested_qty || 0;
    const existingDispatchedQty = selectedRequisition
      ? dispatchTotals[selectedRequisition.supply_id] || 0
      : 0;
    const stagedDispatchedQty = dispatchVehicles.reduce(
      (total, vehicle) => total + vehicle.actual_dispatched_qty,
      0
    );
    const dispatchedQty = existingDispatchedQty + stagedDispatchedQty;
    return {
      totalQty,
      existingDispatchedQty,
      stagedDispatchedQty,
      dispatchedQty,
      remainingQty: Math.max(0, totalQty - dispatchedQty),
    };
  }, [dispatchTotals, dispatchVehicles, selectedRequisition]);

  const selectedReturnDispatch = useMemo(() => {
    if (!selectedReturnOrder) return null;
    return selectedReturnOrder.dispatches.find((dispatch) => dispatch.dispatch_id === selectedReturnDispatchId)
      || selectedReturnOrder.dispatches[0]
      || null;
  }, [selectedReturnDispatchId, selectedReturnOrder]);

  const selectedReturnDetails = useMemo(() => {
    if (!selectedReturnOrder || !selectedReturnDispatch) return [];
    const { requisition } = selectedReturnOrder;
    const dispatch = selectedReturnDispatch;
    return [
      ['Date', formatOrderDate(requisition)],
      ['Supply ID', dispatch.supply_id],
      ['Location', requisition.location],
      ['In-Charge', userNames[requisition.in_charge_id] || requisition.in_charge_id],
      ['Engineer', requisition.contact_person],
      ['Structure Name', requisition.structure_name],
      ['Structure ID', requisition.structure_id],
      ['Grade', requisition.grade],
      ['Quantity', requisition.requested_qty],
      ['Batching Plant ID', dispatch.batching_plant_id],
      ['Vehicle Number', dispatch.tm_number],
      ['Quantity Dispatched', dispatch.actual_dispatched_qty],
      ['Remaining in Vehicle', getRemainingQty(dispatch)],
      ['Dispatch Time', formatDateTimeIST(dispatch.dispatch_time)],
      ['Receipt at Site', formatDateTimeIST(dispatch.receipt_at_site_time)],
      ['Release from Site', formatDateTimeIST(dispatch.release_from_site_time)],
      ['Destination Location', dispatch.receipt_location],
    ] as Array<[string, unknown]>;
  }, [selectedReturnDispatch, selectedReturnOrder, userNames]);

  useEffect(() => {
    if (!selectedReturnDispatch) return undefined;

    const subscription = watchReturn((value) => {
      const drafts = readReturnDrafts();
      drafts[selectedReturnDispatch.dispatch_id] = value as ReturnToPlantFormData;
      writeReturnDrafts(drafts);
    });

    return () => subscription.unsubscribe();
  }, [selectedReturnDispatch, watchReturn]);

  const openDispatch = (req: ConcreteRequisition) => {
    const savedDraft = readDispatchDrafts()[req.supply_id];
    setSelectedRequisition(req);
    setDispatchVehicles(savedDraft?.vehicles || []);
    setSelectedDispatchVehicleId(null);
    setMessage(null);
    setDispatchMessage(null);
    reset(savedDraft?.form || {
      batching_plant_id: '',
      tm_number: '',
      actual_dispatched_qty: Math.max(0, req.requested_qty - (dispatchTotals[req.supply_id] || 0)) || undefined,
      dispatch_time: toDateTimeLocalInputIST(),
      receipt_location: req.location,
    });
  };

  useEffect(() => {
    if (!selectedRequisition) return;
    const drafts = readDispatchDrafts();
    drafts[selectedRequisition.supply_id] = {
      form: getValues(),
      vehicles: dispatchVehicles,
    };
    writeDispatchDrafts(drafts);
  }, [dispatchVehicles, selectedRequisition]);

  useEffect(() => {
    if (!selectedRequisition) return undefined;

    const subscription = watch((value) => {
      const drafts = readDispatchDrafts();
      drafts[selectedRequisition.supply_id] = {
        form: value as DispatchFormData,
        vehicles: dispatchVehicles,
      };
      writeDispatchDrafts(drafts);
    });

    return () => subscription.unsubscribe();
  }, [dispatchVehicles, selectedRequisition, watch]);

  const closeDispatch = async () => {
    setSelectedRequisition(null);
    setDispatchVehicles([]);
    setSelectedDispatchVehicleId(null);
    setDispatchMessage(null);
    await fetchValidatedRequisitions();
  };

  const clearVehicleForm = (remainingQty = dispatchSummary.remainingQty) => {
    setSelectedDispatchVehicleId(null);
    reset({
      batching_plant_id: '',
      tm_number: '',
      actual_dispatched_qty: remainingQty || undefined,
      dispatch_time: toDateTimeLocalInputIST(),
      receipt_location: selectedRequisition?.location || '',
    });
  };

  const selectDispatchVehicle = (vehicle: StagedDispatchVehicle) => {
    setSelectedDispatchVehicleId(vehicle.vehicle_id);
    reset({
      batching_plant_id: vehicle.batching_plant_id,
      tm_number: vehicle.tm_number,
      actual_dispatched_qty: vehicle.actual_dispatched_qty,
      dispatch_time: vehicle.dispatch_time,
      receipt_location: vehicle.receipt_location,
    });
  };

  const onSubmit = async (data: DispatchFormData) => {
    if (!selectedRequisition || !data.actual_dispatched_qty) return;

    setDispatching(true);
    setDispatchMessage(null);

    try {
      const nextVehicle: StagedDispatchVehicle = {
        vehicle_id: selectedDispatchVehicleId || crypto.randomUUID(),
        batching_plant_id: data.batching_plant_id,
        tm_number: data.tm_number,
        actual_dispatched_qty: data.actual_dispatched_qty,
        dispatch_time: data.dispatch_time,
        receipt_location: data.receipt_location,
      };

      const nextVehicles = selectedDispatchVehicleId
        ? dispatchVehicles.map((vehicle) =>
            vehicle.vehicle_id === selectedDispatchVehicleId ? nextVehicle : vehicle
          )
        : [...dispatchVehicles, nextVehicle];
      const nextDispatchedQty = nextVehicles.reduce(
        (total, vehicle) => total + vehicle.actual_dispatched_qty,
        0
      );
      const existingDispatchedQty = dispatchTotals[selectedRequisition.supply_id] || 0;
      const totalAfterSave = existingDispatchedQty + nextDispatchedQty;

      if (totalAfterSave > selectedRequisition.requested_qty) {
        setDispatchMessage({
          type: 'error',
          text: `Cannot dispatch extra concrete. Requested: ${selectedRequisition.requested_qty.toFixed(2)} cum, already dispatched: ${existingDispatchedQty.toFixed(2)} cum, staged total: ${nextDispatchedQty.toFixed(2)} cum.`,
        });
        return;
      }

      const nextRemainingQty = Math.max(0, selectedRequisition.requested_qty - totalAfterSave);

      setDispatchVehicles(nextVehicles);
      setDispatchMessage({
        type: 'success',
        text: selectedDispatchVehicleId
          ? `Vehicle ${data.tm_number} updated. Remaining quantity: ${nextRemainingQty.toFixed(2)} cum.`
          : `Vehicle ${data.tm_number} added. Remaining quantity: ${nextRemainingQty.toFixed(2)} cum.`,
      });

      setSelectedDispatchVehicleId(null);
      reset({
        batching_plant_id: data.batching_plant_id,
        tm_number: '',
        actual_dispatched_qty: nextRemainingQty || undefined,
        dispatch_time: toDateTimeLocalInputIST(),
        receipt_location: data.receipt_location,
      });
    } catch (error: any) {
      console.error('Dispatch error:', error);
      setDispatchMessage({
        type: 'error',
        text: getErrorMessage(error, 'Failed to log dispatch'),
      });
    } finally {
      setDispatching(false);
    }
  };

  const openReturnToPlant = (order: ReturnToPlantOrder) => {
    const firstDispatch = order.dispatches[0];
    if (!firstDispatch) return;
    const savedDraft = readReturnDrafts()[firstDispatch.dispatch_id];
    setSelectedReturnOrder(order);
    setSelectedReturnDispatchId(firstDispatch.dispatch_id);
    setMessage(null);
    resetReturn(savedDraft || {
      return_to_plant_date: today(),
      return_to_plant_time: '',
      remarks: firstDispatch.remarks || '',
    });
  };

  const selectReturnDispatch = (dispatch: ProductionDispatch) => {
    const savedDraft = readReturnDrafts()[dispatch.dispatch_id];
    setSelectedReturnDispatchId(dispatch.dispatch_id);
    resetReturn(savedDraft || {
      return_to_plant_date: dispatch.return_to_plant_time
        ? toDateInputIST(dispatch.return_to_plant_time)
        : today(),
      return_to_plant_time: dispatch.return_to_plant_time
        ? toTimeInputIST(dispatch.return_to_plant_time)
        : '',
      remarks: dispatch.remarks || '',
    });
  };

  const onReturnSubmit = async (data: ReturnToPlantFormData) => {
    if (!selectedReturnDispatch) return;

    setReturning(true);
    setMessage(null);

    try {
      await productionAPI.updateReturnToPlant(selectedReturnDispatch.dispatch_id, {
        return_to_plant_time: combineISTDateTimeForApi(data.return_to_plant_date, data.return_to_plant_time),
        remarks: data.remarks || undefined,
      });

      const refreshedDispatches = await productionAPI.getDispatchesBySupply(selectedReturnDispatch.supply_id);
      const remainingReturns = refreshedDispatches.filter((dispatch) => !dispatch.return_to_plant_time).length;
      setMessage({
        type: 'success',
        text: remainingReturns === 0
          ? 'Return to plant recorded. Requisition moved to past requisitions.'
          : `Return to plant recorded. ${remainingReturns} vehicle${remainingReturns === 1 ? '' : 's'} still pending return.`,
      });
      const drafts = readReturnDrafts();
      delete drafts[selectedReturnDispatch.dispatch_id];
      writeReturnDrafts(drafts);
      setSelectedReturnOrder(null);
      setSelectedReturnDispatchId(null);
      await fetchValidatedRequisitions();
    } catch (error: any) {
      console.error('Return-to-plant error:', error);
      setMessage({
        type: 'error',
        text: getErrorMessage(error, 'Failed to record return to plant'),
      });
    } finally {
      setReturning(false);
    }
  };

  const finalizeDispatchVehicles = async () => {
    if (!selectedRequisition || dispatchVehicles.length === 0) {
      setDispatchMessage({ type: 'error', text: 'Add at least one vehicle before submitting.' });
      return;
    }

    const existingDispatchedQty = dispatchTotals[selectedRequisition.supply_id] || 0;
    const stagedDispatchedQty = dispatchVehicles.reduce(
      (total, vehicle) => total + vehicle.actual_dispatched_qty,
      0
    );
    if (existingDispatchedQty + stagedDispatchedQty > selectedRequisition.requested_qty) {
      setDispatchMessage({
        type: 'error',
        text: `Cannot submit extra concrete. Requested: ${selectedRequisition.requested_qty.toFixed(2)} cum, already dispatched: ${existingDispatchedQty.toFixed(2)} cum, staged total: ${stagedDispatchedQty.toFixed(2)} cum.`,
      });
      return;
    }

    setFinalizingDispatch(true);
    setDispatchMessage(null);

    try {
      for (const vehicle of dispatchVehicles) {
        await productionAPI.createDispatch({
          supply_id: selectedRequisition.supply_id,
          batching_plant_id: vehicle.batching_plant_id,
          tm_number: vehicle.tm_number,
          actual_dispatched_qty: vehicle.actual_dispatched_qty,
          dispatch_time: dateTimeLocalInputToApi(vehicle.dispatch_time),
          receipt_location: vehicle.receipt_location,
        });
      }

      setMessage({
        type: 'success',
        text: `${dispatchVehicles.length} vehicle${dispatchVehicles.length === 1 ? '' : 's'} submitted for dispatch.`,
      });
      setSelectedRequisition(null);
      setDispatchVehicles([]);
      setSelectedDispatchVehicleId(null);
      setDispatchMessage(null);
      const drafts = readDispatchDrafts();
      delete drafts[selectedRequisition.supply_id];
      writeDispatchDrafts(drafts);
      await fetchValidatedRequisitions();
    } catch (error: any) {
      console.error('Dispatch finalization error:', error);
      setDispatchMessage({
        type: 'error',
        text: getErrorMessage(error, 'Failed to submit dispatch vehicles'),
      });
    } finally {
      setFinalizingDispatch(false);
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
          <h1 className="text-[2.15rem] font-bold leading-tight text-gray-900">Production Dispatch</h1>
          <p className="text-sm text-gray-600">Log concrete dispatch and transit mixer details</p>
        </div>
        <RequisitionFilters
          filters={filters}
          onChange={setFilters}
          resultCount={filteredRequisitions.length + filteredReturnOrders.length + filteredHistory.length}
          totalCount={requisitions.length + returnOrders.length + history.length}
          className="xl:w-fit"
        />
      </div>

      {message && (
        <div className={`alert ${message.type === 'success' ? 'alert-success' : 'alert-danger'}`}>
          {message.text}
        </div>
      )}

      <CollapsibleTableSection title={`Approved Orders (${filteredRequisitions.length})`}>
        <table className="w-full min-w-[800px]">
          <thead className="bg-gray-100">
            <tr>
              <th className={tableHeaderClass}>Supply ID</th>
              <th className={tableHeaderClass}>Date</th>
              <th className={tableHeaderClass}>Location</th>
              <th className={tableHeaderClass}>Structure</th>
              <th className={tableHeaderClass}>Grade</th>
              <th className={numericTableHeaderClass}>Requested Qty</th>
              <th className={numericTableHeaderClass}>Dispatched Qty</th>
              <th className={tableHeaderClass}>Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredRequisitions.map((req) => (
              <tr key={req.supply_id} className="border-t border-gray-100 transition-colors duration-150 ease-out hover:bg-blue-50/45">
                <td className="px-4 py-3 font-mono text-sm">{req.supply_id}</td>
                <td className="px-4 py-3 text-sm">{formatOrderDate(req)}</td>
                <td className="px-4 py-3 text-sm">{req.location}</td>
                <td className="px-4 py-3 text-sm">{req.structure_name}</td>
                <td className="px-4 py-3 text-sm">{req.grade}</td>
                <td className="px-4 py-3 text-right text-sm">{req.requested_qty.toFixed(2)}</td>
                <td className="px-4 py-3 text-right text-sm">{(dispatchTotals[req.supply_id] || 0).toFixed(2)}</td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => openDispatch(req)}
                    className={tableActionButtonClass}
                  >
                    Dispatch
                  </button>
                </td>
              </tr>
            ))}

            {filteredRequisitions.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-500">
                  No approved requisitions ready for dispatch
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </CollapsibleTableSection>

      <CollapsibleTableSection title={`Return to Plant (${filteredReturnOrders.length})`}>
        <table className="w-full min-w-[1060px]">
          <thead className="bg-gray-100">
            <tr>
              <th className={tableHeaderClass}>Supply ID</th>
              <th className={tableHeaderClass}>Date</th>
              <th className={tableHeaderClass}>Location</th>
              <th className={tableHeaderClass}>Vehicles</th>
              <th className={tableHeaderClass}>Plants</th>
              <th className={numericTableHeaderClass}>Qty Dispatched</th>
              <th className={tableHeaderClass}>Pending Return</th>
              <th className={tableHeaderClass}>Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredReturnOrders.map((order) => (
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
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => openReturnToPlant(order)}
                    className={tableActionButtonClass}
                  >
                    Open
                  </button>
                </td>
              </tr>
            ))}

            {filteredReturnOrders.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-500">
                  No acknowledged dispatches waiting for return to plant
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
                onClick={closeDispatch}
                className="rounded-md bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-700"
              >
                Close
              </button>
            </div>

            {dispatchMessage && (
              <div className={`mx-6 mt-4 alert ${dispatchMessage.type === 'success' ? 'alert-success' : 'alert-danger'}`}>
                {dispatchMessage.text}
              </div>
            )}

            <div className="grid gap-6 p-6 xl:grid-cols-[340px_1fr]">
              <aside className="h-fit rounded-lg border border-gray-200 bg-gray-50 p-4">
                <h3 className="mb-4 text-sm font-bold uppercase tracking-wide text-[#003F72]">
                  Dispatch Summary
                </h3>

                <dl className="grid grid-cols-1 gap-3">
                  <div className="rounded-md bg-white px-3 py-2 shadow-sm">
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Total Qty</dt>
                    <dd className="mt-1 text-lg font-bold text-gray-900">{dispatchSummary.totalQty.toFixed(2)} cum</dd>
                  </div>
                  <div className="rounded-md bg-white px-3 py-2 shadow-sm">
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Qty Dispatched</dt>
                    <dd className="mt-1 text-lg font-bold text-[#003F72]">{dispatchSummary.dispatchedQty.toFixed(2)} cum</dd>
                  </div>
                  <div className="rounded-md bg-white px-3 py-2 shadow-sm">
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Remaining Qty</dt>
                    <dd className="mt-1 text-lg font-bold text-gray-900">{dispatchSummary.remainingQty.toFixed(2)} cum</dd>
                  </div>
                </dl>

                <div className="mt-5">
                  <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-gray-600">
                    Vehicles Added ({dispatchVehicles.length})
                  </h4>
                  <div className="max-h-[42vh] space-y-3 overflow-y-auto pr-1">
                    {dispatchVehicles.map((vehicle) => (
                      <button
                        key={vehicle.vehicle_id}
                        type="button"
                        onClick={() => selectDispatchVehicle(vehicle)}
                        className={`w-full rounded-md border px-3 py-2 text-left shadow-sm transition-colors duration-150 ease-out ${
                          selectedDispatchVehicleId === vehicle.vehicle_id
                            ? 'border-[#003F72] bg-blue-50'
                            : 'border-gray-200 bg-white hover:bg-blue-50/45'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-gray-900" title={vehicle.tm_number}>
                              {vehicle.tm_number}
                            </p>
                            <p className="text-xs text-gray-500">{vehicle.batching_plant_id || '-'}</p>
                          </div>
                          <span className="shrink-0 text-sm font-semibold text-[#003F72]">
                            {vehicle.actual_dispatched_qty.toFixed(2)}
                          </span>
                        </div>
                        <div className="mt-2 text-xs text-gray-600">
                          <p>{formatDateTimeIST(vehicle.dispatch_time)}</p>
                          <p className="truncate" title={vehicle.receipt_location || '-'}>
                            {vehicle.receipt_location || '-'}
                          </p>
                        </div>
                      </button>
                    ))}

                    {dispatchVehicles.length === 0 && (
                      <div className="rounded-md border border-dashed border-gray-300 bg-white px-3 py-6 text-center text-sm text-gray-500">
                        No vehicles added yet.
                      </div>
                    )}
                  </div>
                </div>
              </aside>

              <div className="min-w-0 space-y-6">
                <section className="space-y-4">
                  <h3 className="text-sm font-bold uppercase tracking-wide text-[#003F72]">
                    Order Details
                  </h3>
                  <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {([
                      ['Date', formatOrderDate(selectedRequisition)],
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
                </section>

                <section className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <h3 className="mb-4 text-sm font-bold uppercase tracking-wide text-[#003F72]">
                    Add Dispatch Details
                  </h3>

                  <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
                        Vehicle Number
                      </label>
                      <input
                        className={fieldClass}
                        {...register('tm_number', { required: 'Vehicle number is required' })}
                      />
                      {errors.tm_number && (
                        <p className="mt-1 text-xs text-red-600">{errors.tm_number.message}</p>
                      )}
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">
                        Quantity in Vehicle (cum)
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
                        Dispatch Time
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

                    <div className="lg:col-span-2">
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">
                        Destination Location
                      </label>
                      <input
                        className={fieldClass}
                        {...register('receipt_location', { required: 'Destination location is required' })}
                      />
                      {errors.receipt_location && (
                        <p className="mt-1 text-xs text-red-600">{errors.receipt_location.message}</p>
                      )}
                    </div>

                    <div className="flex justify-end lg:col-span-2">
                      {selectedDispatchVehicleId && (
                        <button
                          type="button"
                          onClick={() => clearVehicleForm()}
                          className="mr-3 rounded-md border border-[#003F72] px-5 py-3 text-sm font-semibold text-[#003F72] hover:bg-[#003F72]/10"
                        >
                          New Vehicle
                        </button>
                      )}
                      <button
                        type="submit"
                        disabled={dispatching}
                        className="rounded-md bg-[#003F72] px-5 py-3 text-sm font-semibold text-white hover:bg-[#002B4E] disabled:bg-gray-400"
                      >
                        {dispatching ? 'Saving...' : selectedDispatchVehicleId ? 'Update Vehicle' : 'Add Vehicle'}
                      </button>
                    </div>
                  </form>
                </section>

                <div className="flex justify-end border-t border-gray-200 pt-4">
                  <button
                    type="button"
                    onClick={finalizeDispatchVehicles}
                    disabled={finalizingDispatch || dispatchVehicles.length === 0}
                    className="rounded-md bg-green-700 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-green-800 disabled:bg-gray-400"
                  >
                    {finalizingDispatch ? 'Submitting...' : 'Submit'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedReturnOrder && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[92vh] w-full max-w-7xl overflow-y-auto rounded-lg bg-white shadow-xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Return to Plant</h2>
                <p className="font-mono text-sm font-semibold text-[#003F72]">
                  {selectedReturnOrder.supply_id}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedReturnOrder(null);
                  setSelectedReturnDispatchId(null);
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

                <div>
                  <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-gray-600">
                    Vehicles ({selectedReturnOrder.dispatches.length})
                  </h4>
                  <div className="max-h-[42vh] space-y-3 overflow-y-auto pr-1">
                    {selectedReturnOrder.dispatches.map((dispatch) => (
                      <button
                        key={dispatch.dispatch_id}
                        type="button"
                        onClick={() => selectReturnDispatch(dispatch)}
                        className={`w-full rounded-md border px-3 py-2 text-left shadow-sm transition-colors duration-150 ease-out ${
                          selectedReturnDispatch?.dispatch_id === dispatch.dispatch_id
                            ? 'border-[#003F72] bg-blue-50'
                            : 'border-gray-200 bg-white hover:bg-blue-50/45'
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
                          {dispatch.return_to_plant_time ? 'Returned' : 'Pending return'}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              </aside>

              <div className="min-w-0 space-y-6">
                <section className="h-fit space-y-4">
                  <h3 className="text-sm font-bold uppercase tracking-wide text-[#003F72]">
                    Dispatch Details
                  </h3>
                  <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {selectedReturnDetails.map(([label, value]) => (
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
                    Plant Return
                  </h3>

                  <form onSubmit={handleReturnSubmit(onReturnSubmit)} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">
                        Return to Plant
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="date"
                          className={fieldClass}
                          {...registerReturn('return_to_plant_date', { required: 'Return date is required' })}
                        />
                        <input
                          type="time"
                          className={fieldClass}
                          {...registerReturn('return_to_plant_time', { required: 'Return time is required' })}
                        />
                      </div>
                      {(returnErrors.return_to_plant_date || returnErrors.return_to_plant_time) && (
                        <p className="mt-1 text-xs text-red-600">
                          {returnErrors.return_to_plant_date?.message || returnErrors.return_to_plant_time?.message}
                        </p>
                      )}
                    </div>

                    <div className="lg:col-span-2">
                      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-600">
                        Remarks
                      </label>
                      <textarea className={`${fieldClass} h-24 resize-none`} {...registerReturn('remarks')} />
                    </div>

                    <div className="flex justify-end lg:col-span-2">
                      <button
                        type="submit"
                        disabled={returning}
                        className="rounded-md bg-[#003F72] px-5 py-3 text-sm font-semibold text-white hover:bg-[#002B4E] disabled:bg-gray-400"
                      >
                        {returning ? 'Submitting...' : 'Submit'}
                      </button>
                    </div>
                  </form>
                </section>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductionView;
