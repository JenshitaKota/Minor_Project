import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { Contract, JsonRpcProvider } from "ethers";
import { app } from "../src/app";
import { prisma } from "../src/db/client";
import { getReviewerBaseline } from "../src/anomaly/baseline";
import { recordIdToBytes32 } from "../src/chain/hash";
import abi from "../src/chain/AnchorRegistry.abi.json";
import { loginAs, auth, uniqueId } from "./helpers";
import { coSignOnChainAsAuditor } from "./chainHelpers";

function readContract() {
  return new Contract(process.env.CONTRACT_ADDRESS as string, abi, new JsonRpcProvider(process.env.RPC_URL));
}

async function pendingOnChain(recordId: string) {
  const pending = await readContract().getPendingAnchor(recordIdToBytes32(recordId));
  return { contentHash: pending.contentHash as string, findingHashes: [...pending.findingHashes] as string[] };
}

describe("anchor integrity", () => {
  let adminToken: string;
  let operatorToken: string;
  let auditorToken: string;

  beforeAll(async () => {
    adminToken = await loginAs("admin");
    operatorToken = await loginAs("operator");
    auditorToken = await loginAs("auditor");
  });

  /** A QA reviewer with no review history - their instant test approvals always trip
   * the fallback fast-approval rule, so every approval carries at least one finding. */
  async function freshReviewer() {
    const email = `${uniqueId("qa")}@pharmachain.test`.toLowerCase();
    const res = await request(app)
      .post("/users")
      .set("Authorization", auth(adminToken))
      .send({ email, password: "demo1234", name: "Fresh QA", role: "QA_MANAGER" });
    expect(res.status).toBe(201);
    const login = await request(app).post("/auth/login").send({ email, password: "demo1234" });
    return { email, token: login.body.token as string };
  }

  async function submittedRecord() {
    const batchRes = await request(app)
      .post("/batches")
      .set("Authorization", auth(operatorToken))
      .send({ batchNumber: uniqueId("BATCH"), product: "Test Product", plannedQuantity: 1000 });
    const createRes = await request(app)
      .post("/records")
      .set("Authorization", auth(operatorToken))
      .send({ batchId: batchRes.body.id, stage: "Mixing", content: { observedQuantity: 990 } });
    await request(app).post(`/records/${createRes.body.id}/submit`).set("Authorization", auth(operatorToken));
    return createRes.body.id as string;
  }

  it("keeps a past decision's reviewer baseline fixed when an earlier rejected record is revised and re-reviewed", async () => {
    const reviewer = await freshReviewer();

    const recordA = await submittedRecord();
    await request(app)
      .post(`/records/${recordA}/reject`)
      .set("Authorization", auth(reviewer.token))
      .send({ reason: "needs fixing" });

    const recordB = await submittedRecord();
    await request(app).post(`/records/${recordB}/approve`).set("Authorization", auth(reviewer.token));
    const { reviewedAt } = await prisma.manufacturingRecord.findUniqueOrThrow({ where: { id: recordB } });

    const before = await getReviewerBaseline(prisma, reviewer.email, reviewedAt!);
    // Only A's rejection precedes B's approval - B's own decision is excluded.
    expect(before.sampleSize).toBe(1);

    // Revising and re-reviewing A overwrites its submittedAt/reviewedAt on the record
    // row; B's baseline must not move, or B's anchored findings would stop verifying.
    await request(app)
      .patch(`/records/${recordA}`)
      .set("Authorization", auth(operatorToken))
      .send({ content: { observedQuantity: 995 } });
    await request(app).post(`/records/${recordA}/submit`).set("Authorization", auth(operatorToken));
    await request(app).post(`/records/${recordA}/approve`).set("Authorization", auth(reviewer.token));

    const after = await getReviewerBaseline(prisma, reviewer.email, reviewedAt!);
    expect(after).toEqual(before);
  });

  it("still refuses to re-propose while the pending proposal is co-signable", async () => {
    const reviewer = await freshReviewer();
    const recordId = await submittedRecord();
    await request(app).post(`/records/${recordId}/approve`).set("Authorization", auth(reviewer.token));

    const res = await request(app).post(`/records/${recordId}/anchor`).set("Authorization", auth(reviewer.token));
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already proposed/);
  });

  it("replaces a proposal whose findings went stale, logging the withdrawn findings on-chain", async () => {
    const reviewer = await freshReviewer();
    const recordId = await submittedRecord();
    const approveRes = await request(app).post(`/records/${recordId}/approve`).set("Authorization", auth(reviewer.token));
    expect(approveRes.status).toBe(200);

    const original = await pendingOnChain(recordId);
    expect(original.findingHashes.length).toBeGreaterThan(0);

    // Shift submittedAt without touching content: the finding hashes (which commit to
    // the duration) change, the content hash does not.
    const record = await prisma.manufacturingRecord.findUniqueOrThrow({ where: { id: recordId } });
    await prisma.manufacturingRecord.update({
      where: { id: recordId },
      data: { submittedAt: new Date(record.submittedAt!.getTime() - 1000) },
    });

    const reproposeRes = await request(app)
      .post(`/records/${recordId}/anchor`)
      .set("Authorization", auth(reviewer.token));
    expect(reproposeRes.status).toBe(200);

    const replacement = await pendingOnChain(recordId);
    expect(replacement.contentHash).toBe(original.contentHash);
    expect(replacement.findingHashes).not.toEqual(original.findingHashes);

    // The withdrawal is public: the full withdrawn package is in the event log.
    const contract = readContract();
    const cancelled = await contract.queryFilter(contract.filters.AnchorProposalCancelled(recordIdToBytes32(recordId)));
    expect(cancelled).toHaveLength(1);
    const args = (cancelled[0] as unknown as { args: { findingHashes: string[] } }).args;
    expect([...args.findingHashes]).toEqual(original.findingHashes);

    const eventsRes = await request(app).get(`/records/${recordId}/events`).set("Authorization", auth(adminToken));
    const reproposed = eventsRes.body.filter((e: { type: string; detail: string | null }) => e.type === "ANCHOR_PROPOSED");
    expect(reproposed.at(-1).detail).toContain(original.findingHashes[0]);

    // The replacement is co-signable and finalizes normally.
    await coSignOnChainAsAuditor(recordId);
    const confirmRes = await request(app)
      .post(`/records/${recordId}/anchor-cosign`)
      .set("Authorization", auth(auditorToken));
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.status).toBe("ANCHORED");
  });

  it("refuses to re-propose when the record's content changed after approval", async () => {
    const reviewer = await freshReviewer();
    const recordId = await submittedRecord();
    await request(app).post(`/records/${recordId}/approve`).set("Authorization", auth(reviewer.token));
    const original = await pendingOnChain(recordId);

    // A direct DB edit after approval - exactly what must never get anchored.
    await prisma.manufacturingRecord.update({
      where: { id: recordId },
      data: { content: { observedQuantity: 1 } },
    });

    const res = await request(app).post(`/records/${recordId}/anchor`).set("Authorization", auth(reviewer.token));
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/content has changed/);

    // The original proposal - the evidence of what was approved - is untouched.
    expect(await pendingOnChain(recordId)).toEqual(original);
  });
});
