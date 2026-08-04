import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { loginAs, auth, uniqueId } from "./helpers";

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
