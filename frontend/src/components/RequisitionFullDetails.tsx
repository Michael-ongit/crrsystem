import React, { useEffect, useMemo, useState } from 'react';
import { productionAPI } from '../api';
import { formatAllocationDestinations, getAllocatedQty, getRemainingQty } from '../dispatchUtils';
import { formatDateTimeIST, parseApiDateTime } from '../timeUtils';
import { ConcreteRequisition, ProductionDispatch } from '../types';
import CollapsibleTableSection from './CollapsibleTableSection';
import RequisitionDetails from './RequisitionDetails';

interface RequisitionFullDetailsProps {
  requisition: ConcreteRequisition;
  hideWorkflowFields?: boolean;
  hidePlanningFields?: boolean;
}

const display = (value: unknown) => {
  if (value === undefined || value === null || value === '') return '-';
  if (typeof value === 'number') return Number.isFinite(value) ? value.toFixed(2) : '-';
  return String(value);
};

const sortByDispatchTime = (items: ProductionDispatch[]) =>
  [...items].sort(
    (a, b) =>
      (parseApiDateTime(a.dispatch_time)?.getTime() || 0) -
      (parseApiDateTime(b.dispatch_time)?.getTime() || 0)
  );

const RequisitionFullDetails: React.FC<RequisitionFullDetailsProps> = ({
  requisition,
  hideWorkflowFields = false,
  hidePlanningFields = false,
}) => {
  const [dispatches, setDispatches] = useState<ProductionDispatch[]>([]);
  const [loadingDispatches, setLoadingDispatches] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadingDispatches(true);
    productionAPI.getDispatchesBySupply(requisition.supply_id)
      .then((items) => {
        if (!cancelled) setDispatches(sortByDispatchTime(items));
      })
      .catch((error) => {
        console.error('Failed to load requisition dispatch details:', error);
        if (!cancelled) setDispatches([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingDispatches(false);
      });

    return () => {
      cancelled = true;
    };
  }, [requisition.supply_id]);

  const lifecycleDetails = useMemo(
    () => [
      ['Created At', formatDateTimeIST(requisition.created_at)],
      ['Updated At', formatDateTimeIST(requisition.updated_at)],
      ['Validation Timestamp', formatDateTimeIST(requisition.validation_timestamp)],
    ] as Array<[string, unknown]>,
    [requisition.created_at, requisition.updated_at, requisition.validation_timestamp]
  );

  return (
    <div className="space-y-6">
      <RequisitionDetails
        requisition={requisition}
        hideWorkflowFields={hideWorkflowFields}
        hidePlanningFields={hidePlanningFields}
      />

      <section className="space-y-3">
        <h3 className="border-b border-gray-200 pb-1 text-xs font-bold uppercase tracking-wide text-[#003F72]">
          Lifecycle Details
        </h3>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {lifecycleDetails.map(([label, value]) => (
            <div key={label} className="min-w-0 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</dt>
              <dd className="mt-1 truncate text-sm font-medium text-gray-900" title={display(value)}>
                {display(value)}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <CollapsibleTableSection
        title="Vehicle Timeline"
        actions={loadingDispatches && <span className="text-xs font-medium text-white/80">Loading vehicles...</span>}
        className="shadow-none hover:shadow-none"
      >
        <table className="w-full min-w-[1100px]">
          <thead className="bg-gray-100">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-bold uppercase text-[#003F72]">Vehicle</th>
              <th className="px-3 py-2 text-left text-xs font-bold uppercase text-[#003F72]">Batching Plant</th>
              <th className="px-3 py-2 text-right text-xs font-bold uppercase text-[#003F72]">Qty</th>
              <th className="px-3 py-2 text-right text-xs font-bold uppercase text-[#003F72]">Deposited</th>
              <th className="px-3 py-2 text-right text-xs font-bold uppercase text-[#003F72]">Remaining</th>
              <th className="px-3 py-2 text-left text-xs font-bold uppercase text-[#003F72]">Dispatch Time</th>
              <th className="px-3 py-2 text-left text-xs font-bold uppercase text-[#003F72]">Deposits</th>
              <th className="px-3 py-2 text-left text-xs font-bold uppercase text-[#003F72]">Receipt at Site</th>
              <th className="px-3 py-2 text-left text-xs font-bold uppercase text-[#003F72]">Release from Site</th>
              <th className="px-3 py-2 text-left text-xs font-bold uppercase text-[#003F72]">Return to Plant</th>
              <th className="px-3 py-2 text-left text-xs font-bold uppercase text-[#003F72]">Remarks</th>
            </tr>
          </thead>
          <tbody>
            {dispatches.map((dispatch) => (
              <tr key={dispatch.dispatch_id} className="border-t border-gray-100">
                <td className="px-3 py-2 text-sm font-semibold text-gray-900">{display(dispatch.tm_number)}</td>
                <td className="px-3 py-2 text-sm text-gray-700">{display(dispatch.batching_plant_id)}</td>
                <td className="px-3 py-2 text-right text-sm text-gray-700">
                  {display(dispatch.actual_dispatched_qty)}
                </td>
                <td className="px-3 py-2 text-right text-sm text-gray-700">
                  {getAllocatedQty(dispatch).toFixed(2)}
                </td>
                <td className="px-3 py-2 text-right text-sm text-gray-700">
                  {getRemainingQty(dispatch).toFixed(2)}
                </td>
                <td className="px-3 py-2 text-sm text-gray-700">{formatDateTimeIST(dispatch.dispatch_time)}</td>
                <td className="px-3 py-2 text-sm text-gray-700">{formatAllocationDestinations(dispatch)}</td>
                <td className="px-3 py-2 text-sm text-gray-700">
                  {formatDateTimeIST(dispatch.receipt_at_site_time)}
                </td>
                <td className="px-3 py-2 text-sm text-gray-700">
                  {formatDateTimeIST(dispatch.release_from_site_time)}
                </td>
                <td className="px-3 py-2 text-sm text-gray-700">
                  {formatDateTimeIST(dispatch.return_to_plant_time)}
                </td>
                <td className="px-3 py-2 text-sm text-gray-700">{display(dispatch.remarks)}</td>
              </tr>
            ))}

            {!loadingDispatches && dispatches.length === 0 && (
              <tr>
                <td colSpan={11} className="px-3 py-6 text-center text-sm text-gray-500">
                  No vehicle details found for this requisition.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </CollapsibleTableSection>
    </div>
  );
};

export default RequisitionFullDetails;
