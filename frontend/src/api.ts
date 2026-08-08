import type {
  AnalyticsSummary,
  AnomalyFinding,
  Batch,
  CalibrationVerifyResult,
  Equipment,
  EquipmentCalibration,
  ManufacturingRecord,
  RecordContent,
  Role,
  User,
  VerifyResult,
} from "./types";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
// The independent audit-attestation service (see audit-service/) - a separate origin
// with its own session, holding the Auditor's signing key. Never shares a cookie or
// session with API_BASE; see AuthContext's dual login and makeRequest below.
const AUDIT_API_BASE = import.meta.env.VITE_AUDIT_API_URL || "http://localhost:4100";

// Auth is a backend-set httpOnly cookie (not readable/storable from JS - avoids XSS
// token theft via localStorage). `credentials: "include"` sends and receives it. Each
// service's cookie is scoped to its own origin, so this factory is reused for both
// rather than assuming a single shared session.
function makeRequest(base: string) {
  return async function request<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      ...options,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error || `Request failed with status ${res.status}`);
    }

    if (res.status === 204) return undefined as T;
    return res.json();
  };
}

const request = makeRequest(API_BASE);
const auditRequest = makeRequest(AUDIT_API_BASE);

export interface PublicVerifyRecord {
  recordId: string;
  label: string | null;
  status: "DRAFT" | "APPROVED" | "ANCHORED";
  anchored: boolean;
  matches: boolean | null;
  anchoredAt: string | null;
}

export interface PublicVerifyResponse {
  batchId: string;
  product: string;
  plannedQuantity: number;
  records: PublicVerifyRecord[];
}

export interface BatchWithRecords extends Batch {
  records: ManufacturingRecord[];
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PendingCoSign<T> {
  count: number;
  items: T[];
}

export const api = {
  login: (email: string, password: string) =>
    request<{ user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  logout: () => request<void>("/auth/logout", { method: "POST" }),

  me: () => request<User>("/auth/me"),

  listUsers: () => request<(User & { createdAt: string })[]>("/users"),

  createUser: (email: string, password: string, name: string, role: Role) =>
    request<User>("/users", {
      method: "POST",
      body: JSON.stringify({ email, password, name, role }),
    }),

  listBatches: (page = 1, pageSize = 20) => request<Page<Batch>>(`/batches?page=${page}&pageSize=${pageSize}`),

  getBatch: (id: string) => request<BatchWithRecords>(`/batches/${id}`),

  createBatch: (batchNumber: string, product: string, plannedQuantity: number) =>
    request<Batch>("/batches", {
      method: "POST",
      body: JSON.stringify({ batchNumber, product, plannedQuantity }),
    }),

  listEquipment: () => request<Equipment[]>("/equipment"),

  createEquipment: (code: string, name: string, type: string) =>
    request<Equipment>("/equipment", {
      method: "POST",
      body: JSON.stringify({ code, name, type }),
    }),

  updateEquipmentStatus: (id: string, status: Equipment["status"]) =>
    request<Equipment>(`/equipment/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),

  listCalibrations: (equipmentId: string) => request<EquipmentCalibration[]>(`/equipment/${equipmentId}/calibrations`),

  calibrateEquipment: (
    equipmentId: string,
    certificateNumber: string,
    technician: string,
    calibratedAt: string,
    nextDueAt: string
  ) =>
    request<EquipmentCalibration>(`/equipment/${equipmentId}/calibrate`, {
      method: "POST",
      body: JSON.stringify({ certificateNumber, technician, calibratedAt, nextDueAt }),
    }),

  retryProposeCalibration: (equipmentId: string, calibrationId: string) =>
    request<EquipmentCalibration>(`/equipment/${equipmentId}/calibration/${calibrationId}/retry-propose`, {
      method: "POST",
    }),

  coSignCalibration: (equipmentId: string, calibrationId: string) =>
    request<EquipmentCalibration>(`/equipment/${equipmentId}/calibration/${calibrationId}/cosign`, {
      method: "POST",
    }),

  verifyCalibration: (equipmentId: string, calibrationId: string) =>
    request<CalibrationVerifyResult>(`/equipment/${equipmentId}/calibration/${calibrationId}/verify`),

  pendingCalibrationCoSigns: () => request<PendingCoSign<EquipmentCalibration>>("/equipment/pending-cosign"),

  createRecord: (batchId: string, stage: string, equipmentId: string | null, content: RecordContent) =>
    request<ManufacturingRecord>("/records", {
      method: "POST",
      body: JSON.stringify({ batchId, stage, equipmentId, content }),
    }),

  getRecord: (id: string) => request<ManufacturingRecord>(`/records/${id}`),

  listRecords: (page = 1, pageSize = 20) =>
    request<Page<ManufacturingRecord>>(`/records?page=${page}&pageSize=${pageSize}`),

  updateContent: (id: string, content: RecordContent, equipmentId?: string | null) =>
    request<ManufacturingRecord>(`/records/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ content, equipmentId }),
    }),

  submit: (id: string) => request<ManufacturingRecord>(`/records/${id}/submit`, { method: "POST" }),

  approve: (id: string) => request<ManufacturingRecord>(`/records/${id}/approve`, { method: "POST" }),

  reject: (id: string, reason: string) =>
    request<ManufacturingRecord>(`/records/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),

  anchorCoSign: (id: string) => request<ManufacturingRecord>(`/records/${id}/anchor-cosign`, { method: "POST" }),

  pendingRecordCoSigns: () => request<PendingCoSign<ManufacturingRecord>>("/records/pending-cosign"),

  anchor: (id: string) => request<ManufacturingRecord>(`/records/${id}/anchor`, { method: "POST" }),

  verify: (id: string) => request<VerifyResult>(`/records/${id}/verify`),

  getAnomalyFindings: (id: string) => request<{ recordId: string; findings: AnomalyFinding[] }>(`/records/${id}/anomaly-findings`),

  getAnalyticsSummary: () => request<AnalyticsSummary>("/analytics/summary"),

  publicVerifyBatch: (batchNumber: string) =>
    request<PublicVerifyResponse>(`/public/verify/${encodeURIComponent(batchNumber)}`),
};

export interface AuditCoSignResult {
  contentHash: string;
  txHash?: string;
  alreadyAnchored: boolean;
}

/** The independent audit-attestation service. Only Auditor/Admin accounts can log
 * into it at all; every other call requires that session. See
 * docs/technical-disclosure.md §4.9 for why this is a separate service rather than
 * another endpoint on the main API. */
export const auditApi = {
  login: (email: string, password: string) =>
    auditRequest<{ user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  logout: () => auditRequest<void>("/auth/logout", { method: "POST" }),

  cosignRecord: (recordId: string) =>
    auditRequest<AuditCoSignResult>(`/records/${recordId}/cosign`, { method: "POST" }),

  cosignCalibration: (equipmentId: string, calibrationId: string) =>
    auditRequest<AuditCoSignResult & { calibrationId: string }>(`/equipment/${equipmentId}/calibration/${calibrationId}/cosign`, {
      method: "POST",
    }),
};
