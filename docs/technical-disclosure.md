# Invention Disclosure — Cryptographically Bound Data and Review-Process Integrity for Regulated Manufacturing Records

**Status:** Draft technical disclosure for submission to a university technology-transfer office and/or a patent attorney. This document is not legal advice and does not constitute a filed patent application. It is written to give a patent professional the technical substance needed to run a formal prior-art search and draft claims.

**Prepared:** 2026-08-04 (revised 2026-08-05, 2026-08-08)
**System name (working title):** PharmaChain Integrity
**Reduction to practice:** Working implementation, tested end-to-end (contract, backend, frontend), in the project repository. Implementing commits: `b0b3a5bf0da8269b6b642d12b314167ce061cb24` ("Anchor anomaly findings on-chain, baselined per-reviewer"), 2026-08-04, `2a22170637668ee3739e7e11cf195c46e38bcb30` ("Require independent multi-party co-signature for every anchor"), 2026-08-05, which added the multi-party attestation mechanism described in §4.6, and `f42d8ca` ("Anchor equipment calibration state via the same multi-party propose/co-sign mechanism"), 2026-08-08, which added the equipment-state anchoring element described in §4.7.

---

## 1. Field of the Invention

This disclosure concerns systems for ensuring the integrity of regulated manufacturing records (e.g., pharmaceutical Good Manufacturing Practice / GxP batch records) using blockchain-anchored cryptographic hashing, and more specifically to a method of making the *review/approval process itself* — not only the underlying data — tamper-evident, by statistically baselining reviewer behavior per individual and anchoring the resulting anomaly verdicts on-chain at the moment of detection.

## 2. Background and Problem Statement

Blockchain-based integrity systems for pharmaceutical and other regulated manufacturing data generally take one of two forms:

1. **Chain-of-custody / track-and-trace systems** (e.g., the MediLedger Network, live since 2017, built on Hyperledger Fabric, used by 27+ manufacturers for U.S. Drug Supply Chain Security Act compliance) record *ownership and transfer* of packaged goods between supply-chain parties. They do not address the integrity of the manufacturing record itself, nor the integrity of the human review/approval process that produced it.

2. **Data-hash anchoring systems**, including published academic work (e.g., "Blockchain for Data Originality in Pharma Manufacturing," *Journal of Pharmaceutical Innovation*, 2023) hash manufacturing/sensor data and anchor the hash on a private blockchain, later re-hashing and comparing to detect tampering of the *data*. This is the same general pattern used by earlier blockchain-timestamping/notarization systems (e.g., Factom, OpenTimestamps, ~2014–2016) applied to a new domain.

Neither category addresses a distinct, practically important failure mode: **the review/approval decision surrounding a record can itself be compromised or falsified — e.g., a QA reviewer rubber-stamping an approval without a genuine review, or an approval occurring outside supervised conditions — and today, the *evidence of that anomaly* exists only as a live computation over mutable database fields.** An actor with direct database access (a privileged insider, a compromised admin account, or a supply-chain attacker) can alter the record's `reviewedAt`/`submittedAt` timestamps, or the anomaly-detection logic's inputs, after the fact, with no independent, immutable trace that a specific anomaly was ever flagged. The underlying manufacturing data may be hash-anchored and therefore provably unmodified, while the *fact that its review looked suspicious* is trivially erasable.

Separately, existing anomaly/fraud-detection approaches for approval timing (broadly, "user behavior analytics" in security contexts) typically apply a single fixed threshold globally (e.g., "flag any approval faster than 60 seconds") rather than a threshold calibrated to each individual reviewer's own established working pattern — producing both false positives (a naturally fast, careful reviewer) and false negatives (a normally slow reviewer whose unusually fast approval, while still "slow" by a global constant, is a meaningful behavioral outlier *for that person*).

## 3. Summary of the Invention

The invention combines, in a single system, four elements that are individually known in isolated form but not, to the inventors' knowledge, combined in this way for this problem:

**(a)** Anchoring of manufacturing-record content hashes on a blockchain smart contract, keyed by record identifier, with revert-on-reanchor protection (known technique, prior art exists).

**(b)** A statistical, per-reviewer behavioral baseline for approval timing: for a given reviewer, the mean and standard deviation of their own historical approval durations (time between record submission and review decision) is computed from records they previously reviewed, and a new approval is flagged as anomalous only if it is a statistical outlier (z-score below a threshold) *relative to that reviewer's own distribution*, rather than against one global constant. Critically, this baseline is **time-bounded to reviews strictly preceding the decision being judged**, so that the same finding is deterministically reproducible at any later point in time regardless of the reviewer's subsequent activity (see §4.3).

**(c)** Anchoring the resulting anomaly *verdict* — not merely the record's content hash — on the same blockchain smart contract, as its own immutable event, at the moment of detection (i.e., at approval time), cryptographically derived from a canonical hash of the finding's full reasoning (which rule fired, the reviewer, the timestamps, the duration, and the baseline statistics used to reach the verdict). This produces a chain of evidence binding **what the data says** (content-hash anchor) and **how it was reviewed** (anomaly-finding anchor) into one tamper-evident system, in one contract, such that neither can be altered or suppressed without an on-chain, publicly-auditable trace — including by a party with full administrative access to the underlying database.

**(d)** Requiring **two independent attestors** — not a single authority — to jointly confirm every anchor operation via an on-chain propose/co-sign pattern, with the smart contract itself enforcing that the co-signer is not the same party who proposed. This removes the single point of trust that would otherwise undermine (a)–(c): without it, whoever controls the one anchoring key could unilaterally withhold an anchor, or the underlying backend could collude with whoever altered the data, defeating the purpose of anchoring anything at all (see §4.6).

This combination directly addresses a gap that exists in both the chain-of-custody category and the data-hash-anchoring category of prior art: neither anchors a *process-integrity* verdict, neither uses individualized statistical baselining fused with immutable anchoring of the verdict itself, and neither requires independent multi-party confirmation of the anchor operation itself (MediLedger's multi-organization consensus operates at the network/ledger level between organizations, not as an explicit propose/co-sign requirement enforced per anchoring transaction within a single smart contract).

## 4. Detailed Description

### 4.1 System Architecture

The reference implementation (Node.js/Express/Prisma/PostgreSQL backend, React frontend, Solidity smart contract deployed via Foundry/Hardhat to an EVM-compatible chain) models a manufacturing record workflow: `DRAFT → SUBMITTED → APPROVED → ANCHORED` (with `REJECTED`/revision loops), where:

- An **operator** creates and submits a record.
- A **QA reviewer** approves or rejects a submitted record.
- On approval, the system (i) computes a canonical content hash of the record and anchors it on-chain (prior-art-adjacent mechanism, §4.2), and (ii) evaluates the review decision for behavioral anomalies against the reviewer's own baseline and anchors any resulting findings on-chain (the novel contribution, §4.3–4.4).

### 4.2 Content-Hash Anchoring (baseline mechanism, not itself claimed as novel)

`AnchorRegistry.sol` stores, per record identifier (`bytes32`, derived from `keccak256` of the record's UUID), a struct `{contentHash, timestamp, anchoredBy}`. `anchorRecord(recordId, contentHash)` reverts if the record identifier was already anchored, preventing silent re-pointing. `verifyRecord(recordId, contentHash)` allows any party to recompute a fresh hash from current data and compare it against what was anchored, returning `(anchored, matches, timestamp)`.

### 4.3 Per-Reviewer Statistical Baseline (novel element)

For a reviewer identified by `reviewerEmail`, and a decision made at time `reviewedAt`, the system queries all prior records reviewed by that same reviewer with `reviewedAt < <the current decision's reviewedAt>` (strict, time-bounded — see rationale below), computes the population mean (`meanMs`) and standard deviation (`stdDevMs`) of `(reviewedAt − submittedAt)` durations across that history, and, given a minimum sample size (reference implementation: 5), computes:

```
z = (durationMs − meanMs) / stdDevMs
```

flagging the current decision as anomalous (`fast-approval`) if `z ≤ −1.5` (reference threshold; approvals unusually fast *for that specific reviewer*). Below the minimum sample size, or when `stdDevMs = 0` (degenerate case, e.g. a reviewer with identical historical durations), the system falls back to a fixed absolute threshold (reference implementation: 60 seconds).

**Time-bounding rationale (a specific, non-obvious design choice):** the query is bounded to reviews *strictly before* the decision being evaluated, not merely "all history excluding this record." Without this bound, re-deriving the same finding's hash at a later date — after the reviewer has completed additional, subsequent reviews — would silently produce a different baseline (mean/stddev drift from future data), and therefore a different hash, making a legitimately anchored finding falsely appear unverifiable, indistinguishable from tampering. The time bound is what makes the anchored finding **permanently and deterministically re-derivable**, which is required for the finding to function as durable evidence.

A second detection rule, `off-hours-approval` (fixed business-hours/weekend boundary), is retained as a global, non-personalized compliance rule, since it represents an absolute regulatory boundary (was the review conducted during supervised hours) rather than an individual behavioral pattern — illustrating that the system selectively applies individualized baselining only where behaviorally appropriate.

### 4.4 On-Chain Anchoring of the Anomaly Verdict Itself (novel element)

`AnchorRegistry.sol` is extended with a second mapping, `bytes32 recordId ⟶ AnomalyFinding[]`, where each `AnomalyFinding` is `{findingHash, timestamp}`. `anchorAnomalyFinding(recordId, findingHash)` appends a finding, reverting if that exact `findingHash` was already anchored for that record (idempotency guard against retries), and emits `AnomalyFindingAnchored`.

`findingHash` is a `keccak256` digest of a canonical JSON structure comprising: the record identifier, the specific anomaly rule that fired (e.g. `"fast-approval"`), the reviewer's identity, the submission and review timestamps, the computed duration, and the full baseline statistics (`sampleSize`, `meanMs`, `stdDevMs`) used to reach the verdict — i.e., the hash commits to the *entire reasoning chain* behind the finding, not merely its existence or its label. This means the finding cannot be selectively re-labeled or have its supporting statistics altered without producing a hash mismatch against the anchored value, exactly analogous to how the content-hash anchor (§4.2) detects tampering of record data.

Both anchors are stored in the **same contract** and, in the reference implementation, are both written during the same approval transaction sequence — deliberately unifying data-integrity and process-integrity evidence under one on-chain authority rather than two independently-trusted systems.

A read endpoint recomputes the current, reproducible finding (per §4.3's time-bounding property) and cross-references its hash against what is anchored on-chain, allowing any party to independently verify "this specific behavioral anomaly was flagged and has been immutable since block timestamp T" — including verification by an auditor with no access to (or trust in) the underlying database.

### 4.5 Worked Example (from the reference implementation's test suite)

A reviewer with a historical mean approval time of 30 minutes and a standard deviation of 2 minutes (sample size ≥ 5) approves a new record in 25 minutes. This is far outside any fixed global threshold (e.g., "flag anything under 60 seconds") and would not be flagged by a conventional fixed-threshold system. Under the disclosed method, `z = (25×60000 − 30×60000) / (2×60000) = −2.5`, which is below the `−1.5` threshold, and the approval is correctly flagged as anomalous *for that specific reviewer* — demonstrating detection of a class of anomaly that fixed-threshold systems cannot express.

### 4.6 Multi-Party Attestation for Every Anchor Operation (novel element)

Sections 4.2–4.4 describe *what* gets anchored (content hash, anomaly findings) but not *who* is trusted to anchor it. In the initial reduction to practice, a single `Ownable` owner key held that authority exclusively — meaning whoever controlled that one key (or the backend process holding it) could unilaterally decide what got anchored, or refuse to anchor a record that should show tampering, with no independent check. This directly undercuts the value of §4.2–4.4: an immutable ledger is only as trustworthy as the process that writes to it.

`AnchorRegistry.sol` replaces the single `onlyOwner` anchor call with a two-step, two-party protocol:

- `proposeAnchor(recordId, contentHash, findingHashes)` — callable only by a registered **attestor** (`isAttestor[msg.sender]`), stores a `PendingAnchor{contentHash, findingHashes, proposedBy, proposedAt}`. This does not anchor anything; it records an intent.
- `coSignAnchor(recordId, contentHash, findingHashes)` — callable only by a registered attestor, requires the resupplied `contentHash`/`findingHashes` to exactly match the pending proposal (the co-signer is independently confirming the specific package, not blindly trusting it), and **requires `msg.sender != pending.proposedBy`** — the core guarantee. Only on success does the content hash and every bundled anomaly finding become permanently anchored, atomically, in one transaction.
- Attestor set membership (`addAttestor`/`removeAttestor`) remains owner-governed — a materially smaller trust surface than the owner directly controlling every anchoring decision, and flagged in §7 as a further-reducible surface (e.g., via decentralized attestor-set governance).

In the reference deployment, this maps directly onto the application's existing role model rather than an invented abstraction: a QA reviewer's approval action calls `proposeAnchor` (via a `QA_ATTESTOR` key), and a **different**, independent **Auditor**'s review action calls `coSignAnchor` (via a separate `AUDITOR_ATTESTOR` key) — the application layer additionally enforces that the same *individual human* (by identity, not just by role-key) cannot occupy both positions for the same record, even where a single role (e.g., an administrative override role) is technically permitted to invoke either endpoint.

**Honest scope limitation, stated directly:** in the current reference deployment, both attestor private keys are configured on the same backend process. The guarantee actually provided today is *"two distinct cryptographic signatures, from two distinct keys, are required to anchor anything"* — which already defeats a single-key compromise and enforces application-level separation of duties — but not yet *"two independently operated systems, outside either party's unilateral control, are required."* A fully compromised backend process still holds both keys. Realizing the stronger guarantee is an operational deployment change, not a protocol change: the Auditor's key should be held and operated by a system outside the manufacturer's control (e.g., an independent audit service authenticating its own operator), a change the propose/co-sign contract interface already supports without modification.

### 4.7 Equipment-State Anchoring (novel element, reduced to practice)

Sections 4.2–4.6 establish that a manufacturing record's *content* and *review process* can each be made tamper-evident and require independent multi-party confirmation to anchor. A record's integrity claim is only as strong as the state of the physical equipment used to produce it, however: today, "was equipment X properly calibrated and active at the time record Y was created" is typically a separately-trusted, mutable database field (an equipment status column, updatable by a single actor with no independent confirmation and no immutable trace of when or by whom it changed) — the same class of gap §2 identifies for review-approval data, but for equipment state instead of reviewer behavior.

This element closes that gap by routing equipment calibration events through the **identical** propose/co-sign mechanism of §4.6, on the **same** `AnchorRegistry` contract, with **no contract modification whatsoever** — a direct consequence of `proposeAnchor`/`coSignAnchor` taking a generic `bytes32 recordId` with no manufacturing-record-specific meaning. A calibration event's identifier is simply `keccak256` of the calibration record's UUID, exactly as for a manufacturing record.

Concretely: a technician logs a calibration (certificate number, technician identity, calibration date, next-due date), which computes a canonical content hash and calls `proposeAnchor` (application layer: an `OPERATOR`/`ADMIN` action). The equipment's status is set to `MAINTENANCE` and **remains there** — it is not usable for new manufacturing records requiring active equipment — until a second, independent party calls `coSignAnchor` (application layer: an `AUDITOR`/`ADMIN` action, with the same same-individual exclusion enforced at the application layer as in §4.6). Only upon successful co-signature does the calibration become permanently anchored and the equipment's status transition to `ACTIVE`, atomically with the anchor. A read endpoint recomputes the calibration's current hash and cross-references it against the anchored value, in the same pattern as §4.2 and §4.4.

The consequence for the overall system's integrity claim: a manufacturing record's provable chain — content hash (§4.2), review-process anomaly verdict (§4.3–4.4), both requiring independent multi-party confirmation (§4.6) — can now be extended to include a fourth, independently-verifiable fact using the same evidentiary infrastructure: the equipment used was, at the time, in a calibration state that had itself passed independent multi-party confirmation, not merely a status flag one actor could set unilaterally. This is presented as a reduction to practice of the embodiment previously only contemplated in §7 of the 2026-08-05 revision of this disclosure — demonstrating, as a point relevant to non-obviousness, that the same propose/co-sign primitive generalizes across distinct classes of state (data-review verdicts, equipment lifecycle transitions) without protocol-level changes, which is itself evidence that the multi-party anchoring mechanism of §4.6 is a general-purpose integrity primitive rather than a special-case mechanism narrowly fitted to the review-anomaly use case of §4.3–4.4.

## 5. Novel Aspects vs. Identified Prior Art

| | MediLedger (custody chain) | Academic data-hash anchoring (2023) | Generic "blockchain audit trail" products | Generic UEBA / behavioral fraud detection | **This disclosure** |
|---|---|---|---|---|---|
| Anchors manufacturing record content hash | No (custody only) | Yes | N/A | No | Yes |
| Anchors the *review-process anomaly verdict itself* | No | No | Anchors generic log/audit entries, not derived statistical verdicts | No (verdict stored in mutable system) | **Yes** |
| Per-individual statistical behavioral baseline | No | No | No | Yes (but not anchored, not this domain) | **Yes** |
| Baseline is time-bounded for permanent reproducibility | N/A | N/A | N/A | Not typically a design concern | **Yes** |
| Data integrity and process integrity bound in one evidentiary chain | No | No | No | No | **Yes** |
| Applied to GxP pharmaceutical manufacturing review workflow specifically | Partially (supply chain, not manufacturing review) | Partially (sensor data, not review behavior) | No | No | **Yes** |
| Every anchor requires two independent attestors, enforced on-chain (proposer ≠ co-signer) | No (multi-org consensus at network level, not per-transaction) | No (single anchoring key) | No | No | **Yes** |
| Physical equipment/asset lifecycle state (e.g., calibration) requires the same independent multi-party confirmation before use, using the same generic anchoring primitive as data/process integrity | No | No | No | No | **Yes** |

No single row above is independently novel; the disclosed **combination**, applied to this specific problem, is the claimed contribution.

## 6. Draft Claim Language (for attorney refinement — not final)

**Independent claim (system):**

A computer-implemented system for verifying the integrity of regulated manufacturing records, comprising: (a) a data store recording, for each manufacturing record, a content value, a submission timestamp, a review timestamp, and an identifier of the reviewing party; (b) a processor configured to, for a given review decision, compute a statistical baseline of review-duration values for prior review decisions made by the same reviewing party, said prior decisions being bounded to those occurring strictly before the review timestamp of the given decision; (c) the processor further configured to determine, using said baseline, whether the given review decision is anomalous relative to the reviewing party's own historical behavior; (d) a blockchain-based smart contract configured to store, for a given record identifier, both (i) a cryptographic hash of the record's content, and (ii) a cryptographic hash representing the anomaly determination and its supporting statistical basis, each independently and immutably verifiable against the underlying data.

**Dependent claims (illustrative):**

- Wherein the statistical baseline comprises a mean and standard deviation of prior review durations, and the anomaly determination comprises a z-score comparison against a threshold.
- Wherein the anomaly determination falls back to a fixed threshold when the number of prior review decisions is below a minimum sample size.
- Wherein the cryptographic hash of the anomaly determination is computed over a canonical representation including the record identifier, the reviewing party's identity, the review and submission timestamps, the computed duration, and the statistical baseline values.
- Wherein the content hash and the anomaly-determination hash are stored by the same smart contract.
- Wherein the smart contract reverts an attempt to anchor an anomaly-determination hash identical to one already stored for the same record identifier.
- Wherein the smart contract requires a first party to propose the content hash and anomaly-determination hash as a package, and a second, distinct party to independently confirm the identical package before either is permanently stored, the contract rejecting confirmation by the same party that proposed it.
- Wherein confirmation requires the second party to resupply the content hash and anomaly-determination hash, the contract rejecting confirmation if the resupplied values do not exactly match the proposed package.
- Wherein the same propose/confirm mechanism, using a generic record identifier not specific to any single data type, is applied to anchor a lifecycle-state transition of a physical asset used in producing a manufacturing record, such that the asset's state is not made available for use in producing further records until independently confirmed by a second, distinct party.

## 7. Alternative / Contemplated Embodiments (not yet implemented)

For claim-breadth purposes, the following are contemplated extensions consistent with the same inventive concept, and were discussed during development but are not part of the current reduction to practice:

- **Zero-knowledge proof verification**: a public party could verify "this record's data is unmodified and its review process passed integrity checks" without the system revealing the underlying manufacturing content (formulas, quantities, supplier identities) — addressing a limitation shared by both the custody-chain and data-hash-anchoring prior art, neither of which supports privacy-preserving public verification.
- **Additional behavioral baseline dimensions**: per-reviewer baselining of other decision attributes (e.g., rejection rate, time-of-day pattern) beyond approval duration, using the same time-bounded reproducibility principle.
- **Independently-operated attestor keys**: operating the two attestor keys described in §4.6 on genuinely separate systems (e.g., the Auditor's key held by a system outside the manufacturer's control, gated by that Auditor's own authentication) rather than both being configured on one backend process, closing the residual scope limitation noted in §4.6.
- **Decentralized attestor-set governance**: replacing the owner-controlled `addAttestor`/`removeAttestor` functions (§4.6) with a voting or multi-signature governance mechanism, removing the one remaining centralized control point (who may attest, as opposed to what gets anchored).
- **M-of-N attestation**: generalizing the two-party propose/co-sign protocol to require confirmation from M of N registered attestors for M, N > 2, for deployments involving more than two independent parties (e.g., manufacturer, auditor, and regulator).

## 8. Evidence of Reduction to Practice

- Repository commit `b0b3a5bf0da8269b6b642d12b314167ce061cb24`, dated 2026-08-04, implements the system described in §4.1–4.5: `contracts/contracts/AnchorRegistry.sol` (smart contract), `backend/src/anomaly/baseline.ts` (statistical baseline), `backend/src/anomaly/rules.ts` (baseline-aware anomaly evaluation), `backend/src/routes/records.ts` (approval-flow wiring and read endpoint), `frontend/src/components/RecordDetail.tsx` (verification UI).
- Repository commit `2a22170637668ee3739e7e11cf195c46e38bcb30`, dated 2026-08-05, implements the multi-party attestation mechanism described in §4.6: the propose/co-sign rewrite of `AnchorRegistry.sol`, the two-attestor-key backend wiring (`backend/src/chain/anchorRegistry.ts`), the `POST /records/:id/anchor-cosign` endpoint and updated approval flow (`backend/src/routes/records.ts`), and the pending-co-signature UI (`frontend/src/components/RecordDetail.tsx`).
- Automated test coverage as of the second commit: 19 Foundry contract tests (including propose/co-sign success, same-attestor-rejection, mismatched-package-rejection, and non-attestor-rejection cases), 34 backend tests (including a full propose → blocked self-co-sign → independent co-sign → verify integration test), 28 frontend tests (including role-gated rendering of the pending-co-signature banner and co-sign action).
- Repository commit `f42d8ca`, dated 2026-08-08, implements the equipment-state anchoring mechanism described in §4.7, reusing `AnchorRegistry.sol` unmodified: the `EquipmentCalibration` data model and migration (`backend/prisma/schema.prisma`), the calibrate/co-sign/history/verify routes (`backend/src/routes/equipment.ts`), the compliance-rollup extension to the analytics summary endpoint (`backend/src/routes/analytics.ts`), and the calibration history/co-signature UI (`frontend/src/components/EquipmentCalibrationPanel.tsx`, `frontend/src/pages/Equipment.tsx`), plus pending-co-signature visibility surfaced on the dashboard and analytics pages (`frontend/src/pages/Dashboard.tsx`, `frontend/src/pages/Analytics.tsx`).
- Automated test coverage as of this third commit (no contract changes, so Foundry coverage is unchanged at 19 tests): 42 backend tests (including the equipment-calibration flow — propose → blocked self-co-sign → independent co-sign → equipment status reactivation → verify), 59 frontend tests (including role-gated rendering of the calibration log form, the pending co-signature banner and co-sign action on the Equipment page, and the compliance-rollup sections on the Analytics page).
- Manually verified end-to-end against a running local blockchain node and database, across all three layers: a review decision was proposed, blocked from self-co-signature (tested both as a role-gate rejection and, more meaningfully, as an Admin attempting to co-sign their own proposal), independently co-signed by a different Auditor account, and verified — driven through actual browser sessions for each role, not only API calls.
- Two genuine implementation defects were discovered and fixed during this verification process, not merely anticipated in the abstract: (1) a transaction-nonce race when anchoring two findings from the same signer in quick succession under automining, fixed with `ethers.NonceManager`; (2) a cross-process nonce desynchronization between a long-running backend process and separate test-suite runs sharing the same attestor keys against the same chain, surfaced during this same verification pass and resolved operationally (restarting the affected process re-synchronizes its local nonce cache with on-chain state) — both indicating the system was exercised against real, not merely simulated, execution conditions.

## 9. Next Steps (for the recipient of this disclosure)

1. Formal prior-art search (Google Patents, USPTO full-text search, WIPO Patentscope) beyond the informal web search underlying §2/§5 of this document.
2. Attorney review of claim scope, in particular whether the combination in §3 clears non-obviousness given the individually-known component techniques.
3. Confirm institutional ownership/assignment obligations (student/university IP policy) before any filing.
4. If pursued, a provisional patent application can typically be filed directly from a disclosure of this form to establish an early priority date while claims are refined.
