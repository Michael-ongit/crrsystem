// pages/PlanningView.tsx - Planning team validation interface
import React, { useEffect, useMemo, useState } from 'react';
import { requisitionAPI } from '../api';
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
import RequisitionDetails from '../components/RequisitionDetails';
import StatusBadge from '../components/StatusBadge';
import { ConcreteRequisition, RequisitionStatus, User } from '../types';

interface PlanningViewProps {
  currentUser: User | null;
}

const getErrorMessage = (error: any, fallback: string) => {
  const detail = error.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail.map((item) => item?.msg || item?.message || String(item)).join(', ');
  }
  return fallback;
};

const tableActionButtonClass =
  'rounded bg-[#003F72] px-3 py-1 text-sm font-semibold text-white shadow-sm transition-all duration-200 ease-out hover:bg-[#002B4E] hover:shadow';
const tableHeaderClass = 'px-4 py-3 text-left text-xs font-bold uppercase text-[#003F72]';
const numericTableHeaderClass = 'px-4 py-3 text-right text-xs font-bold uppercase text-[#003F72]';

const PlanningView: React.FC<PlanningViewProps> = ({ currentUser }) => {
  const [requisitions, setRequisitions] = useState<ConcreteRequisition[]>([]);
  const [history, setHistory] = useState<ConcreteRequisition[]>([]);
  const [pastRequisitions, setPastRequisitions] = useState<ConcreteRequisition[]>([]);
  const [filters, setFilters] = useState<RequisitionFilterState>(defaultRequisitionFilters);
  const [selectedRequisition, setSelectedRequisition] = useState<ConcreteRequisition | null>(null);
  const [viewingOrder, setViewingOrder] = useState<ConcreteRequisition | null>(null);
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);
  const [remarks, setRemarks] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const planningDraftStorageKey = `planningDecisionDrafts:${currentUser?.id || 'anonymous'}`;

  const fetchRequisitions = async () => {
    try {
      setLoading(true);
      const [pendingReqs, allReqs] = await Promise.all([
        requisitionAPI.getRequisitions(RequisitionStatus.PENDING),
        requisitionAPI.getRequisitions(),
      ]);
      setRequisitions(pendingReqs.filter((req) => req.approval_status !== 'Sent Back'));
      setHistory(
        allReqs.filter((req) =>
          [RequisitionStatus.VALIDATED, RequisitionStatus.DISPATCHED, RequisitionStatus.RETURNING].includes(req.status)
        )
      );
      setPastRequisitions(allReqs.filter((req) => req.status === RequisitionStatus.RECONCILED));
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
    fetchRequisitions();
  }, []);

  const filteredRequisitions = useMemo(
    () => filterRequisitions(requisitions, filters),
    [filters, requisitions]
  );
  const filteredHistory = useMemo(() => filterRequisitions(history, filters), [filters, history]);

  const openReview = (req: ConcreteRequisition) => {
    setSelectedRequisition(req);
    const savedRemarks = localStorage.getItem(`${planningDraftStorageKey}:${req.supply_id}`);
    setRemarks(savedRemarks ?? req.planning_remarks ?? '');
    setMessage(null);
  };

  useEffect(() => {
    if (!selectedRequisition) return;
    localStorage.setItem(`${planningDraftStorageKey}:${selectedRequisition.supply_id}`, remarks);
  }, [planningDraftStorageKey, remarks, selectedRequisition]);

  const handleValidate = async (approvalStatus: 'Approved' | 'Sent Back' | 'Pending') => {
    if (!selectedRequisition || !currentUser?.id) return;

    setValidating(true);
    setMessage(null);

    try {
      await requisitionAPI.validateRequisition(selectedRequisition.supply_id, {
        validated_by: currentUser.id,
        planning_remarks: remarks || undefined,
        is_approved: approvalStatus,
      });

      setMessage({
        type: 'success',
        text: approvalStatus === 'Sent Back'
          ? 'Requisition sent back to execution for 12 hours.'
          : `Requisition marked ${approvalStatus.toLowerCase()}.`,
      });
      setSelectedRequisition(null);
      setRemarks('');
      localStorage.removeItem(`${planningDraftStorageKey}:${selectedRequisition.supply_id}`);
      await fetchRequisitions();
    } catch (error: any) {
      console.error('Validation error:', error);
      setMessage({
        type: 'error',
        text: getErrorMessage(error, 'Failed to validate requisition'),
      });
    } finally {
      setValidating(false);
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
          <h1 className="text-[2.15rem] font-bold leading-tight text-gray-900">Planning Validation</h1>
          <p className="text-sm text-gray-600">Review pending requisitions and record decisions</p>
        </div>
        <RequisitionFilters
          filters={filters}
          onChange={setFilters}
          resultCount={filteredRequisitions.length + filteredHistory.length}
          totalCount={requisitions.length + history.length}
          className="xl:w-fit"
        />
      </div>

      {message && (
        <div className={`alert ${message.type === 'success' ? 'alert-success' : 'alert-danger'}`}>
          {message.text}
        </div>
      )}

      <CollapsibleTableSection title={`Pending Requisitions (${filteredRequisitions.length})`}>
        <table className="w-full min-w-[860px]">
          <thead className="bg-gray-100">
            <tr>
              <th className={tableHeaderClass}>Supply ID</th>
              <th className={tableHeaderClass}>Date</th>
              <th className={tableHeaderClass}>Location</th>
              <th className={tableHeaderClass}>Structure</th>
              <th className={tableHeaderClass}>Grade</th>
              <th className={numericTableHeaderClass}>Qty</th>
              <th className={tableHeaderClass}>Status</th>
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
                <td className="px-4 py-3 text-sm">
                  <StatusBadge status={req.approval_status === 'Pending' ? 'Pending' : req.status} />
                </td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => openReview(req)}
                    className={tableActionButtonClass}
                  >
                    Review
                  </button>
                </td>
              </tr>
            ))}

            {filteredRequisitions.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-500">
                  No pending requisitions to validate
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
                <h2 className="text-xl font-bold text-gray-900">Review Requisition</h2>
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

            <div className="grid gap-6 p-6 xl:grid-cols-[1fr_360px]">
              <RequisitionDetails requisition={selectedRequisition} hideWorkflowFields />

              <aside className="h-fit rounded-lg border border-gray-200 bg-gray-50 p-4">
                <h3 className="mb-4 text-sm font-bold uppercase tracking-wide text-[#003F72]">
                  Planning Decision
                </h3>

                <label className="block text-xs font-semibold uppercase tracking-wide text-gray-600">
                  Remarks
                </label>
                <textarea
                  value={remarks}
                  onChange={(event) => setRemarks(event.target.value)}
                  className="mt-2 h-32 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#003F72] focus:ring-2 focus:ring-[#003F72]/15"
                />

                <div className="mt-5 grid grid-cols-1 gap-3">
                  <button
                    type="button"
                    onClick={() => handleValidate('Approved')}
                    disabled={validating}
                    className="rounded-md bg-green-600 px-5 py-3 text-sm font-semibold text-white hover:bg-green-700 disabled:bg-gray-400"
                  >
                    {validating ? 'Submitting...' : 'Approve'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleValidate('Sent Back')}
                    disabled={validating}
                    className="rounded-md bg-orange-600 px-5 py-3 text-sm font-semibold text-white hover:bg-orange-700 disabled:bg-gray-400"
                  >
                    Send Back
                  </button>
                  <button
                    type="button"
                    onClick={() => handleValidate('Pending')}
                    disabled={validating}
                    className="rounded-md bg-yellow-500 px-5 py-3 text-sm font-semibold text-gray-900 hover:bg-yellow-400 disabled:bg-gray-400"
                  >
                    Hold
                  </button>
                </div>
              </aside>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PlanningView;
