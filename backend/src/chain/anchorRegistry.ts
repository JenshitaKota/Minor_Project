import { Contract, JsonRpcProvider, Wallet } from "ethers";
import abi from "./AnchorRegistry.abi.json";

const provider = new JsonRpcProvider(process.env.RPC_URL);
const signer = new Wallet(process.env.ANCHOR_SIGNER_PRIVATE_KEY as string, provider);

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
