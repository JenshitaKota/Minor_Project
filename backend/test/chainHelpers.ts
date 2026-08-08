import { Contract, JsonRpcProvider, Wallet } from "ethers";
import abi from "../src/chain/AnchorRegistry.abi.json";
import { recordIdToBytes32 } from "../src/chain/hash";

/** Directly performs the on-chain half of what audit-service does in production: reads
 * the pending proposal and co-signs it with the real Auditor attestor key. This
 * backend no longer holds that key or calls coSignAnchor itself (see
 * docs/technical-disclosure.md §4.9) - its /anchor-cosign and calibration /cosign
 * routes are now confirm-only, expecting the anchor to already exist on-chain. Tests
 * that exercise those confirm routes call this first to put the chain in that state,
 * without needing to run the whole separate audit-service process. This submits the
 * exact same transaction audit-service would; from the confirm endpoint's perspective
 * (which only reads on-chain state) the two are indistinguishable. */
export async function coSignOnChainAsAuditor(recordId: string) {
  const provider = new JsonRpcProvider(process.env.RPC_URL);
  const signer = new Wallet(process.env.TEST_AUDITOR_PRIVATE_KEY as string, provider);
  const contract = new Contract(process.env.CONTRACT_ADDRESS as string, abi, signer);

  const recordIdBytes32 = recordIdToBytes32(recordId);
  const pending = await contract.getPendingAnchor(recordIdBytes32);
  // ethers' Result is a read-only array-like Proxy - spread into a plain, mutable
  // array before passing it back into a contract call, or ethers' internal arg-walker
  // throws trying to write to it.
  const tx = await contract.coSignAnchor(recordIdBytes32, pending.contentHash, [...pending.findingHashes]);
  await tx.wait();
}
