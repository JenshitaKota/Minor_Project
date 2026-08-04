import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying AnchorRegistry with owner:", deployer.address);

  const AnchorRegistry = await ethers.getContractFactory("AnchorRegistry");
  const registry = await AnchorRegistry.deploy(deployer.address);
  await registry.waitForDeployment();

  const address = await registry.getAddress();
  console.log("AnchorRegistry deployed to:", address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
