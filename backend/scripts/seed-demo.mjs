// Seeds demo batches through the real workflow: operator submits, QA approves (and
// proposes the anchor), the audit service co-signs the findings and the auditor
// co-signs the on-chain anchor. Some batches are fully anchored; others stop at every
// stage (draft, submitted, rejected, approved awaiting co-sign) and include flagged
// approvals, so every screen of the app has something to show.
//
// Batch numbers get the next free sequence number, so it can be re-run after every
// restart (the Hardhat chain starts empty each time).
//
// Usage (backend + audit service + chain running):  npm run seed:demo
import pg from "pg";

const BE = process.env.SEED_BACKEND_URL ?? "http://localhost:4000";
const AU = process.env.SEED_AUDIT_URL ?? "http://localhost:4100";
const PASSWORD = process.env.SEED_PASSWORD ?? "demo1234";

const headers = (t) => ({ "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) });
async function req(base, method, path, token, body) {
  const r = await fetch(base + path, { method, headers: headers(token), body: body ? JSON.stringify(body) : undefined });
  const json = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${method} ${base}${path} -> ${r.status} ${JSON.stringify(json)}`);
  return json;
}
const login = async (base, email) => (await req(base, "POST", "/auth/login", null, { email, password: PASSWORD })).token;

// Each record: [stage, content, target status, options]
//   reviewMin - minutes between submission and the review (default: a normal 15-55 min)
//   reviewer  - "qa" (default) or "admin" (admin has no review history, so the fixed
//               "under a minute" rule applies instead of a personal baseline)
//   reason    - rejection reason, for target REJECTED
const BATCHES = [
  {
    prefix: "AMX", product: "Amoxicillin 250 mg Capsules", plannedQuantity: 80000,
    records: [
      ["Dispensing", { material: "Amoxicillin trihydrate", lotNumber: "API-26-1142", netWeightKg: 28.7, balanceId: "BAL-01" }, "ANCHORED"],
      ["Blending", { lubricant: "Magnesium stearate", blendTimeMin: 20, blendUniformityRsdPct: 1.5 }, "ANCHORED"],
      ["Encapsulation", { capsuleSize: "2", targetFillWeightMg: 340, fillWeightRsdPct: 1.2 }, "ANCHORED"],
      ["Packaging", { packType: "Alu-PVC blister 10x10", blistersSealed: 7980, leakTest: "Pass" }, "ANCHORED"],
    ],
  },
  {
    prefix: "MET", product: "Metformin 500 mg Tablets", plannedQuantity: 150000,
    records: [
      ["Dispensing", { material: "Metformin HCl", lotNumber: "API-26-0915", netWeightKg: 75.0, balanceId: "BAL-02" }, "ANCHORED"],
      ["Granulation", { binder: "Povidone K30", granulationTimeMin: 14, endpointMoisturePct: 2.1 }, "ANCHORED"],
      ["Blending", { lubricant: "Magnesium stearate", blendTimeMin: 12, blendUniformityRsdPct: 1.6 }, "ANCHORED"],
      ["Compression", { targetWeightMg: 650, hardnessKp: 10.2, friabilityPct: 0.3 }, "ANCHORED"],
      ["Film Coating", { coatingWeightGainPct: 2.8, inletTempC: 58 }, "ANCHORED"],
    ],
  },
  {
    prefix: "IBU", product: "Ibuprofen 400 mg Tablets", plannedQuantity: 100000,
    records: [
      ["Dispensing", { material: "Ibuprofen", lotNumber: "API-26-1203", netWeightKg: 40.0, balanceId: "BAL-03" }, "ANCHORED"],
      ["Granulation", { binder: "Starch paste 10%", granulationTimeMin: 10, endpointMoisturePct: 1.9 }, "ANCHORED"],
      ["Compression", { targetWeightMg: 550, hardnessKp: 9.1, friabilityPct: 0.5 }, "ANCHORED"],
      ["Packaging", { packType: "HDPE bottle x100", bottlesFilled: 998, inductionSeal: "Pass" }, "ANCHORED"],
    ],
  },
  {
    // In-progress batch: one record at every stage of the workflow.
    prefix: "ATV", product: "Atorvastatin 20 mg Tablets", plannedQuantity: 120000,
    records: [
      ["Dispensing", { material: "Atorvastatin calcium", lotNumber: "API-26-1310", netWeightKg: 2.6, balanceId: "BAL-01" }, "ANCHORED"],
      ["Granulation", { binder: "HPC-L", granulationTimeMin: 11, endpointMoisturePct: 2.4 }, "ANCHORED", { reviewMin: 0.75 }],
      ["Blending", { lubricant: "Magnesium stearate", blendTimeMin: 15, blendUniformityRsdPct: 1.7 }, "APPROVED"],
      ["Compression", { targetWeightMg: 250, hardnessKp: 7.8, friabilityPct: 0.4 }, "APPROVED", { reviewMin: 0.75 }],
      ["Film Coating", { coatingWeightGainPct: 3.2, inletTempC: 56 }, "SUBMITTED"],
      ["Packaging", { packType: "Alu-Alu blister 10x3", blistersSealed: 3990, leakTest: "Pass" }, "DRAFT"],
    ],
  },
  {
    // Problem batch: an admin rubber-stamp and a QA rejection.
    prefix: "CTZ", product: "Cetirizine 10 mg Tablets", plannedQuantity: 200000,
    records: [
      ["Dispensing", { material: "Cetirizine dihydrochloride", lotNumber: "API-26-1288", netWeightKg: 2.0, balanceId: "BAL-02" }, "ANCHORED", { reviewer: "admin", reviewMin: 0 }],
      ["Granulation", { binder: "Povidone K30", granulationTimeMin: 9, endpointMoisturePct: 4.8 }, "REJECTED",
        { reason: "Endpoint moisture 4.8% exceeds the 3.0% limit - re-dry the granules and resubmit." }],
      ["Blending", { lubricant: "Magnesium stearate", blendTimeMin: 10, blendUniformityRsdPct: 2.1 }, "SUBMITTED"],
      ["Compression", { targetWeightMg: 120, hardnessKp: 6.0, friabilityPct: 0.6 }, "DRAFT"],
    ],
  },
];

const op = await login(BE, "operator@pharmachain.demo");
const qa = await login(BE, "qa@pharmachain.demo");
const admin = await login(BE, "admin@pharmachain.demo");
const aud = await login(BE, "auditor@pharmachain.demo");
const audSvc = await login(AU, "auditor@pharmachain.demo");

const active = (await req(BE, "GET", "/equipment", op)).filter((e) => e.status === "ACTIVE");
const equipmentFor = (i) => (active.length ? active[i % active.length].id : null);
const taken = new Set((await req(BE, "GET", "/batches?pageSize=100", op)).items.map((b) => b.batchNumber));

const now = new Date();
const yymm = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}`;
function nextBatchNumber(prefix) {
  for (let seq = 1; ; seq++) {
    const candidate = `${prefix}-${yymm}-${String(seq).padStart(3, "0")}`;
    if (!taken.has(candidate)) return taken.add(candidate), candidate;
  }
}

// The script itself acts within milliseconds. Before the review happens, move the
// submission back so the reviewer appears to have spent `minutes` on it. This must
// happen *before* approval: approval computes the anomaly findings and anchors their
// hashes, so changing timestamps afterwards would contradict what is on-chain.
const db = new pg.Client({ connectionString: (process.env.DATABASE_URL ?? "").split("?")[0] || undefined });
await db.connect();
// Shifted in SQL rather than by passing JS Dates: the columns are timestamp-without-
// time-zone holding UTC, and node-pg would write a Date in the machine's local time.
async function backdateSubmission(id, minutes) {
  const shift = `make_interval(secs => $2::float8 * 60)`;
  const created = `make_interval(secs => ($2::float8 + 12) * 60)`;
  await db.query(`UPDATE "ManufacturingRecord" SET "submittedAt" = "submittedAt" - ${shift}, "createdAt" = "createdAt" - ${created} WHERE id = $1`, [id, minutes]);
  await db.query(`UPDATE "RecordEvent" SET "createdAt" = "createdAt" - ${shift} WHERE "recordId" = $1 AND type = 'SUBMITTED'`, [id, minutes]);
  await db.query(`UPDATE "RecordEvent" SET "createdAt" = "createdAt" - ${created} WHERE "recordId" = $1 AND type = 'CREATED'`, [id, minutes]);
}

let n = 0;
try {
  // SEED_ONLY=ATV,CTZ seeds just those batch prefixes
  const only = process.env.SEED_ONLY?.split(",").map((p) => p.trim().toUpperCase());
  for (const b of BATCHES.filter((b) => !only || only.includes(b.prefix))) {
    const batchNumber = nextBatchNumber(b.prefix);
    const batch = await req(BE, "POST", "/batches", op, { batchNumber, product: b.product, plannedQuantity: b.plannedQuantity });
    console.log(`${batchNumber}  ${b.product}`);
    for (const [i, [stage, content, target, opts = {}]] of b.records.entries()) {
      const { id } = await req(BE, "POST", "/records", op, { batchId: batch.id, stage, equipmentId: equipmentFor(i), content });
      if (target !== "DRAFT") {
        await req(BE, "POST", `/records/${id}/submit`, op);
        if (target !== "SUBMITTED") {
          const reviewMin = opts.reviewMin ?? 15 + ((n * 17) % 41);
          if (reviewMin > 0) await backdateSubmission(id, reviewMin);
          const reviewer = opts.reviewer === "admin" ? admin : qa;
          if (target === "REJECTED") {
            await req(BE, "POST", `/records/${id}/reject`, reviewer, { reason: opts.reason });
          } else {
            await req(BE, "POST", `/records/${id}/approve`, reviewer);
          }
        }
        if (target === "ANCHORED") {
          await req(AU, "POST", `/records/${id}/cosign`, audSvc);
          await req(BE, "POST", `/records/${id}/anchor-cosign`, aud);
          const v = await req(BE, "GET", `/records/${id}/verify`, aud);
          if (!v.matches) throw new Error(`${batchNumber} ${stage}: anchored but does not verify against the chain`);
        }
      }
      const rec = await req(BE, "GET", `/records/${id}`, aud);
      if (rec.status !== target) throw new Error(`${batchNumber} ${stage}: expected ${target}, got ${rec.status}`);
      const flags = rec.anomalies.map((a) => a.label).join("; ");
      console.log(`  ${stage.padEnd(13)} ${rec.status.padEnd(9)} ${flags ? "WARNING: " + flags : ""}`);
      n++;
    }
  }
} finally {
  await db.end();
}
console.log(`Done: ${n} records.`);
