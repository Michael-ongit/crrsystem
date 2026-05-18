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
} from './types';

// Initialize Axios instance
const apiClient: AxiosInstance = axios.create({
  baseURL: 'http://localhost:8000',
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
  }): Promise<User> => apiClient.post('/users', userData).then((res) => res.data),

  getUsers: (): Promise<User[]> => apiClient.get('/users').then((res) => res.data),

  getUserById: (userId: string): Promise<User> =>
    apiClient.get(`/users/${userId}`).then((res) => res.data),
};

// ============== REQUISITION ENDPOINTS ==============

export const requisitionAPI = {
  createRequisition: (data: ConcreteRequisitionCreate): Promise<ConcreteRequisition> =>
    apiClient.post('/requisitions', data).then((res) => res.data),

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

  getRequisitions: (statusFilter?: string): Promise<ConcreteRequisition[]> =>
    apiClient
      .get('/requisitions', { params: { status_filter: statusFilter } })
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
      .get('/production', { params: { skip, limit } })
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
