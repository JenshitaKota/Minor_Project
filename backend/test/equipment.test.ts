import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { loginAs, auth, uniqueId } from "./helpers";

function futureDate(daysFromNow: number): string {
  return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString();
}

describe("equipment status enforcement", () => {
  let operatorToken: string;
  let batchId: string;

  beforeAll(async () => {
    operatorToken = await loginAs("operator");
    const batchRes = await request(app)
      .post("/batches")
      .set("Authorization", auth(operatorToken))
      .send({ batchNumber: uniqueId("BATCH"), product: "Test Product", plannedQuantity: 1000 });
    batchId = batchRes.body.id;
  });

  it("blocks assigning equipment that is under maintenance", async () => {
    const equipRes = await request(app)
      .post("/equipment")
      .set("Authorization", auth(operatorToken))
      .send({ code: uniqueId("MIXER"), name: "Test Mixer", type: "Mixer" });
    const equipmentId = equipRes.body.id;

    await request(app)
      .patch(`/equipment/${equipmentId}/status`)
      .set("Authorization", auth(operatorToken))
      .send({ status: "MAINTENANCE" });

    const recordRes = await request(app)
      .post("/records")
      .set("Authorization", auth(operatorToken))
      .send({ batchId, stage: "Mixing", equipmentId, content: { operator: "Test Op", observedQuantity: 990 } });

    expect(recordRes.status).toBe(409);
  });

  it("allows assigning equipment that is active", async () => {
    const equipRes = await request(app)
      .post("/equipment")
      .set("Authorization", auth(operatorToken))
      .send({ code: uniqueId("MIXER"), name: "Test Mixer", type: "Mixer" });
    const equipmentId = equipRes.body.id;

    const recordRes = await request(app)
      .post("/records")
      .set("Authorization", auth(operatorToken))
      .send({ batchId, stage: "Mixing", equipmentId, content: { operator: "Test Op", observedQuantity: 990 } });

    expect(recordRes.status).toBe(201);
    expect(recordRes.body.equipmentId).toBe(equipmentId);
  });
});

describe("equipment calibration anchoring", () => {
  let operatorToken: string;
  let auditorToken: string;
  let adminToken: string;

  beforeAll(async () => {
    operatorToken = await loginAs("operator");
    auditorToken = await loginAs("auditor");
    adminToken = await loginAs("admin");
  });

  async function createEquipment() {
    const res = await request(app)
      .post("/equipment")
      .set("Authorization", auth(operatorToken))
      .send({ code: uniqueId("CAL-MIXER"), name: "Test Mixer", type: "Mixer" });
    return res.body.id as string;
  }

  it("logs a calibration, proposes an anchor, and moves equipment to MAINTENANCE pending co-signature", async () => {
    const equipmentId = await createEquipment();

    const calibrateRes = await request(app)
      .post(`/equipment/${equipmentId}/calibrate`)
      .set("Authorization", auth(operatorToken))
      .send({ certificateNumber: uniqueId("CERT"), technician: "T. Bench", calibratedAt: new Date().toISOString(), nextDueAt: futureDate(180) });
    expect(calibrateRes.status).toBe(201);
    expect(calibrateRes.body.anchorProposedAt).toBeTruthy();
    expect(calibrateRes.body.anchorProposedBy).toBe("test-operator@pharmachain.test");
    expect(calibrateRes.body.anchoredAt).toBeFalsy();

    const equipmentRes = await request(app).get("/equipment").set("Authorization", auth(operatorToken));
    const equipment = equipmentRes.body.find((e: { id: string }) => e.id === equipmentId);
    expect(equipment.status).toBe("MAINTENANCE");
  });

  it("blocks the same person who proposed a calibration from co-signing it", async () => {
    const equipmentId = await createEquipment();
    const calibrateRes = await request(app)
      .post(`/equipment/${equipmentId}/calibrate`)
      .set("Authorization", auth(adminToken))
      .send({ certificateNumber: uniqueId("CERT"), technician: "T. Bench", calibratedAt: new Date().toISOString(), nextDueAt: futureDate(180) });
    const calibrationId = calibrateRes.body.id;

    const selfCoSignRes = await request(app)
      .post(`/equipment/${equipmentId}/calibration/${calibrationId}/cosign`)
      .set("Authorization", auth(adminToken));
    expect(selfCoSignRes.status).toBe(403);
  });

  it("lets a different Auditor co-sign, anchoring the calibration and reactivating the equipment", async () => {
    const equipmentId = await createEquipment();
    const calibrateRes = await request(app)
      .post(`/equipment/${equipmentId}/calibrate`)
      .set("Authorization", auth(operatorToken))
      .send({ certificateNumber: uniqueId("CERT"), technician: "T. Bench", calibratedAt: new Date().toISOString(), nextDueAt: futureDate(180) });
    const calibrationId = calibrateRes.body.id;

    const coSignRes = await request(app)
      .post(`/equipment/${equipmentId}/calibration/${calibrationId}/cosign`)
      .set("Authorization", auth(auditorToken));
    expect(coSignRes.status).toBe(200);
    expect(coSignRes.body.anchoredAt).toBeTruthy();
    expect(coSignRes.body.anchoredTxHash).toBeTruthy();
    expect(coSignRes.body.anchorCoSignedBy).toBe("test-auditor@pharmachain.test");

    const equipmentRes = await request(app).get("/equipment").set("Authorization", auth(operatorToken));
    const equipment = equipmentRes.body.find((e: { id: string }) => e.id === equipmentId);
    expect(equipment.status).toBe("ACTIVE");

    const verifyRes = await request(app)
      .get(`/equipment/${equipmentId}/calibration/${calibrationId}/verify`)
      .set("Authorization", auth(operatorToken));
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.matches).toBe(true);
  });

  it("blocks co-signing when there is no pending calibration proposal", async () => {
    const equipmentId = await createEquipment();
    const coSignRes = await request(app)
      .post(`/equipment/${equipmentId}/calibration/does-not-exist/cosign`)
      .set("Authorization", auth(auditorToken));
    expect(coSignRes.status).toBe(404);
  });

  it("lists calibrations pending an Auditor's co-signature, excluding the caller's own proposals", async () => {
    const equipmentId = await createEquipment();
    await request(app)
      .post(`/equipment/${equipmentId}/calibrate`)
      .set("Authorization", auth(operatorToken))
      .send({ certificateNumber: uniqueId("CERT"), technician: "T. Bench", calibratedAt: new Date().toISOString(), nextDueAt: futureDate(180) });

    const pendingForAuditor = await request(app).get("/equipment/pending-cosign").set("Authorization", auth(auditorToken));
    expect(pendingForAuditor.body.count).toBeGreaterThanOrEqual(1);
    expect(pendingForAuditor.body.items.some((c: { equipmentId: string }) => c.equipmentId === equipmentId)).toBe(true);

    const pendingForOperator = await request(app).get("/equipment/pending-cosign").set("Authorization", auth(operatorToken));
    expect(pendingForOperator.body.items.some((c: { equipmentId: string }) => c.equipmentId === equipmentId)).toBe(false);
  });
});
