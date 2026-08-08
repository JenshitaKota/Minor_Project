import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { loginAs, auth, uniqueId } from "./helpers";
import { coSignOnChainAsAuditor } from "./chainHelpers";

describe("batch and record lifecycle", () => {
  let operatorToken: string;
  let qaToken: string;
  let auditorToken: string;
  let adminToken: string;

  beforeAll(async () => {
    operatorToken = await loginAs("operator");
    qaToken = await loginAs("qa");
    auditorToken = await loginAs("auditor");
    adminToken = await loginAs("admin");
  });

  it("takes a record from draft, through a proposed anchor, to co-signed and verified", async () => {
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
    // Approval only proposes the anchor - it stays APPROVED until an independent
    // Auditor co-signs, not ANCHORED yet.
    expect(approveRes.body.status).toBe("APPROVED");
    expect(approveRes.body.anchorProposedAt).toBeTruthy();
    expect(approveRes.body.anchoredTxHash).toBeFalsy();

    // Simulates audit-service co-signing on-chain (see chainHelpers.ts) before the
    // backend's now confirm-only /anchor-cosign endpoint is called.
    await coSignOnChainAsAuditor(recordId);

    const coSignRes = await request(app)
      .post(`/records/${recordId}/anchor-cosign`)
      .set("Authorization", auth(auditorToken));
    expect(coSignRes.status).toBe(200);
    expect(coSignRes.body.status).toBe("ANCHORED");
    expect(coSignRes.body.anchoredTxHash).toBeTruthy();

    const verifyRes = await request(app).get(`/records/${recordId}/verify`).set("Authorization", auth(qaToken));
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.matches).toBe(true);
  });

  it("blocks a QA_MANAGER from ever reaching the co-sign endpoint (role gate)", async () => {
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

    const coSignRes = await request(app)
      .post(`/records/${recordId}/anchor-cosign`)
      .set("Authorization", auth(qaToken));
    expect(coSignRes.status).toBe(403);
  });

  it("blocks the same person from co-signing their own proposal, even as an Admin who is allowed to do both", async () => {
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
    // An Admin can both approve and co-sign in principle (requireRole allows ADMIN on
    // both routes) - this is the scenario that actually exercises the app-layer
    // "not the same person" check, since a QA_MANAGER can't reach /anchor-cosign at
    // all (blocked by role, tested above) regardless of that check.
    await request(app).post(`/records/${recordId}/approve`).set("Authorization", auth(adminToken));

    const selfCoSignRes = await request(app)
      .post(`/records/${recordId}/anchor-cosign`)
      .set("Authorization", auth(adminToken));
    expect(selfCoSignRes.status).toBe(403);

    const record = await request(app).get(`/records/${recordId}`).set("Authorization", auth(qaToken));
    expect(record.body.status).toBe("APPROVED");

    // A genuinely different person (the Auditor) can still co-sign the same proposal.
    await coSignOnChainAsAuditor(recordId);
    const coSignRes = await request(app)
      .post(`/records/${recordId}/anchor-cosign`)
      .set("Authorization", auth(auditorToken));
    expect(coSignRes.status).toBe(200);
    expect(coSignRes.body.status).toBe("ANCHORED");
  });

  it("anchors a fast-approval anomaly finding on-chain once co-signed", async () => {
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
    expect(approveRes.body.anomalies.map((a: { id: string }) => a.id)).toContain("fast-approval");

    // Not yet anchored - still just proposed, awaiting co-signature.
    const beforeCoSign = await request(app)
      .get(`/records/${recordId}/anomaly-findings`)
      .set("Authorization", auth(qaToken));
    const pendingFinding = beforeCoSign.body.findings.find((f: { id: string }) => f.id === "fast-approval");
    expect(pendingFinding.anchored).toBe(false);

    await coSignOnChainAsAuditor(recordId);
    await request(app).post(`/records/${recordId}/anchor-cosign`).set("Authorization", auth(auditorToken));

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
    await coSignOnChainAsAuditor(recordId);
    await request(app).post(`/records/${recordId}/anchor-cosign`).set("Authorization", auth(auditorToken));

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

  it("keeps a full event history through reject -> revise -> resubmit -> approve -> co-sign", async () => {
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
    await coSignOnChainAsAuditor(recordId);
    await request(app).post(`/records/${recordId}/anchor-cosign`).set("Authorization", auth(auditorToken));

    const eventsRes = await request(app).get(`/records/${recordId}/events`).set("Authorization", auth(qaToken));
    const types = eventsRes.body.map((e: { type: string }) => e.type);
    expect(types).toEqual([
      "CREATED",
      "SUBMITTED",
      "REJECTED",
      "REVISED",
      "SUBMITTED",
      "APPROVED",
      "ANCHOR_PROPOSED",
      "ANCHORED",
    ]);
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

  it("blocks co-signing when there is no pending proposal", async () => {
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

    const coSignRes = await request(app)
      .post(`/records/${recordId}/anchor-cosign`)
      .set("Authorization", auth(auditorToken));
    expect(coSignRes.status).toBe(409);
  });
});
