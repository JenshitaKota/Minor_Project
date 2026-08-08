import { Contract, JsonRpcProvider, Wallet } from "ethers";
import abi from "../src/chain/AnchorRegistry.abi.json";
import { recordIdToBytes32 } from "../src/chain/hash";

/** Directly performs the on-chain half of what the main backend does when a QA
 * reviewer approves a record (or an Operator logs a calibration): proposes a package
 * for a *different* attestor to co-sign. Standing in for the main backend, which
 * these tests don't run - this service's tests only need the chain to be in the
 * state a real propose would leave it in, not the whole other app. */
export async function proposeOnChainAsQA(id: string, contentHash: string, findingHashes: string[] = []) {
  const provider = new JsonRpcProvider(process.env.RPC_URL);
  const signer = new Wallet(process.env.TEST_QA_PRIVATE_KEY as string, provider);
  const contract = new Contract(process.env.CONTRACT_ADDRESS as string, abi, signer);

  const recordIdBytes32 = recordIdToBytes32(id);
  const tx = await contract.proposeAnchor(recordIdBytes32, contentHash, findingHashes);
  await tx.wait();
}
