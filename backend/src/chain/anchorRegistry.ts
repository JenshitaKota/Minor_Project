import { Contract, JsonRpcProvider, NonceManager, Wallet } from "ethers";
import abi from "./AnchorRegistry.abi.json";

const provider = new JsonRpcProvider(process.env.RPC_URL);
const wallet = new Wallet(process.env.ANCHOR_SIGNER_PRIVATE_KEY as string, provider);
// A single approval can now fire more than one on-chain write in quick succession
// (the record anchor, plus one anchor per anomaly finding). Without NonceManager, each
// send re-queries the "pending" nonce from the node, which can return a stale value for
// the second send before the first has propagated - NonceManager tracks the next nonce
// client-side instead, so back-to-back sends from this signer are always sequenced correctly.
const signer = new NonceManager(wallet);

const contract = new Contract(process.env.CONTRACT_ADDRESS as string, abi, signer);

export interface AnchorResult {
  txHash: string;
  timestamp: number;
}

export interface VerifyResult {
  anchored: boolean;
  matches: boolean;
  timestamp: number;
}

export async function anchorOnChain(recordIdBytes32: string, contentHash: string): Promise<AnchorResult> {
  const tx = await contract.anchorRecord(recordIdBytes32, contentHash);
  const receipt = await tx.wait();

  const [, , timestamp] = await contract.verifyRecord(recordIdBytes32, contentHash);

  return {
    txHash: receipt.hash,
    timestamp: Number(timestamp),
  };
}

export async function verifyOnChain(recordIdBytes32: string, contentHash: string): Promise<VerifyResult> {
  const [anchored, matches, timestamp] = await contract.verifyRecord(recordIdBytes32, contentHash);

  return {
    anchored,
    matches,
    timestamp: Number(timestamp),
  };
}

/** Finds the tx hash of a past anchor, for recovering from a crash between the on-chain
 * write succeeding and the database update that was supposed to follow it. */
export async function findAnchorTxHash(recordIdBytes32: string): Promise<string | null> {
  const filter = contract.filters.RecordAnchored(recordIdBytes32);
  const events = await contract.queryFilter(filter);
  return events.length > 0 ? events[0].transactionHash : null;
}

export interface AnomalyFindingOnChain {
  findingHash: string;
  timestamp: number;
}

export async function getAnomalyFindingsOnChain(recordIdBytes32: string): Promise<AnomalyFindingOnChain[]> {
  const findings = await contract.getAnomalyFindings(recordIdBytes32);
  return findings.map((f: { findingHash: string; timestamp: bigint }) => ({
    findingHash: f.findingHash,
    timestamp: Number(f.timestamp),
  }));
}

/** Anchors an anomaly verdict against a record. Reverts if this exact finding hash was
 * already anchored for this record (idempotent against retries) - see
 * AnchorRegistry.anchorAnomalyFinding. */
export async function anchorAnomalyFindingOnChain(
  recordIdBytes32: string,
  findingHash: string
): Promise<{ txHash: string; timestamp: number }> {
  const tx = await contract.anchorAnomalyFinding(recordIdBytes32, findingHash);
  const receipt = await tx.wait();

  const findings = await getAnomalyFindingsOnChain(recordIdBytes32);
  const anchored = findings.find((f) => f.findingHash === findingHash);

  return { txHash: receipt.hash, timestamp: anchored?.timestamp ?? Math.floor(Date.now() / 1000) };
}
