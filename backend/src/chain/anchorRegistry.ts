import { Contract, JsonRpcProvider, NonceManager, Wallet } from "ethers";
import abi from "./AnchorRegistry.abi.json";

const provider = new JsonRpcProvider(process.env.RPC_URL);

// Anchoring requires two *independent* attestors: the QA signer proposes (mirrors the
// human QA approval that triggers it), the Auditor signer co-signs (mirrors an
// independent human audit review). No single key - not even this backend process
// alone - can anchor anything without both. See AnchorRegistry.proposeAnchor/coSignAnchor.
//
// NonceManager wraps each signer because a single approval can fire more than one
// on-chain write from the same key in quick succession (propose, then separately
// co-sign); without it, each send re-queries the "pending" nonce from the node, which
// can go stale between back-to-back sends under Hardhat's automining.
function makeSigner(privateKey: string) {
  return new NonceManager(new Wallet(privateKey, provider));
}

const qaSigner = makeSigner(process.env.QA_ATTESTOR_PRIVATE_KEY as string);
const auditorSigner = makeSigner(process.env.AUDITOR_ATTESTOR_PRIVATE_KEY as string);

const contractAddress = process.env.CONTRACT_ADDRESS as string;
const readContract = new Contract(contractAddress, abi, provider);
const qaContract = new Contract(contractAddress, abi, qaSigner);
const auditorContract = new Contract(contractAddress, abi, auditorSigner);

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
 * package. Anchors nothing by itself - a separate coSignAnchorOnChain call, from the
 * independent Auditor signer, is required to finalize it. */
export async function proposeAnchorOnChain(
  recordIdBytes32: string,
  contentHash: string,
  findingHashes: string[]
): Promise<{ txHash: string; timestamp: number }> {
  const tx = await qaContract.proposeAnchor(recordIdBytes32, contentHash, findingHashes);
  const receipt = await tx.wait();

  const pending = await getPendingAnchorOnChain(recordIdBytes32);
  return { txHash: receipt.hash, timestamp: pending.proposedAt || Math.floor(Date.now() / 1000) };
}

/** Independently confirms a pending proposal, finalizing the anchor and any bundled
 * anomaly findings in one transaction. Reverts on-chain if called by the same
 * attestor that proposed it - see AnchorRegistry.coSignAnchor. */
export async function coSignAnchorOnChain(
  recordIdBytes32: string,
  contentHash: string,
  findingHashes: string[]
): Promise<{ txHash: string; timestamp: number }> {
  const tx = await auditorContract.coSignAnchor(recordIdBytes32, contentHash, findingHashes);
  const receipt = await tx.wait();

  const { matches, timestamp } = await verifyOnChain(recordIdBytes32, contentHash);
  return { txHash: receipt.hash, timestamp: matches ? timestamp : Math.floor(Date.now() / 1000) };
}
