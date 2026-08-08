import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { app } from "../src/app";
import { loginAs, auth } from "./helpers";
import { createRecordFixture, createCalibrationFixture } from "./fixtures";
import { proposeOnChainAsQA } from "./chainHelpers";

describe("POST /records/:id/cosign - independent co-signing, never trusting the caller", () => {
  let auditorToken: string;

  beforeAll(async () => {
    auditorToken = await loginAs("auditor");
  });

  it("recomputes the expected hash itself, verifies on-chain, and co-signs a genuinely pending proposal", async () => {
    const { record, contentHash } = await createRecordFixture({ anchorProposedBy: "test-operator@pharmachain.test" });
    await proposeOnChainAsQA(record.id, contentHash);

    const res = await request(app).post(`/records/${record.id}/cosign`).set("Authorization", auth(auditorToken));
    expect(res.status).toBe(200);
    expect(res.body.contentHash).toBe(contentHash);
    expect(res.body.txHash).toBeTruthy();
    expect(res.body.alreadyAnchored).toBe(false);
  });

  it("is idempotent - a retry after a successful co-sign reports alreadyAnchored instead of erroring", async () => {
    const { record, contentHash } = await createRecordFixture({ anchorProposedBy: "test-operator@pharmachain.test" });
    await proposeOnChainAsQA(record.id, contentHash);

    const first = await request(app).post(`/records/${record.id}/cosign`).set("Authorization", auth(auditorToken));
    expect(first.status).toBe(200);
    expect(first.body.alreadyAnchored).toBe(false);

    const second = await request(app).post(`/records/${record.id}/cosign`).set("Authorization", auth(auditorToken));
    expect(second.status).toBe(200);
    expect(second.body.alreadyAnchored).toBe(true);
  });

  it("blocks the same identity that proposed it from co-signing, before ever touching the chain", async () => {
    const { record, contentHash } = await createRecordFixture({ anchorProposedBy: "test-auditor@pharmachain.test" });
    await proposeOnChainAsQA(record.id, contentHash);

    const res = await request(app).post(`/records/${record.id}/cosign`).set("Authorization", auth(auditorToken));
    expect(res.status).toBe(403);
  });

  it("surfaces an actionable on-chain error, not a generic 500, when there is no pending proposal to co-sign", async () => {
    // Never proposed on-chain - the row exists in the database (as a real crash could
    // leave one), but AnchorRegistry has no matching pending proposal.
    const { record } = await createRecordFixture({ anchorProposedBy: "test-operator@pharmachain.test" });

    const res = await request(app).post(`/records/${record.id}/cosign`).set("Authorization", auth(auditorToken));
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/no pending proposal/i);
  });

});

describe("POST /equipment/:id/calibration/:calibrationId/cosign", () => {
  let auditorToken: string;

  beforeAll(async () => {
    auditorToken = await loginAs("auditor");
  });

  it("recomputes the calibration's expected hash and co-signs a genuinely pending proposal", async () => {
    const { equipment, calibration, contentHash } = await createCalibrationFixture({ anchorProposedBy: "test-operator@pharmachain.test" });
    await proposeOnChainAsQA(calibration.id, contentHash);

    const res = await request(app)
      .post(`/equipment/${equipment.id}/calibration/${calibration.id}/cosign`)
      .set("Authorization", auth(auditorToken));
    expect(res.status).toBe(200);
    expect(res.body.contentHash).toBe(contentHash);
    expect(res.body.alreadyAnchored).toBe(false);
  });

  it("blocks the same identity that proposed the calibration from co-signing it", async () => {
    const { equipment, calibration, contentHash } = await createCalibrationFixture({ anchorProposedBy: "test-auditor@pharmachain.test" });
    await proposeOnChainAsQA(calibration.id, contentHash);

    const res = await request(app)
      .post(`/equipment/${equipment.id}/calibration/${calibration.id}/cosign`)
      .set("Authorization", auth(auditorToken));
    expect(res.status).toBe(403);
  });

  it("404s for a calibration id that doesn't belong to the given equipment id", async () => {
    const { calibration, contentHash } = await createCalibrationFixture({ anchorProposedBy: "test-operator@pharmachain.test" });
    await proposeOnChainAsQA(calibration.id, contentHash);

    const res = await request(app)
      .post(`/equipment/not-the-right-equipment-id/calibration/${calibration.id}/cosign`)
      .set("Authorization", auth(auditorToken));
    expect(res.status).toBe(404);
  });
});
