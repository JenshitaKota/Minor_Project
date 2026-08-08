import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashRecord, hashContent } from "../src/chain/hash";

// A superuser connection, used ONLY by tests to set up fixture rows - the app's own
// runtime connection (src/db/client.ts) is read-only and cannot write these itself.
// This is deliberate: tests exercise the app exactly as constrained as production.
const adapter = new PrismaPg({ connectionString: process.env.TEST_SUPERUSER_DATABASE_URL });
export const superuserPrisma = new PrismaClient({ adapter });

export async function createBatch() {
  return superuserPrisma.batch.create({
    data: { batchNumber: `BATCH-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, product: "Test Product", plannedQuantity: 100 },
  });
}

export async function createEquipment() {
  return superuserPrisma.equipment.create({
    data: { code: `EQ-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, name: "Test Equipment", type: "Mixer" },
  });
}

interface RecordFixtureOptions {
  anchorProposedBy: string;
}

/** Inserts a ManufacturingRecord directly in the state a real APPROVED-with-a-pending-
 * proposal record would be in - standing in for the main backend's own propose flow,
 * which this service's tests don't run - and returns the exact content hash the
 * /records/:id/cosign route will independently recompute, so tests can propose a
 * matching package on-chain (see chainHelpers.ts). */
export async function createRecordFixture(options: RecordFixtureOptions) {
  const batch = await createBatch();
  const stage = "Mixing";
  const content = { operator: "Test Op", observedQuantity: 990 };
  const record = await superuserPrisma.manufacturingRecord.create({
    data: {
      batchId: batch.id,
      stage,
      content,
      status: "APPROVED",
      anchorProposedAt: new Date(),
      anchorProposedBy: options.anchorProposedBy,
    },
  });
  const contentHash = hashRecord({ stage, equipmentId: null, content });
  return { record, contentHash };
}

interface CalibrationFixtureOptions {
  anchorProposedBy: string;
}

/** Same idea as createRecordFixture, for an EquipmentCalibration row - returns the
 * exact hash the /equipment/:id/calibration/:id/cosign route will independently
 * recompute from these same column values. */
export async function createCalibrationFixture(options: CalibrationFixtureOptions) {
  const equipment = await createEquipment();
  const certificateNumber = `CERT-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const technician = "T. Bench";
  const calibratedAt = new Date();
  const nextDueAt = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);

  const contentHash = hashContent({
    equipmentId: equipment.id,
    certificateNumber,
    technician,
    calibratedAt: calibratedAt.toISOString(),
    nextDueAt: nextDueAt.toISOString(),
  });

  const calibration = await superuserPrisma.equipmentCalibration.create({
    data: {
      equipmentId: equipment.id,
      certificateNumber,
      technician,
      calibratedAt,
      nextDueAt,
      content: { equipmentId: equipment.id, certificateNumber, technician },
      contentHash,
      anchorProposedAt: new Date(),
      anchorProposedBy: options.anchorProposedBy,
    },
  });

  return { equipment, calibration, contentHash };
}
