const hre = require("hardhat");

async function main() {
    console.log("🚀 Deploying AgriBridgeTraceability Smart Contract to Polygon Amoy Testnet...");

    const contractFactory = await hre.ethers.getContractFactory("AgriBridgeTraceability");
    const contract = await contractFactory.deploy();

    await contract.waitForDeployment();
    const address = await contract.getAddress();

    console.log(`✅ AgriBridgeTraceability Contract Deployed Successfully at Address: ${address}`);
}

main().catch((error) => {
    console.error("❌ Smart contract deployment error:", error);
    process.exitCode = 1;
});
