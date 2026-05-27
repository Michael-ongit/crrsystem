import React, { useMemo, useState } from 'react';
import { ConcreteRequisition } from '../types';
import PastRequisitionsTable from './PastRequisitionsTable';
import RequisitionFilters, {
  defaultRequisitionFilters,
  filterRequisitions,
  RequisitionFilterState,
} from './RequisitionFilters';
import RequisitionFullDetails from './RequisitionFullDetails';

interface PastRequisitionsModalButtonProps {
  requisitions: ConcreteRequisition[];
  hideWorkflowFields?: boolean;
  hidePlanningFields?: boolean;
}

const PastRequisitionsModalButton: React.FC<PastRequisitionsModalButtonProps> = ({
  requisitions,
  hideWorkflowFields = false,
  hidePlanningFields = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [filters, setFilters] = useState<RequisitionFilterState>(defaultRequisitionFilters);
  const [viewingOrder, setViewingOrder] = useState<ConcreteRequisition | null>(null);

  const filteredRequisitions = useMemo(
    () => filterRequisitions(requisitions, filters),
    [filters, requisitions]
  );

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
            <RequisitionFullDetails
              requisition={viewingOrder}
              hideWorkflowFields={hideWorkflowFields}
              hidePlanningFields={hidePlanningFields}
            />
          </div>
        </div>
      )}
    </>
  );
};

export default PastRequisitionsModalButton;
