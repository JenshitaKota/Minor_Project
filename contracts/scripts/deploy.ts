import { ethers } from "hardhat";

async function main() {
  // Anchoring requires two *independent* attestors to jointly confirm each anchor
  // (see AnchorRegistry.proposeAnchor/coSignAnchor) - no single key can anchor alone.
  // Accounts #1 and #2 are Hardhat's well-known default local-dev accounts (same
  // public, no-real-value test keys already used for account #0 as deployer/owner).
  const [deployer, qaAttestor, auditorAttestor] = await ethers.getSigners();
  console.log("Deploying AnchorRegistry with owner:", deployer.address);
  console.log("  QA attestor:", qaAttestor.address);
  console.log("  Auditor attestor:", auditorAttestor.address);

  const AnchorRegistry = await ethers.getContractFactory("AnchorRegistry");
  const registry = await AnchorRegistry.deploy(deployer.address, [qaAttestor.address, auditorAttestor.address]);
  await registry.waitForDeployment();

  const address = await registry.getAddress();
  console.log("AnchorRegistry deployed to:", address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
