// api.ts - Axios API client configuration and endpoints
import axios, { AxiosInstance, AxiosError } from 'axios';
import {
  User,
  AuthResponse,
  ConcreteRequisition,
  ConcreteRequisitionCreate,
  RegisterResponse,
  SupplyIdPreview,
  ProductionDispatch,
  PlanningValidation,
  DashboardSummary,
  WastageRecord,
  TurnaroundTimeRecord,
  AdminSummary,
  DropdownOption,
  RegistrationInvite,
  RequisitionElementOption,
} from './types';

const defaultApiBaseURL = '/api'; // Default base URL for API requests, can be overridden by environment variable

// Initialize Axios instance
const apiClient: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || defaultApiBaseURL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const setAuthToken = (token: string | null) => {
  if (token) {
    localStorage.setItem('authToken', token);
  } else {
    localStorage.removeItem('authToken');
  }
};

// Request interceptor for adding auth tokens if needed
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('authToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      setAuthToken(null);
      window.dispatchEvent(new Event('auth:expired'));
    } else if (error.response?.status === 500) {
      console.error('Server error:', error.response.data);
    }
    return Promise.reject(error);
  }
);

// ============== AUTH ENDPOINTS ==============

export const authAPI = {
  register: (data: {
    name: string;
    email: string;
    password: string;
    role: string;
  }): Promise<RegisterResponse> =>
    apiClient.post('/auth/register', data).then((res) => res.data),

  login: (data: { email: string; password: string }): Promise<AuthResponse> =>
    apiClient.post('/auth/login', data).then((res) => res.data),

  me: (): Promise<User> => apiClient.get('/auth/me').then((res) => res.data),

  logout: (): Promise<{ message: string }> =>
    apiClient.post('/auth/logout').then((res) => res.data),
};

// ============== USER ENDPOINTS ==============

export const userAPI = {
  createUser: (userData: {
    name: string;
    email: string;
    password: string;
    role: string;
    assigned_locations?: string[];
  }): Promise<User> => apiClient.post('/users', userData).then((res) => res.data),

  getUsers: (): Promise<User[]> => apiClient.get('/users').then((res) => res.data),

  getUserById: (userId: string): Promise<User> =>
    apiClient.get(`/users/${userId}`).then((res) => res.data),
};

// ============== ADMIN ENDPOINTS ==============

export const adminAPI = {
  getSummary: (): Promise<AdminSummary> =>
    apiClient.get('/admin/summary').then((res) => res.data),

  getUsers: (search?: string): Promise<User[]> =>
    apiClient.get('/admin/users', { params: { search } }).then((res) => res.data),

  updateUser: (userId: string, userData: {
    name?: string;
    email?: string;
    password?: string;
    role?: string;
    assigned_locations?: string[];
    is_email_verified?: boolean;
  }): Promise<User> => apiClient.patch(`/admin/users/${userId}`, userData).then((res) => res.data),

  deleteUser: (userId: string): Promise<{ message: string }> =>
    apiClient.delete(`/admin/users/${userId}`).then((res) => res.data),

  getRegistrationEmails: (search?: string): Promise<RegistrationInvite[]> =>
    apiClient.get('/admin/registration-emails', { params: { search } }).then((res) => res.data),

  createRegistrationEmail: (data: {
    email: string;
    name_hint?: string;
    role: string;
    assigned_locations?: string[];
    is_active?: boolean;
  }): Promise<RegistrationInvite> =>
    apiClient.post('/admin/registration-emails', data).then((res) => res.data),

  updateRegistrationEmail: (
    inviteId: string,
    data: { name_hint?: string; role?: string; assigned_locations?: string[]; is_active?: boolean }
  ): Promise<RegistrationInvite> =>
    apiClient.patch(`/admin/registration-emails/${inviteId}`, data).then((res) => res.data),

  deleteRegistrationEmail: (inviteId: string): Promise<{ message: string }> =>
    apiClient.delete(`/admin/registration-emails/${inviteId}`).then((res) => res.data),

  getDropdownOptions: (category?: string, search?: string, activeOnly?: boolean): Promise<DropdownOption[]> =>
    apiClient
      .get('/admin/dropdown-options', { params: { category, search, active_only: activeOnly } })
      .then((res) => res.data),

  createDropdownOption: (data: {
    category: string;
    value: string;
    label?: string;
    is_active?: boolean;
    sort_order?: number;
  }): Promise<DropdownOption> =>
    apiClient.post('/admin/dropdown-options', data).then((res) => res.data),

  updateDropdownOption: (
    optionId: string,
    data: { value?: string; label?: string; is_active?: boolean; sort_order?: number }
  ): Promise<DropdownOption> =>
    apiClient.patch(`/admin/dropdown-options/${optionId}`, data).then((res) => res.data),

  deleteDropdownOption: (optionId: string): Promise<{ message: string }> =>
    apiClient.delete(`/admin/dropdown-options/${optionId}`).then((res) => res.data),

  getReferenceElements: (
    search?: string,
    filters?: {
      location?: string;
      structure_type?: string;
      structure_name?: string;
      structure_id?: string;
      element_id?: string;
    },
    limit: number = 500
  ): Promise<RequisitionElementOption[]> =>
    apiClient.get('/admin/reference-elements', { params: { search, ...filters, limit } }).then((res) => res.data),

  createReferenceElement: (data: Omit<RequisitionElementOption, 'id'>): Promise<RequisitionElementOption> =>
    apiClient.post('/admin/reference-elements', data).then((res) => res.data),

  updateReferenceElement: (
    elementId: number,
    data: Partial<Omit<RequisitionElementOption, 'id'>>
  ): Promise<RequisitionElementOption> =>
    apiClient.patch(`/admin/reference-elements/${elementId}`, data).then((res) => res.data),

  deleteReferenceElement: (elementId: number): Promise<{ message: string }> =>
    apiClient.delete(`/admin/reference-elements/${elementId}`).then((res) => res.data),
};

// ============== REQUISITION ENDPOINTS ==============

export const requisitionAPI = {
  createRequisition: (data: ConcreteRequisitionCreate): Promise<ConcreteRequisition> =>
    apiClient.post('/requisitions/', data).then((res) => res.data),

  resubmitRequisition: (supplyId: string, data: ConcreteRequisitionCreate): Promise<ConcreteRequisition> =>
    apiClient.put(`/requisitions/${supplyId}/resubmit`, data).then((res) => res.data),

  previewSupplyId: (data: {
    location: string;
    structure_name: string;
    structure_id: string;
  }): Promise<SupplyIdPreview> =>
    apiClient
      .get('/requisitions/supply-id/preview', { params: data })
      .then((res) => res.data),

  getRequisitions: (statusFilter?: string, locationScope?: 'assigned'): Promise<ConcreteRequisition[]> =>
    apiClient
      .get('/requisitions/', { params: { status_filter: statusFilter, location_scope: locationScope } })
      .then((res) => res.data),

  getRequisitionById: (supplyId: string): Promise<ConcreteRequisition> =>
    apiClient.get(`/requisitions/${supplyId}`).then((res) => res.data),

  validateRequisition: (supplyId: string, validation: {
    validated_by: string;
    planning_remarks?: string;
    is_approved: string;
  }): Promise<PlanningValidation> =>
    apiClient
      .put(`/requisitions/${supplyId}/validate`, validation)
      .then((res) => res.data),

};

// ============== HIERARCHY LOOKUP ENDPOINTS ==============

export const hierarchyAPI = {
  getLocations: (): Promise<string[]> =>
    apiClient.get('/requisitions/meta/locations').then((res) => res.data),

  getStructureTypes: (location: string): Promise<string[]> =>
    apiClient
      .get('/requisitions/meta/structure-types', { params: { location } })
      .then((res) => res.data),

  getStructureNames: (location: string, structureType: string): Promise<string[]> =>
    apiClient
      .get('/requisitions/meta/structure-names', {
        params: { location, structure_type: structureType },
      })
      .then((res) => res.data),

  getStructureIds: (
    location: string,
    structureType: string,
    structureName: string
  ): Promise<string[]> =>
    apiClient
      .get('/requisitions/meta/structure-ids', {
        params: {
          location,
          structure_type: structureType,
          structure_name: structureName,
        },
      })
      .then((res) => res.data),

  getElementIds: (
    location: string,
    structureType: string,
    structureName: string,
    structureId: string
  ): Promise<string[]> =>
    apiClient
      .get('/requisitions/meta/element-ids', {
        params: {
          location,
          structure_type: structureType,
          structure_name: structureName,
          structure_id: structureId,
        },
      })
      .then((res) => res.data),

  getFilterOptions: (field: 'location' | 'structure_type' | 'structure_name' | 'structure_id' | 'pile_lift_id'): Promise<string[]> =>
    apiClient
      .get('/requisitions/meta/filter-options', { params: { field } })
      .then((res) => res.data),

  getDropdownOptions: (category: string): Promise<string[]> =>
    apiClient
      .get('/requisitions/meta/dropdown-options', { params: { category } })
      .then((res) => res.data),
};

// ============== PRODUCTION/DISPATCH ENDPOINTS ==============

export const productionAPI = {
  createDispatch: (data: {
    supply_id: string;
    batching_plant_id: string;
    tm_number: string;
    actual_dispatched_qty: number;
    dispatch_time: string;
    receipt_location: string;
    delivery_time?: string;
  }): Promise<ProductionDispatch> =>
    apiClient.post('/production/dispatch', data).then((res) => res.data),

  getDispatchesBySupply: (supplyId: string): Promise<ProductionDispatch[]> =>
    apiClient.get(`/production/dispatch/${supplyId}`).then((res) => res.data),

  getAllDispatches: (skip: number = 0, limit: number = 100): Promise<ProductionDispatch[]> =>
    apiClient
      .get('/production/', { params: { skip, limit } })
      .then((res) => res.data),

  updateDeliveryTime: (dispatchId: string, deliveryTime: string): Promise<ProductionDispatch> =>
    apiClient
      .put(`/production/dispatch/${dispatchId}/delivery`, { delivery_time: deliveryTime })
      .then((res) => res.data),

  reconcileDispatch: (dispatchId: string, data: {
    receipt_at_site_time: string;
    release_from_site_time: string;
    return_to_plant_time: string;
    remarks?: string;
  }): Promise<ProductionDispatch> =>
    apiClient
      .put(`/production/dispatch/${dispatchId}/reconcile`, data)
      .then((res) => res.data),

  acknowledgeDispatch: (dispatchId: string, data: {
    details_match: boolean;
    receipt_at_site_time: string;
    release_from_site_time: string;
    deposited_qty?: number;
    receipt_location?: string;
    receipt_structure_name?: string;
    receipt_structure_id?: string;
    remaining_disposition?: string;
    secondary_receipt_location?: string;
    secondary_receipt_structure_name?: string;
    secondary_receipt_structure_id?: string;
    remarks?: string;
  }): Promise<ProductionDispatch> =>
    apiClient
      .put(`/production/dispatch/${dispatchId}/acknowledge`, data)
      .then((res) => res.data),

  updateReturnToPlant: (dispatchId: string, data: {
    return_to_plant_time: string;
    remarks?: string;
  }): Promise<ProductionDispatch> =>
    apiClient
      .put(`/production/dispatch/${dispatchId}/return-to-plant`, data)
      .then((res) => res.data),
};

// ============== DASHBOARD ENDPOINTS ==============

export const dashboardAPI = {
  getSummary: (days: number = 30): Promise<DashboardSummary> =>
    apiClient.get('/dashboard/summary', { params: { days } }).then((res) => res.data),

  getWastageRecords: (days: number = 30, exceedsLimitOnly: boolean = false): Promise<WastageRecord[]> =>
    apiClient
      .get('/dashboard/wastage', { params: { days, exceeds_limit_only: exceedsLimitOnly } })
      .then((res) => res.data),

  getTurnaroundTimes: (days: number = 30): Promise<TurnaroundTimeRecord[]> =>
    apiClient
      .get('/dashboard/turnaround', { params: { days } })
      .then((res) => res.data),
};

// ============== HEALTH CHECK ==============

export const healthCheck = (): Promise<{
  status: string;
  database: string;
  version: string;
}> => apiClient.get('/health').then((res) => res.data);

export default apiClient;
