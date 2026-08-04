# Invention Disclosure — Cryptographically Bound Data and Review-Process Integrity for Regulated Manufacturing Records

**Status:** Draft technical disclosure for submission to a university technology-transfer office and/or a patent attorney. This document is not legal advice and does not constitute a filed patent application. It is written to give a patent professional the technical substance needed to run a formal prior-art search and draft claims.

**Prepared:** 2026-08-04
**System name (working title):** PharmaChain Integrity
**Reduction to practice:** Working implementation, tested end-to-end (contract, backend, frontend), in the project repository. Primary implementing commit: `b0b3a5bf0da8269b6b642d12b314167ce061cb24` ("Anchor anomaly findings on-chain, baselined per-reviewer"), 2026-08-04.

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

The invention combines, in a single system, three elements that are individually known in isolated form but not, to the inventors' knowledge, combined in this way for this problem:

**(a)** Anchoring of manufacturing-record content hashes on a blockchain smart contract, keyed by record identifier, with revert-on-reanchor protection (known technique, prior art exists).

**(b)** A statistical, per-reviewer behavioral baseline for approval timing: for a given reviewer, the mean and standard deviation of their own historical approval durations (time between record submission and review decision) is computed from records they previously reviewed, and a new approval is flagged as anomalous only if it is a statistical outlier (z-score below a threshold) *relative to that reviewer's own distribution*, rather than against one global constant. Critically, this baseline is **time-bounded to reviews strictly preceding the decision being judged**, so that the same finding is deterministically reproducible at any later point in time regardless of the reviewer's subsequent activity (see §4.3).

**(c)** Anchoring the resulting anomaly *verdict* — not merely the record's content hash — on the same blockchain smart contract, as its own immutable event, at the moment of detection (i.e., at approval time), cryptographically derived from a canonical hash of the finding's full reasoning (which rule fired, the reviewer, the timestamps, the duration, and the baseline statistics used to reach the verdict). This produces a chain of evidence binding **what the data says** (content-hash anchor) and **how it was reviewed** (anomaly-finding anchor) into one tamper-evident system, in one contract, such that neither can be altered or suppressed without an on-chain, publicly-auditable trace — including by a party with full administrative access to the underlying database.

This combination directly addresses a gap that exists in both the chain-of-custody category and the data-hash-anchoring category of prior art: neither anchors a *process-integrity* verdict, and neither uses individualized statistical baselining fused with immutable anchoring of the verdict itself.

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

## 5. Novel Aspects vs. Identified Prior Art

| | MediLedger (custody chain) | Academic data-hash anchoring (2023) | Generic "blockchain audit trail" products | Generic UEBA / behavioral fraud detection | **This disclosure** |
|---|---|---|---|---|---|
| Anchors manufacturing record content hash | No (custody only) | Yes | N/A | No | Yes |
| Anchors the *review-process anomaly verdict itself* | No | No | Anchors generic log/audit entries, not derived statistical verdicts | No (verdict stored in mutable system) | **Yes** |
| Per-individual statistical behavioral baseline | No | No | No | Yes (but not anchored, not this domain) | **Yes** |
| Baseline is time-bounded for permanent reproducibility | N/A | N/A | N/A | Not typically a design concern | **Yes** |
| Data integrity and process integrity bound in one evidentiary chain | No | No | No | No | **Yes** |
| Applied to GxP pharmaceutical manufacturing review workflow specifically | Partially (supply chain, not manufacturing review) | Partially (sensor data, not review behavior) | No | No | **Yes** |

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

## 7. Alternative / Contemplated Embodiments (not yet implemented)

For claim-breadth purposes, the following are contemplated extensions consistent with the same inventive concept, and were discussed during development but are not part of the current reduction to practice:

- **Zero-knowledge proof verification**: a public party could verify "this record's data is unmodified and its review process passed integrity checks" without the system revealing the underlying manufacturing content (formulas, quantities, supplier identities) — addressing a limitation shared by both the custody-chain and data-hash-anchoring prior art, neither of which supports privacy-preserving public verification.
- **Equipment-state anchoring**: extending the same anchoring mechanism to equipment calibration/maintenance state transitions, so that "was equipment X properly calibrated and active at the time record Y was created" becomes a cryptographically provable fact linked to the record's anchor, rather than a separately-trusted database field.
- **Additional behavioral baseline dimensions**: per-reviewer baselining of other decision attributes (e.g., rejection rate, time-of-day pattern) beyond approval duration, using the same time-bounded reproducibility principle.

## 8. Evidence of Reduction to Practice

- Repository commit `b0b3a5bf0da8269b6b642d12b314167ce061cb24`, dated 2026-08-04, implements the full system described in §4: `contracts/contracts/AnchorRegistry.sol` (smart contract), `backend/src/anomaly/baseline.ts` (statistical baseline), `backend/src/anomaly/rules.ts` (baseline-aware anomaly evaluation), `backend/src/routes/records.ts` (approval-flow wiring and read endpoint), `frontend/src/components/RecordDetail.tsx` (verification UI).
- Automated test coverage: 18 Foundry contract tests, 31 backend tests (including an end-to-end integration test exercising the full approve → on-chain-anchor → verify path), 24 frontend tests.
- Manually verified end-to-end against a running local blockchain node and database: a review decision was made, flagged as anomalous under both the fixed-threshold and (separately, in unit tests) the statistical-baseline paths, anchored on-chain, and independently re-verified via the read endpoint and UI.
- A genuine implementation defect (a transaction-nonce race when anchoring two findings from the same signer in quick succession under automining) was discovered and fixed (`ethers.NonceManager`) during this verification process — documented in the same commit, indicating the system was tested against real execution conditions, not only unit-level logic.

## 9. Next Steps (for the recipient of this disclosure)

1. Formal prior-art search (Google Patents, USPTO full-text search, WIPO Patentscope) beyond the informal web search underlying §2/§5 of this document.
2. Attorney review of claim scope, in particular whether the combination in §3 clears non-obviousness given the individually-known component techniques.
3. Confirm institutional ownership/assignment obligations (student/university IP policy) before any filing.
4. If pursued, a provisional patent application can typically be filed directly from a disclosure of this form to establish an early priority date while claims are refined.
