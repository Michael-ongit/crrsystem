import React, { useEffect, useMemo, useState } from 'react';
import { productionAPI } from '../api';
import { ConcreteRequisition, ProductionDispatch } from '../types';
import PastRequisitionsTable from './PastRequisitionsTable';
import RequisitionDetails from './RequisitionDetails';
import RequisitionFilters, {
  defaultRequisitionFilters,
  filterRequisitions,
  RequisitionFilterState,
} from './RequisitionFilters';

interface PastRequisitionsModalButtonProps {
  requisitions: ConcreteRequisition[];
  hideWorkflowFields?: boolean;
  hidePlanningFields?: boolean;
}

const display = (value: unknown) => {
  if (value === undefined || value === null || value === '') return '-';
  if (typeof value === 'number') return Number.isFinite(value) ? value.toFixed(2) : '-';
  return String(value);
};

const formatDateTime = (value?: string) => (value ? new Date(value).toLocaleString() : '-');

const PastRequisitionsModalButton: React.FC<PastRequisitionsModalButtonProps> = ({
  requisitions,
  hideWorkflowFields = false,
  hidePlanningFields = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [filters, setFilters] = useState<RequisitionFilterState>(defaultRequisitionFilters);
  const [viewingOrder, setViewingOrder] = useState<ConcreteRequisition | null>(null);
  const [dispatchesBySupplyId, setDispatchesBySupplyId] = useState<Record<string, ProductionDispatch[]>>({});
  const [loadingDispatches, setLoadingDispatches] = useState(false);

  const filteredRequisitions = useMemo(
    () => filterRequisitions(requisitions, filters),
    [filters, requisitions]
  );

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setLoadingDispatches(true);
    productionAPI.getAllDispatches(0, 1000)
      .then((dispatches) => {
        if (cancelled) return;
        const grouped = dispatches.reduce<Record<string, ProductionDispatch[]>>((groups, dispatch) => {
          if (!groups[dispatch.supply_id]) groups[dispatch.supply_id] = [];
          groups[dispatch.supply_id].push(dispatch);
          return groups;
        }, {});
        Object.values(grouped).forEach((items) => {
          items.sort((a, b) => new Date(a.dispatch_time).getTime() - new Date(b.dispatch_time).getTime());
        });
        setDispatchesBySupplyId(grouped);
      })
      .catch((error) => {
        console.error('Failed to load past requisition dispatch details:', error);
        if (!cancelled) setDispatchesBySupplyId({});
      })
      .finally(() => {
        if (!cancelled) setLoadingDispatches(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const viewingDispatches = viewingOrder ? dispatchesBySupplyId[viewingOrder.supply_id] || [] : [];

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-30 rounded-md bg-[#003F72] px-5 py-3 text-sm font-semibold text-white shadow-lg transition-all duration-200 ease-out hover:bg-[#002B4E] hover:shadow-xl"
      >
        Past Requisitions ({requisitions.length})
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Past Requisitions</h2>
                <p className="text-sm text-gray-600">Fully reconciled requisitions</p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-md bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-700"
              >
                Close
              </button>
            </div>

            <div className="space-y-4 overflow-y-auto p-6">
              <RequisitionFilters
                filters={filters}
                onChange={setFilters}
                resultCount={filteredRequisitions.length}
                totalCount={requisitions.length}
              />
              <PastRequisitionsTable
                requisitions={filteredRequisitions}
                title="Past Requisitions"
                emptyText="No fully reconciled requisitions found."
                onView={setViewingOrder}
              />
            </div>
          </div>
        </div>
      )}

      {viewingOrder && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
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
            <RequisitionDetails
              requisition={viewingOrder}
              hideWorkflowFields={hideWorkflowFields}
              hidePlanningFields={hidePlanningFields}
            />

            <section className="mt-6 space-y-3">
              <h3 className="border-b border-gray-200 pb-1 text-xs font-bold uppercase tracking-wide text-[#003F72]">
                Lifecycle Details
              </h3>
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {([
                  ['Created At', formatDateTime(viewingOrder.created_at)],
                  ['Updated At', formatDateTime(viewingOrder.updated_at)],
                  ['Validation Timestamp', formatDateTime(viewingOrder.validation_timestamp)],
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

            <section className="mt-6 space-y-3">
              <div className="flex items-center justify-between gap-3 border-b border-gray-200 pb-1">
                <h3 className="text-xs font-bold uppercase tracking-wide text-[#003F72]">
                  Vehicle Timeline
                </h3>
                {loadingDispatches && <span className="text-xs font-medium text-gray-500">Loading vehicles...</span>}
              </div>

              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="w-full min-w-[1100px]">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-bold uppercase text-[#003F72]">Vehicle</th>
                      <th className="px-3 py-2 text-left text-xs font-bold uppercase text-[#003F72]">Batching Plant</th>
                      <th className="px-3 py-2 text-right text-xs font-bold uppercase text-[#003F72]">Qty</th>
                      <th className="px-3 py-2 text-left text-xs font-bold uppercase text-[#003F72]">Dispatch Time</th>
                      <th className="px-3 py-2 text-left text-xs font-bold uppercase text-[#003F72]">Destination</th>
                      <th className="px-3 py-2 text-left text-xs font-bold uppercase text-[#003F72]">Receipt at Site</th>
                      <th className="px-3 py-2 text-left text-xs font-bold uppercase text-[#003F72]">Release from Site</th>
                      <th className="px-3 py-2 text-left text-xs font-bold uppercase text-[#003F72]">Return to Plant</th>
                      <th className="px-3 py-2 text-left text-xs font-bold uppercase text-[#003F72]">Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewingDispatches.map((dispatch) => (
                      <tr key={dispatch.dispatch_id} className="border-t border-gray-100">
                        <td className="px-3 py-2 text-sm font-semibold text-gray-900">{display(dispatch.tm_number)}</td>
                        <td className="px-3 py-2 text-sm text-gray-700">{display(dispatch.batching_plant_id)}</td>
                        <td className="px-3 py-2 text-right text-sm text-gray-700">
                          {display(dispatch.actual_dispatched_qty)}
                        </td>
                        <td className="px-3 py-2 text-sm text-gray-700">{formatDateTime(dispatch.dispatch_time)}</td>
                        <td className="px-3 py-2 text-sm text-gray-700">{display(dispatch.receipt_location)}</td>
                        <td className="px-3 py-2 text-sm text-gray-700">
                          {formatDateTime(dispatch.receipt_at_site_time)}
                        </td>
                        <td className="px-3 py-2 text-sm text-gray-700">
                          {formatDateTime(dispatch.release_from_site_time)}
                        </td>
                        <td className="px-3 py-2 text-sm text-gray-700">
                          {formatDateTime(dispatch.return_to_plant_time)}
                        </td>
                        <td className="px-3 py-2 text-sm text-gray-700">{display(dispatch.remarks)}</td>
                      </tr>
                    ))}

                    {!loadingDispatches && viewingDispatches.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-3 py-6 text-center text-sm text-gray-500">
                          No vehicle details found for this requisition.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>
      )}
    </>
  );
};

export default PastRequisitionsModalButton;
