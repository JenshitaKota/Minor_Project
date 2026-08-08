import { Contract, JsonRpcProvider, NonceManager, Wallet } from "ethers";
import abi from "./AnchorRegistry.abi.json";

const provider = new JsonRpcProvider(process.env.RPC_URL);

// This backend holds only the QA attestor's key - the QA signer proposes (mirrors the
// human QA approval that triggers it). The Auditor's key lives entirely in the
// separate audit-service process (see audit-service/src/chain/anchorRegistry.ts); this
// backend never calls coSignAnchor itself, only independently verifies on-chain state
// after the audit service reports success (see routes/records.ts's confirmAnchor /
// routes/equipment.ts's confirmCalibrationAnchor). No single process holds both keys.
//
// NonceManager wraps the signer because a single approval flow can fire more than one
// on-chain write from this key in quick succession (e.g. retried propose calls);
// without it, each send re-queries the "pending" nonce from the node, which can go
// stale between back-to-back sends under Hardhat's automining.
function makeSigner(privateKey: string) {
  return new NonceManager(new Wallet(privateKey, provider));
}

const qaSigner = makeSigner(process.env.QA_ATTESTOR_PRIVATE_KEY as string);

const contractAddress = process.env.CONTRACT_ADDRESS as string;
const readContract = new Contract(contractAddress, abi, provider);
const qaContract = new Contract(contractAddress, abi, qaSigner);

export interface VerifyResult {
  anchored: boolean;
  matches: boolean;
  timestamp: number;
}

export async function verifyOnChain(recordIdBytes32: string, contentHash: string): Promise<VerifyResult> {
  const [anchored, matches, timestamp] = await readContract.verifyRecord(recordIdBytes32, contentHash);

  return {
    anchored,
    matches,
    timestamp: Number(timestamp),
  };
}

/** Finds the tx hash of a past anchor, for recovering from a crash between the on-chain
 * write succeeding and the database update that was supposed to follow it. */
export async function findAnchorTxHash(recordIdBytes32: string): Promise<string | null> {
  const filter = readContract.filters.RecordAnchored(recordIdBytes32);
  const events = await readContract.queryFilter(filter);
  return events.length > 0 ? events[0].transactionHash : null;
}

export interface AnomalyFindingOnChain {
  findingHash: string;
  timestamp: number;
}

export async function getAnomalyFindingsOnChain(recordIdBytes32: string): Promise<AnomalyFindingOnChain[]> {
  const findings = await readContract.getAnomalyFindings(recordIdBytes32);
  return findings.map((f: { findingHash: string; timestamp: bigint }) => ({
    findingHash: f.findingHash,
    timestamp: Number(f.timestamp),
  }));
}

export interface PendingAnchorOnChain {
  contentHash: string;
  findingHashes: string[];
  proposedBy: string;
  proposedAt: number;
}

export async function getPendingAnchorOnChain(recordIdBytes32: string): Promise<PendingAnchorOnChain> {
  const pending = await readContract.getPendingAnchor(recordIdBytes32);
  return {
    contentHash: pending.contentHash,
    findingHashes: [...pending.findingHashes],
    proposedBy: pending.proposedBy,
    proposedAt: Number(pending.proposedAt),
  };
}

/** Proposes anchoring a record's content hash plus any anomaly-finding hashes as one
 * package. Anchors nothing by itself - a separate coSignAnchor call, from the
 * independent Auditor signer running in audit-service, is required to finalize it.
 *
 * ethers' NonceManager increments its cached nonce as soon as a send is attempted,
 * before knowing whether it actually reaches the chain (e.g. a local gas-estimation
 * revert, such as a stale retry against a record that's already anchored) - the cache
 * is then permanently one ahead of reality, and every subsequent real send from this
 * signer fails with "Nonce too high" until the process restarts. `reset()` forces it
 * to re-query the actual on-chain nonce on the next attempt instead, so one caller's
 * mistaken or stale propose attempt can't degrade this long-running singleton for
 * every propose after it. */
export async function proposeAnchorOnChain(
  recordIdBytes32: string,
  contentHash: string,
  findingHashes: string[]
): Promise<{ txHash: string; timestamp: number }> {
  let receipt;
  try {
    const tx = await qaContract.proposeAnchor(recordIdBytes32, contentHash, findingHashes);
    receipt = await tx.wait();
  } catch (err) {
    qaSigner.reset();
    throw err;
  }

  const pending = await getPendingAnchorOnChain(recordIdBytes32);
  return { txHash: receipt.hash, timestamp: pending.proposedAt || Math.floor(Date.now() / 1000) };
}
