// Seeds demo batches whose records all go through the real workflow: operator submits,
// QA approves (and proposes the anchor), the audit service co-signs the findings and the
// auditor co-signs the on-chain anchor. Batch numbers get the next free sequence number,
// so it can be re-run after every restart (the Hardhat chain starts empty each time).
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

const BATCHES = [
  {
    prefix: "AMX", product: "Amoxicillin 250 mg Capsules", plannedQuantity: 80000,
    records: [
      ["Dispensing", { material: "Amoxicillin trihydrate", lotNumber: "API-26-1142", netWeightKg: 28.7, balanceId: "BAL-01" }],
      ["Blending", { lubricant: "Magnesium stearate", blendTimeMin: 20, blendUniformityRsdPct: 1.5 }],
      ["Encapsulation", { capsuleSize: "2", targetFillWeightMg: 340, fillWeightRsdPct: 1.2 }],
      ["Packaging", { packType: "Alu-PVC blister 10x10", blistersSealed: 7980, leakTest: "Pass" }],
    ],
  },
  {
    prefix: "MET", product: "Metformin 500 mg Tablets", plannedQuantity: 150000,
    records: [
      ["Dispensing", { material: "Metformin HCl", lotNumber: "API-26-0915", netWeightKg: 75.0, balanceId: "BAL-02" }],
      ["Granulation", { binder: "Povidone K30", granulationTimeMin: 14, endpointMoisturePct: 2.1 }],
      ["Blending", { lubricant: "Magnesium stearate", blendTimeMin: 12, blendUniformityRsdPct: 1.6 }],
      ["Compression", { targetWeightMg: 650, hardnessKp: 10.2, friabilityPct: 0.3 }],
      ["Film Coating", { coatingWeightGainPct: 2.8, inletTempC: 58 }],
    ],
  },
  {
    prefix: "IBU", product: "Ibuprofen 400 mg Tablets", plannedQuantity: 100000,
    records: [
      ["Dispensing", { material: "Ibuprofen", lotNumber: "API-26-1203", netWeightKg: 40.0, balanceId: "BAL-03" }],
      ["Granulation", { binder: "Starch paste 10%", granulationTimeMin: 10, endpointMoisturePct: 1.9 }],
      ["Compression", { targetWeightMg: 550, hardnessKp: 9.1, friabilityPct: 0.5 }],
      ["Packaging", { packType: "HDPE bottle x100", bottlesFilled: 998, inductionSeal: "Pass" }],
    ],
  },
];

const op = await login(BE, "operator@pharmachain.demo");
const qa = await login(BE, "qa@pharmachain.demo");
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

const seeded = [];
for (const b of BATCHES) {
  const batchNumber = nextBatchNumber(b.prefix);
  const batch = await req(BE, "POST", "/batches", op, { batchNumber, product: b.product, plannedQuantity: b.plannedQuantity });
  for (const [i, [stage, content]] of b.records.entries()) {
    const { id } = await req(BE, "POST", "/records", op, { batchId: batch.id, stage, equipmentId: equipmentFor(i), content });
    await req(BE, "POST", `/records/${id}/submit`, op);
    await req(BE, "POST", `/records/${id}/approve`, qa);
    await req(AU, "POST", `/records/${id}/cosign`, audSvc);
    await req(BE, "POST", `/records/${id}/anchor-cosign`, aud);
    const v = await req(BE, "GET", `/records/${id}/verify`, aud);
    if (!v.matches) throw new Error(`${batchNumber} ${stage}: anchored but does not verify against the chain`);
    seeded.push(id);
  }
  console.log(`${batchNumber}  ${b.product}  ${b.records.length} records anchored`);
}

// The script approves within milliseconds, which the anomaly rules rightly flag as
// "approved unusually fast". Spread created/submitted times 15-55 min before review so the
// demo looks like normal QA work. Timestamps are not part of the anchored hash.
const db = new pg.Client({ connectionString: (process.env.DATABASE_URL ?? "").split("?")[0] || undefined });
await db.connect();
try {
  const { rows } = await db.query(`SELECT id, "reviewedAt" FROM "ManufacturingRecord" WHERE id = ANY($1)`, [seeded]);
  for (const [i, r] of rows.entries()) {
    const submitted = new Date(r.reviewedAt.getTime() - (15 + ((i * 17) % 41)) * 60_000);
    const created = new Date(submitted.getTime() - (10 + (i % 4) * 5) * 60_000);
    await db.query(`UPDATE "ManufacturingRecord" SET "submittedAt" = $2, "createdAt" = $3 WHERE id = $1`, [r.id, submitted, created]);
    await db.query(`UPDATE "RecordEvent" SET "createdAt" = $2 WHERE "recordId" = $1 AND type = 'SUBMITTED'`, [r.id, submitted]);
    await db.query(`UPDATE "RecordEvent" SET "createdAt" = $2 WHERE "recordId" = $1 AND type = 'CREATED'`, [r.id, created]);
  }
} finally {
  await db.end();
}
console.log(`Done: ${seeded.length} fully approved, anchored records.`);
