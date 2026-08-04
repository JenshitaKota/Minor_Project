export type RecordStatus = "DRAFT" | "SUBMITTED" | "APPROVED" | "ANCHORED" | "REJECTED";

export type Role = "ADMIN" | "OPERATOR" | "QA_MANAGER" | "AUDITOR";

export type EquipmentStatus = "ACTIVE" | "MAINTENANCE" | "RETIRED";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface Batch {
  id: string;
  batchNumber: string;
  product: string;
  plannedQuantity: number;
  createdAt: string;
  _count?: { records: number };
}

export interface Equipment {
  id: string;
  code: string;
  name: string;
  type: string;
  status: EquipmentStatus;
}

export type RecordContent = Record<string, string | number>;

export interface Anomaly {
  id: string;
  label: string;
}

export type RecordEventType =
  | "CREATED"
  | "EDITED"
  | "REVISED"
  | "SUBMITTED"
  | "APPROVED"
  | "REJECTED"
  | "ANCHORED"
  | "MODIFIED_AFTER_ANCHOR";

export interface RecordEvent {
  id: string;
  recordId: string;
  stage: string;
  type: RecordEventType;
  actor: string | null;
  detail: string | null;
  createdAt: string;
}

interface RecordSnapshot {
  stage: string;
  equipmentId: string | null;
  content: RecordContent;
}

export interface ManufacturingRecord {
  id: string;
  batchId: string;
  batch?: Batch;
  equipmentId: string | null;
  equipment?: Equipment | null;
  stage: string;
  content: RecordContent;
  status: RecordStatus;
  contentHash: string | null;
  anchoredSnapshot: RecordSnapshot | null;
  anchoredTxHash: string | null;
  anchoredAt: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  rejectionReason: string | null;
  anomalies: Anomaly[];
  events?: RecordEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface AnalyticsSummary {
  totalBatches: number;
  totalRecords: number;
  statusBreakdown: Record<RecordStatus, number>;
  verification: { checked: number; passed: number; passRatePercent: number | null };
  averageApprovalTimeMinutes: number | null;
  anomalyCount: number;
}

export interface VerifyResult {
  recordId: string;
  anchored: boolean;
  matches: boolean;
  anchoredAt: string;
  anchoredHash: string;
  currentHash: string;
  anchoredSnapshot: RecordSnapshot;
  currentSnapshot: RecordSnapshot;
}
