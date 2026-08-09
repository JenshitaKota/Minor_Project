import { ethers } from "hardhat";

// The contract itself now supports configurable M-of-N attestor confirmation
// (see AnchorRegistry.proposeAnchor/coSignAnchor and the requiredConfirmations
// constructor argument) - this deployment intentionally keeps the reference
// configuration at M=2, matching the two real, independently-keyed services
// that actually exist today (the main backend's QA key, audit-service's Auditor
// key). Standing up a third independently-keyed service to run with M<N in
// production is a documented, not-yet-built extension - see
// docs/technical-disclosure.md §4.10.
const REQUIRED_CONFIRMATIONS = 2;

async function main() {
  // Accounts #1 and #2 are Hardhat's well-known default local-dev accounts (same
  // public, no-real-value test keys already used for account #0 as deployer/owner).
  const [deployer, qaAttestor, auditorAttestor] = await ethers.getSigners();
  console.log("Deploying AnchorRegistry with owner:", deployer.address);
  console.log("  QA attestor:", qaAttestor.address);
  console.log("  Auditor attestor:", auditorAttestor.address);
  console.log("  requiredConfirmations:", REQUIRED_CONFIRMATIONS);

  const AnchorRegistry = await ethers.getContractFactory("AnchorRegistry");
  const registry = await AnchorRegistry.deploy(
    deployer.address,
    [qaAttestor.address, auditorAttestor.address],
    REQUIRED_CONFIRMATIONS
  );
  await registry.waitForDeployment();

  const address = await registry.getAddress();
  console.log("AnchorRegistry deployed to:", address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
