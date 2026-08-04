import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { loginAs, auth, uniqueId } from "./helpers";

describe("role enforcement", () => {
  let operatorToken: string;
  let qaToken: string;
  let auditorToken: string;
  let batchId: string;

  beforeAll(async () => {
    operatorToken = await loginAs("operator");
    qaToken = await loginAs("qa");
    auditorToken = await loginAs("auditor");

    const batchRes = await request(app)
      .post("/batches")
      .set("Authorization", auth(operatorToken))
      .send({ batchNumber: uniqueId("BATCH"), product: "Test Product", plannedQuantity: 1000 });
    batchId = batchRes.body.id;
  });

  it("blocks an auditor from creating a batch", async () => {
    const res = await request(app)
      .post("/batches")
      .set("Authorization", auth(auditorToken))
      .send({ batchNumber: uniqueId("BATCH"), product: "X", plannedQuantity: 1 });
    expect(res.status).toBe(403);
  });

  it("blocks an operator from approving a record", async () => {
    const createRes = await request(app)
      .post("/records")
      .set("Authorization", auth(operatorToken))
      .send({ batchId, stage: "Mixing", content: { operator: "Test Op", observedQuantity: 990 } });
    const recordId = createRes.body.id;
    await request(app).post(`/records/${recordId}/submit`).set("Authorization", auth(operatorToken));

    const approveRes = await request(app).post(`/records/${recordId}/approve`).set("Authorization", auth(operatorToken));
    expect(approveRes.status).toBe(403);
  });

  it("lets an auditor read records but blocks edits", async () => {
    const listRes = await request(app).get("/records").set("Authorization", auth(auditorToken));
    expect(listRes.status).toBe(200);

    const createRes = await request(app)
      .post("/records")
      .set("Authorization", auth(operatorToken))
      .send({ batchId, stage: "Mixing", content: { operator: "Test Op", observedQuantity: 990 } });
    const recordId = createRes.body.id;

    const patchRes = await request(app)
      .patch(`/records/${recordId}`)
      .set("Authorization", auth(auditorToken))
      .send({ content: { operator: "hacked", observedQuantity: 1 } });
    expect(patchRes.status).toBe(403);
  });

  it("rejects requests with no token at all", async () => {
    const res = await request(app).get("/batches");
    expect(res.status).toBe(401);
  });
});
