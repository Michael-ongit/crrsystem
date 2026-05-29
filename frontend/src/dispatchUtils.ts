import { ProductionDispatch } from './types';

const EPSILON = 0.0001;

export const getAllocatedQty = (dispatch: ProductionDispatch): number => {
  if (typeof dispatch.allocated_qty === 'number') return dispatch.allocated_qty;
  if (dispatch.receipt_allocations?.length) {
    return dispatch.receipt_allocations.reduce((total, allocation) => total + allocation.deposited_qty, 0);
  }
  if (dispatch.receipt_at_site_time && dispatch.release_from_site_time) {
    return dispatch.actual_dispatched_qty;
  }
  return 0;
};

export const getRemainingQty = (dispatch: ProductionDispatch): number =>
  Math.max(0, dispatch.actual_dispatched_qty - getAllocatedQty(dispatch) - (dispatch.returned_wastage_qty || 0));

export const getPendingSecondaryQty = (dispatch: ProductionDispatch): number =>
  Math.max(0, dispatch.pending_secondary_qty || 0);

export const getReturnedWastageQty = (dispatch: ProductionDispatch): number =>
  Math.max(0, dispatch.returned_wastage_qty || 0);

export const getUnresolvedRemainingQty = (dispatch: ProductionDispatch): number =>
  Math.max(0, getRemainingQty(dispatch) - getPendingSecondaryQty(dispatch));

export const isDispatchFullyAllocated = (dispatch: ProductionDispatch): boolean =>
  getRemainingQty(dispatch) <= EPSILON;

export const getVehicleRemainingQty = (dispatch: ProductionDispatch): number =>
  Math.max(0, dispatch.actual_dispatched_qty - getAllocatedQty(dispatch));

export const formatAllocationDestinations = (dispatch: ProductionDispatch): string => {
  const allocations = dispatch.receipt_allocations || [];
  const parts: string[] = [];

  if (allocations.length === 0 && dispatch.receipt_location) {
    parts.push(dispatch.receipt_location);
  }

  parts.push(
    ...allocations.map((allocation) =>
      `${allocation.deposited_qty.toFixed(2)} cum - ${allocation.receipt_location} / ${allocation.receipt_structure_name} / ${allocation.receipt_structure_id}`
    )
  );

  const returnedQty = dispatch.returned_wastage_qty || 0;
  if (returnedQty > EPSILON) {
    parts.push(`${returnedQty.toFixed(2)} cum - Back to Plant`);
  }

  const pendingSecondaryQty = dispatch.pending_secondary_qty || 0;
  if (pendingSecondaryQty > EPSILON) {
    parts.push(
      `${pendingSecondaryQty.toFixed(2)} cum - Pending secondary receipt: ${dispatch.pending_secondary_receipt_location || '-'} / ${dispatch.pending_secondary_receipt_structure_name || '-'} / ${dispatch.pending_secondary_receipt_structure_id || '-'}`
    );
  }

  const remainingQty = getRemainingQty(dispatch);
  if (remainingQty > EPSILON && pendingSecondaryQty <= EPSILON) {
    parts.push(`${remainingQty.toFixed(2)} cum - Remaining in vehicle`);
  }

  return parts.length ? parts.join('; ') : '-';
};
