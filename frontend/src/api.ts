import type { AnalyticsSummary, Batch, Equipment, ManufacturingRecord, RecordContent, Role, User, VerifyResult } from "./types";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";

// Auth is a backend-set httpOnly cookie (not readable/storable from JS - avoids XSS
// token theft via localStorage). `credentials: "include"` sends and receives it.
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
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
}

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

  anchor: (id: string) => request<ManufacturingRecord>(`/records/${id}/anchor`, { method: "POST" }),

  verify: (id: string) => request<VerifyResult>(`/records/${id}/verify`),

  getAnalyticsSummary: () => request<AnalyticsSummary>("/analytics/summary"),

  publicVerifyBatch: (batchNumber: string) =>
    request<PublicVerifyResponse>(`/public/verify/${encodeURIComponent(batchNumber)}`),
};
