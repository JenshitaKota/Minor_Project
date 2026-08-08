import { Contract, JsonRpcProvider, NonceManager, Wallet } from "ethers";
import abi from "./AnchorRegistry.abi.json";

const provider = new JsonRpcProvider(process.env.RPC_URL);

// The Auditor's key lives ONLY here - never on the main backend. NonceManager because
// a single co-sign is one on-chain write, but this process may field several in
// succession; without it, each send re-queries the "pending" nonce, which can go stale
// between back-to-back sends under Hardhat's automining.
//
// This service must run as a single instance: NonceManager's nonce cache is in-process
// state for this one key. Horizontally scaling this service would need a nonce-safe
// queue instead - out of scope for this reduction to practice, disclosed as a residual
// limitation alongside the rest of this element's honest scope notes.
function makeSigner(privateKey: string) {
  return new NonceManager(new Wallet(privateKey, provider));
}

const auditorSigner = makeSigner(process.env.AUDITOR_ATTESTOR_PRIVATE_KEY as string);

const contractAddress = process.env.CONTRACT_ADDRESS as string;
const readContract = new Contract(contractAddress, abi, provider);
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

/** Independently confirms a pending proposal, finalizing the anchor and any bundled
 * anomaly findings in one transaction. Reverts on-chain if called by the same
 * attestor that proposed it - see AnchorRegistry.coSignAnchor.
 *
 * ethers' NonceManager increments its cached nonce as soon as a send is attempted,
 * before knowing whether it actually reaches the chain (e.g. a local gas-estimation
 * revert, which is exactly what happens here when there's no matching pending
 * proposal) - the cache is then permanently one ahead of reality, and every
 * subsequent real send from this signer fails with "Nonce too high" until the
 * process restarts. `reset()` forces it to re-query the actual on-chain nonce on the
 * next attempt instead, so one caller's mistaken or stale co-sign attempt can't
 * degrade this long-running singleton for every co-sign after it. */
export async function coSignAnchorOnChain(
  recordIdBytes32: string,
  contentHash: string,
  findingHashes: string[]
): Promise<{ txHash: string; timestamp: number }> {
  let receipt;
  try {
    const tx = await auditorContract.coSignAnchor(recordIdBytes32, contentHash, findingHashes);
    receipt = await tx.wait();
  } catch (err) {
    auditorSigner.reset();
    throw err;
  }

  const { matches, timestamp } = await verifyOnChain(recordIdBytes32, contentHash);
  return { txHash: receipt.hash, timestamp: matches ? timestamp : Math.floor(Date.now() / 1000) };
}
