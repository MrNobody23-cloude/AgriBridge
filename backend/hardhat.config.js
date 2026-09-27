require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

module.exports = {
    solidity: "0.8.20",
    networks: {
        hardhat: {
            chainId: 1337,
        },
        polygonAmoy: {
            url: process.env.POLYGON_RPC_URL || "https://rpc-amoy.polygon.technology",
            accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
        },
    },
};
