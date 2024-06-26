import { ethers, upgrades } from "hardhat";

async function main() {

  // const CONTRACT_NAME: string = "PixCashierProxy"; // TBD: Enter contract name
  // const TOKEN_ADDRESS: string = "0xC6d1eFd908ef6B69dA0749600F553923C465c812"; // TBD: Enter token contract

  // const factory = await ethers.getContractFactory(CONTRACT_NAME);

  // for (let i = 0; i < 1; i++) {
  //   const proxy = await upgrades.deployProxy(factory, [TOKEN_ADDRESS], {
  //     kind: "uups"
  //   });

  //   await proxy.waitForDeployment();

  //   const shard = await proxy.getAddress();

  //   console.log("Proxy deployed to:", shard);
  // }




  const CONTRACT_NAME: string = "PixCashierShard"; // TBD: Enter contract name
  const TOKEN_ADDRESS: string = "0xC6d1eFd908ef6B69dA0749600F553923C465c812"; // TBD: Enter token contract
  const contractAddress = "0x44d2cCAdE0e68BB6C3C99aC91724Df0FbcAa1164"; // The contract address

  const factory = await ethers.getContractFactory(CONTRACT_NAME);

  for (let i = 0; i < 330; i++) {
    const proxy = await upgrades.deployProxy(factory, [contractAddress, TOKEN_ADDRESS], {
      kind: "uups"
    });

    await proxy.waitForDeployment();

    const shard = await proxy.getAddress();

    console.log("Proxy deployed to:", shard);
  }
}

main()
  .then()
  .catch(err => {
    throw err;
  });
