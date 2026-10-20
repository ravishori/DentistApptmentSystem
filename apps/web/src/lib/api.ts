import axios from 'axios';
import { reportClientError } from './error-reporter';

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

export const api = axios.create({ baseURL: BASE });

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('access_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (r) => r,
  async (err) => {
    const status = err.response?.status;
    const url    = `${err.config?.method?.toUpperCase() ?? 'GET'} ${err.config?.baseURL ?? ''}${err.config?.url ?? ''}`;
    const respBody = err.response?.data;

    // Try refresh-on-401 (only for non-auth endpoints)
    if (status === 401 && typeof window !== 'undefined' && !err.config?.url?.includes('/auth/')) {
      const refreshToken = localStorage.getItem('refresh_token');
      if (refreshToken) {
        try {
          const { data } = await axios.post(`${BASE}/auth/refresh`, { refreshToken });
          localStorage.setItem('access_token', data.data.accessToken);
          err.config.headers.Authorization = `Bearer ${data.data.accessToken}`;
          return api(err.config);
        } catch {
          localStorage.clear();
          window.location.href = '/login';
        }
      }
    }

    // Report all API errors (network failures, 4xx, 5xx) to the API's /errors/client endpoint.
    // Reporting itself is fire-and-forget and never blocks the rejection.
    const isNetworkError = !err.response;
    const message = isNetworkError
      ? `Network error: ${err.message}`
      : `API ${status}: ${respBody?.message ?? err.message}`;

    reportClientError({
      message,
      stack:   err.stack,
      level:   status && status >= 500 ? 'fatal' : 'error',
      context: 'axios',
      extra: {
        url,
        status,
        responseBody: respBody,
        isNetworkError,
      },
    }).catch(() => { /* never throw from interceptor */ });

    return Promise.reject(err);
  },
);

// ─── Auth ─────────────────────────────────────────────────────────────────────
export const authApi = {
  register: (dto: any) => api.post('/auth/register', dto).then(r => r.data.data),
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }).then(r => r.data.data),
  me: () => api.get('/auth/me').then(r => r.data.data),
};

// ─── Patients ─────────────────────────────────────────────────────────────────
export const patientsApi = {
  list: (params?: any) => api.get('/patients', { params }).then(r => r.data.data),
  findOne: (id: string) => api.get(`/patients/${id}`).then(r => r.data.data),
  /** @deprecated use findOne */
  get: (id: string) => api.get(`/patients/${id}`).then(r => r.data.data),
  create: (dto: any) => api.post('/patients', dto).then(r => r.data.data),
  update: (id: string, dto: any) => api.put(`/patients/${id}`, dto).then(r => r.data.data),
  getTimeline: (id: string) =>
    api.get(`/patients/${id}/timeline`).then(r => r.data.data),
  family: (id: string) => api.get(`/patients/${id}/family`).then(r => r.data.data),
  linkFamily: (id: string, dto: any) =>
    api.patch(`/patients/${id}/family-link`, dto).then(r => r.data.data),
  stats: () => api.get('/patients/stats').then(r => r.data.data),
};

// ─── Appointments ─────────────────────────────────────────────────────────────
export const appointmentsApi = {
  list: (params?: any) => api.get('/appointments', { params }).then(r => r.data.data),
  findOne: (id: string) => api.get(`/appointments/${id}`).then(r => r.data.data),
  slots: (dentistId: string, date: string) =>
    api.get('/appointments/slots', { params: { dentistId, date } }).then(r => r.data.data),
  book: (dto: any) => api.post('/appointments', dto).then(r => r.data.data),
  updateStatus: (id: string, dto: any) =>
    api.patch(`/appointments/${id}/status`, dto).then(r => r.data.data),
  reschedule: (id: string, dto: any) =>
    api.patch(`/appointments/${id}/reschedule`, dto).then(r => r.data.data),
  todaySchedule: () => api.get('/appointments/today').then(r => r.data.data),
};

// ─── Billing ──────────────────────────────────────────────────────────────────
export const billingApi = {
  list: (params?: any) => api.get('/billing/invoices', { params }).then(r => r.data.data),
  findOne: (id: string) => api.get(`/billing/invoices/${id}`).then(r => r.data.data),
  /** @deprecated use findOne */
  get: (id: string) => api.get(`/billing/invoices/${id}`).then(r => r.data.data),
  createInvoice: (dto: any) => api.post('/billing/invoices', dto).then(r => r.data.data),
  /** @deprecated use createInvoice */
  create: (dto: any) => api.post('/billing/invoices', dto).then(r => r.data.data),
  createOrder: (id: string) =>
    api.post(`/billing/invoices/${id}/pay`).then(r => r.data.data),
  verifyPayment: (dto: any) =>
    api.post('/billing/payments/verify', dto).then(r => r.data.data),
  createPaymentLink: (id: string, dto?: any) =>
    api.post(`/billing/invoices/${id}/payment-link`, dto ?? {}).then(r => r.data.data),
  recordManualPayment: (invoiceId: string, dto: any) =>
    api.post(`/billing/invoices/${invoiceId}/payments`, dto).then(r => r.data.data),
  stats: () => api.get('/billing/stats').then(r => r.data.data),
  cancel: (id: string) => api.patch(`/billing/invoices/${id}/cancel`).then(r => r.data.data),
};

// ─── Treatment Packages ───────────────────────────────────────────────────────
export const packagesApi = {
  list: (activeOnly = true) =>
    api.get('/billing/packages', { params: { activeOnly } }).then(r => r.data.data),
  create: (dto: any) => api.post('/billing/packages', dto).then(r => r.data.data),
  findOne: (id: string) => api.get(`/billing/packages/${id}`).then(r => r.data.data),
  update: (id: string, dto: any) => api.patch(`/billing/packages/${id}`, dto).then(r => r.data.data),
  // Enrollments
  listEnrollments: (params?: { patientId?: string; status?: string }) =>
    api.get('/billing/enrollments', { params }).then(r => r.data.data),
  enroll: (dto: any) => api.post('/billing/enrollments', dto).then(r => r.data.data),
  getEnrollment: (id: string) => api.get(`/billing/enrollments/${id}`).then(r => r.data.data),
  markVisitCompleted: (dto: { enrollmentId: string; visitId?: string }) =>
    api.post('/billing/enrollments/mark-visit', dto).then(r => r.data.data),
};

// ─── Insurance Claims ─────────────────────────────────────────────────────────
export const insuranceApi = {
  list: (params?: { patientId?: string; status?: string }) =>
    api.get('/billing/insurance-claims', { params }).then(r => r.data.data),
  create: (dto: any) => api.post('/billing/insurance-claims', dto).then(r => r.data.data),
  findOne: (id: string) => api.get(`/billing/insurance-claims/${id}`).then(r => r.data.data),
  update: (id: string, dto: any) =>
    api.patch(`/billing/insurance-claims/${id}`, dto).then(r => r.data.data),
};

// ─── Billing Reports ──────────────────────────────────────────────────────────
export const reportsApi = {
  dailyRevenue: (from: string, to: string) =>
    api.get('/billing/reports/daily-revenue', { params: { from, to } }).then(r => r.data.data),
  outstanding: () =>
    api.get('/billing/reports/outstanding').then(r => r.data.data),
  gst: (from: string, to: string) =>
    api.get('/billing/reports/gst', { params: { from, to } }).then(r => r.data.data),
  downloadCsv: (type: 'daily-revenue' | 'outstanding' | 'gst', params: Record<string, string>) => {
    const url = new URL(`${BASE}/billing/reports/${type}`, window.location.origin);
    url.searchParams.set('format', 'csv');
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    window.open(url.toString(), '_blank');
  },
};

// ─── Treatments ───────────────────────────────────────────────────────────────
export const treatmentsApi = {
  list: (params?: any) => api.get('/treatments', { params }).then(r => r.data.data),
  get: (id: string) => api.get(`/treatments/${id}`).then(r => r.data.data),
  create: (dto: any) => api.post('/treatments', dto).then(r => r.data.data),
  updateStatus: (id: string, status: string) =>
    api.patch(`/treatments/${id}/status`, { status }).then(r => r.data.data),
  procedures: () =>
    api.get('/treatments/procedures/catalog').then(r => r.data.data),
};

// ─── Analytics ────────────────────────────────────────────────────────────────
export const analyticsApi = {
  dashboard:          ()              => api.get('/analytics/dashboard').then(r => r.data.data),
  // Dashboard chart adapters over existing endpoints (no dedicated chart endpoints exist server-side)
  topProcedures: () =>
    api.get('/analytics/revenue/procedures', { params: { months: 12 } })
      .then(r => (r.data.data as { procedure: string; appointmentCount: number }[]).slice(0, 6).map(p => ({
        name:  p.procedure.replace(/_/g, ' '),
        count: p.appointmentCount,
      }))),
  /** Appointments per day for the last `days` days (client-side count of one page of up to 100). */
  appointmentChart: async (days = 14) => {
    const end   = new Date();
    const start = new Date(end.getTime() - (days - 1) * 86400000);
    const iso   = (d: Date) => d.toISOString().slice(0, 10);
    const res   = await api.get('/appointments', {
      params: { startDate: iso(start), endDate: iso(end), limit: 100 },
    }).then(r => r.data.data as { items: { appointmentDate: string }[] });
    const counts = new Map<string, number>();
    for (let i = 0; i < days; i++) counts.set(iso(new Date(start.getTime() + i * 86400000)), 0);
    for (const a of res.items ?? []) {
      const k = String(a.appointmentDate).slice(0, 10);
      if (counts.has(k)) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return Array.from(counts, ([date, count]) => ({ date, count }));
  },
  revenueByProcedure: (months = 12)  => api.get('/analytics/revenue/procedures', { params: { months } }).then(r => r.data.data),
  patientLtv:         ()              => api.get('/analytics/patients/ltv').then(r => r.data.data),
  noShowAnalysis:     (months = 6)   => api.get('/analytics/appointments/no-show', { params: { months } }).then(r => r.data.data),
  conversionFunnel:   (months = 3)   => api.get('/analytics/funnel', { params: { months } }).then(r => r.data.data),
  trends:             (period: 'monthly' | 'yearly' = 'monthly', count = 12) =>
    api.get('/analytics/trends', { params: { period, count } }).then(r => r.data.data),
  dentistPerformance: (months = 3)   => api.get('/analytics/dentists/performance', { params: { months } }).then(r => r.data.data),
  inactivePatients:   (days = 90)    => api.get('/analytics/patients/inactive', { params: { days } }).then(r => r.data.data),
  highValuePatients:  ()              => api.get('/analytics/patients/high-value').then(r => r.data.data),
  exportRevenueCsv:   (months = 12)  => api.get('/analytics/export/revenue-csv', { params: { months }, responseType: 'blob' }).then(r => r.data),
  exportLtvCsv:       ()              => api.get('/analytics/export/ltv-csv', { responseType: 'blob' }).then(r => r.data),
};

// ─── Clinic ───────────────────────────────────────────────────────────────────
export const clinicApi = {
  getProfile: () => api.get('/clinic/profile').then(r => r.data.data),
  update: (dto: any) => api.patch('/clinic/profile', dto).then(r => r.data.data),
  getStats: () => api.get('/clinic/stats').then(r => r.data.data),
  getDentists: () => api.get('/clinic/dentists').then(r => r.data.data),
};

// ─── WhatsApp ─────────────────────────────────────────────────────────────────
export const whatsappApi = {
  broadcast: (dto: { audience: string; templateName: string; customIds?: string[] }) =>
    api.post('/whatsapp/broadcast', dto).then(r => r.data.data),
  conversations: () => api.get('/whatsapp/conversations').then(r => r.data.data),
  sendMessage: (to: string, message: string) =>
    api.post('/whatsapp/send', { to, message }).then(r => r.data.data),
};

// ─── Revenue (private: clinic owners + explicitly authorised users) ─────────
export const revenueApi = {
  me:             () => api.get('/analytics/revenue/access/me').then(r => r.data.data),
  trend:          (months = 6) => api.get('/analytics/revenue/trend', { params: { months } }).then(r => r.data.data),
  setPreference:  (showOnDashboard: boolean) => api.put('/analytics/revenue/preference', { showOnDashboard }).then(r => r.data.data),
  listAccess:     () => api.get('/analytics/revenue/access').then(r => r.data.data),
  setAccess:      (userId: string, granted: boolean) => api.put(`/analytics/revenue/access/${userId}`, { granted }).then(r => r.data.data),
};

// ─── Users / Staff ────────────────────────────────────────────────────────────
export const usersApi = {
  list: () => api.get('/users').then(r => r.data.data),
  dentists: () => api.get('/users/dentists').then(r => r.data.data),
  create: (dto: any) => api.post('/users', dto).then(r => r.data.data),
};

// ─── Documents ───────────────────────────────────────────────────────────────
export const documentsApi = {
  /** Upload a file — caller builds a FormData with keys: file, type, visitId?, description?, tags? */
  upload: (patientId: string, formData: FormData, onProgress?: (pct: number) => void) =>
    api.post(`/patients/${patientId}/documents`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: onProgress
        ? (e) => { if (e.total) onProgress(Math.round((e.loaded / e.total) * 100)); }
        : undefined,
    }).then(r => r.data.data),

  list: (patientId: string, page = 1, limit = 20) =>
    api.get(`/patients/${patientId}/documents`, { params: { page, limit } }).then(r => r.data.data),

  search: (patientId: string, params: {
    q?: string; type?: string; from?: string; to?: string; tag?: string; page?: number; limit?: number;
  }) =>
    api.get(`/patients/${patientId}/documents/search`, { params }).then(r => r.data.data),

  findOne: (patientId: string, id: string) =>
    api.get(`/patients/${patientId}/documents/${id}`).then(r => r.data.data),

  byVisit: (patientId: string, visitId: string) =>
    api.get(`/patients/${patientId}/documents/visit/${visitId}`).then(r => r.data.data),

  update: (patientId: string, id: string, data: { description?: string; tags?: string[] }) =>
    api.patch(`/patients/${patientId}/documents/${id}`, data).then(r => r.data.data),

  remove: (patientId: string, id: string) =>
    api.delete(`/patients/${patientId}/documents/${id}`).then(r => r.data.data),
};

// ─── EHR ─────────────────────────────────────────────────────────────────────
export const ehrApi = {
  getChart: (patientId: string) =>
    api.get(`/patients/${patientId}/ehr/chart`).then(r => r.data.data),
  updateTooth: (patientId: string, fdi: number, dto: any) =>
    api.patch(`/patients/${patientId}/ehr/chart/tooth/${fdi}`, dto).then(r => r.data.data),
  bulkUpdateTeeth: (patientId: string, dto: any) =>
    api.patch(`/patients/${patientId}/ehr/chart/bulk`, dto).then(r => r.data.data),
  getTimeline: (patientId: string, page = 1, limit = 10) =>
    api.get(`/patients/${patientId}/ehr/timeline`, { params: { page, limit } }).then(r => r.data.data),
  createVisit: (patientId: string, dto: any) =>
    api.post(`/patients/${patientId}/ehr/visits`, dto).then(r => r.data.data),
  getVisit: (patientId: string, visitId: string) =>
    api.get(`/patients/${patientId}/ehr/visits/${visitId}`).then(r => r.data.data),
  updateVisit: (patientId: string, visitId: string, dto: any) =>
    api.patch(`/patients/${patientId}/ehr/visits/${visitId}`, dto).then(r => r.data.data),
  addDiagnosis: (patientId: string, visitId: string, dto: any) =>
    api.post(`/patients/${patientId}/ehr/visits/${visitId}/diagnoses`, dto).then(r => r.data.data),
};

// ─── Prescriptions ────────────────────────────────────────────────────────────
export const prescriptionsApi = {
  list: (patientId: string, page = 1, limit = 20) =>
    api.get(`/patients/${patientId}/prescriptions`, { params: { page, limit } }).then(r => r.data.data),
  create: (patientId: string, dto: any) =>
    api.post(`/patients/${patientId}/prescriptions`, dto).then(r => r.data.data),
  findOne: (patientId: string, rxId: string) =>
    api.get(`/patients/${patientId}/prescriptions/${rxId}`).then(r => r.data.data),
  downloadPdfUrl: (patientId: string, rxId: string) =>
    `${BASE}/patients/${patientId}/prescriptions/${rxId}/pdf`,
  listTemplates: () =>
    api.get('/prescription-templates').then(r => r.data.data),
  createTemplate: (dto: any) =>
    api.post('/prescription-templates', dto).then(r => r.data.data),
  deleteTemplate: (id: string) =>
    api.delete(`/prescription-templates/${id}`).then(r => r.data.data),
};

// ─── Clinic Management (Multi-doctor) ────────────────────────────────────────
export const clinicMgmtApi = {
  // Chairs
  listChairs: (activeOnly = true) =>
    api.get('/clinic-management/chairs', { params: { activeOnly } }).then(r => r.data.data),
  createChair: (dto: any) =>
    api.post('/clinic-management/chairs', dto).then(r => r.data.data),
  updateChair: (id: string, dto: any) =>
    api.patch(`/clinic-management/chairs/${id}`, dto).then(r => r.data.data),
  removeChair: (id: string) =>
    api.delete(`/clinic-management/chairs/${id}`).then(r => r.data.data),
  chairUtilization: (date: string) =>
    api.get('/clinic-management/chairs/utilization', { params: { date } }).then(r => r.data.data),

  // Doctors
  getDoctors: () =>
    api.get('/clinic-management/doctors').then(r => r.data.data),

  // Availability rules
  listAvailabilities: (dentistId?: string) =>
    api.get('/clinic-management/availability', { params: { dentistId } }).then(r => r.data.data),
  createAvailability: (dto: any) =>
    api.post('/clinic-management/availability', dto).then(r => r.data.data),
  updateAvailability: (id: string, dto: any) =>
    api.patch(`/clinic-management/availability/${id}`, dto).then(r => r.data.data),
  deleteAvailability: (id: string) =>
    api.delete(`/clinic-management/availability/${id}`).then(r => r.data.data),

  // Schedule overrides
  createOverride: (dto: any) =>
    api.post('/clinic-management/schedule-overrides', dto).then(r => r.data.data),
  listOverrides: (dentistId: string, from: string, to: string) =>
    api.get('/clinic-management/schedule-overrides', { params: { dentistId, from, to } }).then(r => r.data.data),

  // Availability check
  checkAvailability: (params: { dentistId?: string; from: string; to: string }) =>
    api.get('/clinic-management/availability/check', { params }).then(r => r.data.data),

  // Slots
  generateSlots: (dto: any) =>
    api.post('/clinic-management/slots/generate', dto).then(r => r.data.data),
  getFreeSlots: (dentistId: string, date: string) =>
    api.get('/clinic-management/slots/free', { params: { dentistId, date } }).then(r => r.data.data),

  // Day schedule
  getDaySchedule: (date: string) =>
    api.get('/clinic-management/schedule/day', { params: { date } }).then(r => r.data.data),

  // Book appointment (with double-booking prevention + auto chair)
  bookAppointment: (dto: {
    dentistId: string; patientId: string; date: string;
    startTime: string; endTime: string; chairId?: string; type?: string; notes?: string;
  }) =>
    api.post('/clinic-management/appointments', dto).then(r => r.data.data),
};

// ─── Notifications ────────────────────────────────────────────────────────────
export const notificationsApi = {
  list: (params?: any) => api.get('/notifications', { params }).then(r => r.data.data),
  markRead: (id: string) =>
    api.patch(`/notifications/${id}/read`).then(r => r.data.data),
  markAllRead: () => api.patch('/notifications/read-all').then(r => r.data.data),
};
