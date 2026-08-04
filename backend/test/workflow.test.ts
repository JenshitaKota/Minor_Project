import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { loginAs, auth, uniqueId } from "./helpers";

describe("batch and record lifecycle", () => {
  let operatorToken: string;
  let qaToken: string;

  beforeAll(async () => {
    operatorToken = await loginAs("operator");
    qaToken = await loginAs("qa");
  });

  it("takes a record from draft through to anchored, verified", async () => {
    const batchRes = await request(app)
      .post("/batches")
      .set("Authorization", auth(operatorToken))
      .send({ batchNumber: uniqueId("BATCH"), product: "Test Product", plannedQuantity: 1000 });
    expect(batchRes.status).toBe(201);
    const batchId = batchRes.body.id;

    const createRes = await request(app)
      .post("/records")
      .set("Authorization", auth(operatorToken))
      .send({ batchId, stage: "Mixing", content: { operator: "Test Op", observedQuantity: 990 } });
    expect(createRes.status).toBe(201);
    expect(createRes.body.status).toBe("DRAFT");
    const recordId = createRes.body.id;

    const submitRes = await request(app).post(`/records/${recordId}/submit`).set("Authorization", auth(operatorToken));
    expect(submitRes.status).toBe(200);
    expect(submitRes.body.status).toBe("SUBMITTED");

    const approveRes = await request(app).post(`/records/${recordId}/approve`).set("Authorization", auth(qaToken));
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.status).toBe("ANCHORED");
    expect(approveRes.body.anchoredTxHash).toBeTruthy();

    const verifyRes = await request(app).get(`/records/${recordId}/verify`).set("Authorization", auth(qaToken));
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.matches).toBe(true);
  });

  it("anchors a fast-approval anomaly finding on-chain at approval time", async () => {
    const batchRes = await request(app)
      .post("/batches")
      .set("Authorization", auth(operatorToken))
      .send({ batchNumber: uniqueId("BATCH"), product: "Test Product", plannedQuantity: 1000 });
    const batchId = batchRes.body.id;

    const createRes = await request(app)
      .post("/records")
      .set("Authorization", auth(operatorToken))
      .send({ batchId, stage: "Mixing", content: { operator: "Test Op", observedQuantity: 990 } });
    const recordId = createRes.body.id;

    await request(app).post(`/records/${recordId}/submit`).set("Authorization", auth(operatorToken));
    // Approving immediately after submitting (as this test does) is well under the
    // fixed 60s fallback threshold, so this should always trigger fast-approval.
    const approveRes = await request(app).post(`/records/${recordId}/approve`).set("Authorization", auth(qaToken));
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.anomalies.map((a: { id: string }) => a.id)).toContain("fast-approval");

    const findingsRes = await request(app)
      .get(`/records/${recordId}/anomaly-findings`)
      .set("Authorization", auth(qaToken));
    expect(findingsRes.status).toBe(200);
    const fastApprovalFinding = findingsRes.body.findings.find((f: { id: string }) => f.id === "fast-approval");
    expect(fastApprovalFinding).toBeTruthy();
    expect(fastApprovalFinding.anchored).toBe(true);
    expect(fastApprovalFinding.anchoredAt).toBeTruthy();
  });

  it("detects tampering after a direct content edit post-anchor", async () => {
    const batchRes = await request(app)
      .post("/batches")
      .set("Authorization", auth(operatorToken))
      .send({ batchNumber: uniqueId("BATCH"), product: "Test Product", plannedQuantity: 1000 });
    const batchId = batchRes.body.id;

    const createRes = await request(app)
      .post("/records")
      .set("Authorization", auth(operatorToken))
      .send({ batchId, stage: "Mixing", content: { operator: "Test Op", observedQuantity: 990 } });
    const recordId = createRes.body.id;

    await request(app).post(`/records/${recordId}/submit`).set("Authorization", auth(operatorToken));
    await request(app).post(`/records/${recordId}/approve`).set("Authorization", auth(qaToken));

    const beforeVerify = await request(app).get(`/records/${recordId}/verify`).set("Authorization", auth(qaToken));
    expect(beforeVerify.body.matches).toBe(true);

    await request(app)
      .patch(`/records/${recordId}`)
      .set("Authorization", auth(operatorToken))
      .send({ content: { operator: "Test Op", observedQuantity: 99999 } });

    const afterVerify = await request(app).get(`/records/${recordId}/verify`).set("Authorization", auth(qaToken));
    expect(afterVerify.status).toBe(200);
    expect(afterVerify.body.matches).toBe(false);
  });

  it("keeps a full event history through reject -> revise -> resubmit -> approve", async () => {
    const batchRes = await request(app)
      .post("/batches")
      .set("Authorization", auth(operatorToken))
      .send({ batchNumber: uniqueId("BATCH"), product: "Test Product", plannedQuantity: 1000 });
    const batchId = batchRes.body.id;

    const createRes = await request(app)
      .post("/records")
      .set("Authorization", auth(operatorToken))
      .send({ batchId, stage: "Mixing", content: { operator: "Test Op", observedQuantity: 990 } });
    const recordId = createRes.body.id;

    await request(app).post(`/records/${recordId}/submit`).set("Authorization", auth(operatorToken));
    await request(app)
      .post(`/records/${recordId}/reject`)
      .set("Authorization", auth(qaToken))
      .send({ reason: "Please recheck" });
    await request(app)
      .patch(`/records/${recordId}`)
      .set("Authorization", auth(operatorToken))
      .send({ content: { operator: "Test Op", observedQuantity: 985 } });
    await request(app).post(`/records/${recordId}/submit`).set("Authorization", auth(operatorToken));
    await request(app).post(`/records/${recordId}/approve`).set("Authorization", auth(qaToken));

    const eventsRes = await request(app).get(`/records/${recordId}/events`).set("Authorization", auth(qaToken));
    const types = eventsRes.body.map((e: { type: string }) => e.type);
    expect(types).toEqual(["CREATED", "SUBMITTED", "REJECTED", "REVISED", "SUBMITTED", "APPROVED", "ANCHORED"]);
  });

  it("blocks approving a record that hasn't been submitted", async () => {
    const batchRes = await request(app)
      .post("/batches")
      .set("Authorization", auth(operatorToken))
      .send({ batchNumber: uniqueId("BATCH"), product: "Test Product", plannedQuantity: 1000 });
    const batchId = batchRes.body.id;

    const createRes = await request(app)
      .post("/records")
      .set("Authorization", auth(operatorToken))
      .send({ batchId, stage: "Mixing", content: { operator: "Test Op", observedQuantity: 990 } });
    const recordId = createRes.body.id;

    const approveRes = await request(app).post(`/records/${recordId}/approve`).set("Authorization", auth(qaToken));
    expect(approveRes.status).toBe(409);
  });
});
