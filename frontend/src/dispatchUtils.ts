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

export const isDispatchFullyAllocated = (dispatch: ProductionDispatch): boolean =>
  getRemainingQty(dispatch) <= EPSILON;

export const getVehicleRemainingQty = (dispatch: ProductionDispatch): number =>
  Math.max(0, dispatch.actual_dispatched_qty - getAllocatedQty(dispatch));

export const formatAllocationDestinations = (dispatch: ProductionDispatch): string => {
  const allocations = dispatch.receipt_allocations || [];
  if (allocations.length === 0) return dispatch.receipt_location || '-';

  return allocations
    .map((allocation) =>
      `${allocation.deposited_qty.toFixed(2)} cum - ${allocation.receipt_location} / ${allocation.receipt_structure_name} / ${allocation.receipt_structure_id}`
    )
    .join('; ');
};
