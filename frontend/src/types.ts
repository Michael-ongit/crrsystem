// types.ts - TypeScript type definitions for MVDP System

export enum UserRole {
  EXECUTION = 'Execution',
  PLANNING = 'Planning',
  PRODUCTION = 'Production',
  ADMIN = 'Admin',
}

export enum RequisitionStatus {
  PENDING = 'Pending',
  VALIDATED = 'Validated',
  DISPATCHED = 'Dispatched',
  RETURNING = 'Returning',
  RECONCILED = 'Reconciled',
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  is_email_verified: boolean;
  created_at: string;
}

export interface RegisterResponse {
  message: string;
  email: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  expires_at: string;
  user: User;
}

export interface ConcreteRequisition {
  supply_id: string;
  req_date: string;
  rfi_no?: string;
  requisition_date?: string;
  location: string;
  in_charge_id: string;
  structure_type?: string;
  structure_name: string;
  structure_id: string;
  pile_lift_id?: string;
  grade: string;
  drawing_no?: string;
  drawing_length?: number;
  drawing_diameter?: number;
  theoretical_qty?: number;
  actual_length?: number;
  actual_diameter?: number;
  actual_qty?: number;
  qty_difference?: number;
  difference_reason?: string;
  requested_qty: number;
  pour_time?: string;
  placement_by?: string;
  contact_person?: string;
  contact_number?: string;
  status: RequisitionStatus;
  approval_status?: 'Approved' | 'Sent Back' | 'Pending' | 'Rejected';
  planning_remarks?: string;
  validation_timestamp?: string;
  sent_back_expires_at?: string;
  created_at: string;
  updated_at: string;
}

export interface ConcreteRequisitionCreate {
  rfi_no?: string;
  requisition_date?: string;
  location: string;
  in_charge_id: string;
  structure_type?: string;
  structure_name: string;
  structure_id: string;
  pile_lift_id?: string;
  grade: string;
  drawing_no?: string;
  drawing_length?: number;
  drawing_diameter?: number;
  theoretical_qty?: number;
  actual_length?: number;
  actual_diameter?: number;
  actual_qty?: number;
  qty_difference?: number;
  difference_reason?: string;
  requested_qty: number;
  pour_time?: string;
  placement_by?: string;
  contact_person?: string;
  contact_number?: string;
}

export interface SupplyIdPreview {
  supply_id: string;
  pattern: string;
}

export interface PlanningValidation {
  validation_id: string;
  supply_id: string;
  validated_by: string;
  planning_remarks?: string;
  validation_timestamp: string;
  is_approved: 'Approved' | 'Sent Back' | 'Pending' | 'Rejected';
}

export interface ProductionDispatch {
  dispatch_id: string;
  supply_id: string;
  batching_plant_id?: string;
  tm_number: string;
  actual_dispatched_qty: number;
  dispatch_time: string;
  receipt_location?: string;
  delivery_time?: string;
  receipt_at_site_time?: string;
  release_from_site_time?: string;
  return_to_plant_time?: string;
  remarks?: string;
  wastage_qty?: number;
  created_at: string;
  updated_at: string;
}

export interface WastageRecord {
  supply_id: string;
  requested_qty: number;
  actual_dispatched_qty: number;
  wastage_qty: number;
  wastage_percentage: number;
  exceeds_ace_limit: boolean;
  dispatch_date: string;
  tm_numbers: string[];
}

export interface TurnaroundTimeRecord {
  tm_number: string;
  dispatch_time: string;
  delivery_time?: string;
  turnaround_hours?: number;
  status: string;
}

export interface DashboardSummary {
  total_requisitions: number;
  pending_count: number;
  validated_count: number;
  dispatched_count: number;
  reconciled_count: number;
  average_wastage_percentage: number;
  violation_count: number;
  wastage_records: WastageRecord[];
  turnaround_records: TurnaroundTimeRecord[];
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  currentRole: UserRole;
  token: string | null;
}
