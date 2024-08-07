import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory, TransactionResponse } from "ethers";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { checkContractUupsUpgrading, connect, getAddress, proveTx } from "../test-utils/eth";

const ADDRESS_ZERO = ethers.ZeroAddress;

enum CashInStatus {
  Nonexistent = 0,
  Executed = 1,
  PremintExecuted = 2
}

enum CashOutStatus {
  Nonexistent = 0,
  Pending = 1,
  Reversed = 2,
  Confirmed = 3
}

interface TestCashIn {
  account: HardhatEthersSigner;
  amount: number;
  txId: string;
  status: CashInStatus;
  releaseTimestamp?: number;
  oldAmount?: number;
}

interface TestCashOut {
  account: HardhatEthersSigner;
  amount: number;
  txId: string;
  status: CashOutStatus;
}

interface PixCashierState {
  tokenBalance: number;
  pendingCashOutCounter: number;
  pendingCashOutTxIds: string[];
  cashOutBalancePerAccount: Map<string, number>;
}

interface Fixture {
  pixCashierRoot: Contract;
  pixCashierRootAdmin: Contract;
  pixCashierShards: Contract[];
  tokenMock: Contract;
}

function checkCashOutEquality(
  actualOnChainCashOut: Record<string, unknown>,
  expectedCashOut: TestCashOut,
  cashOutIndex: number
) {
  if (expectedCashOut.status == CashOutStatus.Nonexistent) {
    expect(actualOnChainCashOut.account).to.equal(
      ADDRESS_ZERO,
      `cashOuts[${cashOutIndex}].account is incorrect`
    );
    expect(actualOnChainCashOut.amount).to.equal(
      0,
      `cashOuts[${cashOutIndex}].amount is incorrect`
    );
    expect(actualOnChainCashOut.status).to.equal(
      expectedCashOut.status,
      `cashOut[${cashOutIndex}].status is incorrect`
    );
  } else {
    expect(actualOnChainCashOut.account).to.equal(
      expectedCashOut.account.address,
      `cashOuts[${cashOutIndex}].account is incorrect`
    );
    expect(actualOnChainCashOut.amount).to.equal(
      expectedCashOut.amount,
      `cashOuts[${cashOutIndex}].amount is incorrect`
    );
    expect(actualOnChainCashOut.status).to.equal(
      expectedCashOut.status,
      `cashOut[${cashOutIndex}].status is incorrect`
    );
  }
}

function checkCashInEquality(
  actualOnChainCashIn: Record<string, unknown>,
  expectedCashIn: TestCashIn,
  cashInIndex: number
) {
  if (expectedCashIn.status == CashInStatus.Nonexistent) {
    expect(actualOnChainCashIn.account).to.equal(
      ADDRESS_ZERO,
      `cashIns[${cashInIndex}].account is incorrect`
    );
    expect(actualOnChainCashIn.amount).to.equal(
      0,
      `cashIns[${cashInIndex}].amount is incorrect`
    );
    expect(actualOnChainCashIn.status).to.equal(
      CashInStatus.Nonexistent,
      `cashIns[${cashInIndex}].status is incorrect`
    );
  } else {
    expect(actualOnChainCashIn.account).to.equal(
      expectedCashIn.account.address,
      `cashIns[${cashInIndex}].account is incorrect`
    );
    expect(actualOnChainCashIn.amount).to.equal(
      expectedCashIn.amount,
      `cashIns[${cashInIndex}].amount is incorrect`
    );
    expect(actualOnChainCashIn.status).to.equal(
      expectedCashIn.status,
      `cashIns[${cashInIndex}].status is incorrect`
    );
  }
}

async function getImplementationAddresses(contracts: Contract[]): Promise<string[]> {
  const implementationAddressPromises: Promise<string>[] = [];
  for (const contract of contracts) {
    const shardAddress = getAddress(contract);
    implementationAddressPromises.push(upgrades.erc1967.getImplementationAddress(shardAddress));
  }
  return await Promise.all(implementationAddressPromises);
}

function defineShardIndexByTxId(txId: string, shardCount: number): number {
  return Number(BigInt(ethers.keccak256(txId)) % BigInt(shardCount));
}

async function setUpFixture<T>(func: () => Promise<T>): Promise<T> {
  if (network.name === "hardhat") {
    return loadFixture(func);
  } else {
    return func();
  }
}

describe("Contracts 'PixCashierRoot' and `PixCashierShard`", async () => {
  const TRANSACTION_ID1 = ethers.encodeBytes32String("MOCK_TRANSACTION_ID1");
  const TRANSACTION_ID2 = ethers.encodeBytes32String("MOCK_TRANSACTION_ID2");
  const TRANSACTION_ID3 = ethers.encodeBytes32String("MOCK_TRANSACTION_ID3");
  const TRANSACTIONS_ARRAY: string[] = [TRANSACTION_ID1, TRANSACTION_ID2, TRANSACTION_ID3];
  const INITIAL_USER_BALANCE = 1_000_000;
  const TOKEN_AMOUNT = 100;
  const TOKEN_AMOUNTS: number[] = [TOKEN_AMOUNT, 200, 300];
  const TOKEN_AMOUNT_ZERO = 0;
  const BALANCE_ZERO = 0;
  const RELEASE_TIMESTAMP = 123456;
  const RELEASE_TIMESTAMP_ZERO = 0;
  const TRANSACTION_ID_ZERO = ethers.ZeroHash;

  const REVERT_ERROR_IF_CONTRACT_INITIALIZATION_IS_INVALID = "InvalidInitialization";
  const REVERT_ERROR_IF_CONTRACT_IS_PAUSED = "EnforcedPause";
  const REVERT_ERROR_IF_ERC20_TOKEN_TRANSFER_AMOUNT_EXCEEDS_BALANCE = "ERC20InsufficientBalance";
  const REVERT_ERROR_IF_OWNABLE_INVALID_OWNER = "OwnableInvalidOwner";
  const REVERT_ERROR_IF_UNAUTHORIZED = "Unauthorized";
  const REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT = "AccessControlUnauthorizedAccount";

  const REVERT_ERROR_IF_ROOT_ADDRESS_IZ_ZERO = "ZeroRootAddress";
  const REVERT_ERROR_IF_SHARD_ADDRESS_IZ_ZERO = "ZeroShardAddress";
  const REVERT_ERROR_IF_TOKEN_ADDRESS_IZ_ZERO = "ZeroTokenAddress";
  const REVERT_ERROR_IF_ACCOUNT_IS_ZERO = "ZeroAccount";
  const REVERT_ERROR_IF_AMOUNT_EXCESS = "AmountExcess";
  const REVERT_ERROR_IF_AMOUNT_IS_ZERO = "ZeroAmount";
  const REVERT_ERROR_IF_CASH_IN_ALREADY_EXECUTED = "CashInAlreadyExecuted";
  const REVERT_ERROR_IF_TRANSACTION_ID_IS_ZERO = "ZeroTxId";
  const REVERT_ERROR_IF_TOKEN_MINTING_FAILURE = "TokenMintingFailure";
  const REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_ACCOUNT = "InappropriateCashOutAccount";
  const REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_STATUS = "InappropriateCashOutStatus";
  const REVERT_ERROR_IF_INAPPROPRIATE_PREMINT_RELEASE_TIME = "InappropriatePremintReleaseTime";
  const REVERT_ERROR_IF_INAPPROPRIATE_CASH_IN_STATUS = "InappropriateCashInStatus";
  const REVERT_ERROR_IF_SHARD_COUNT_EXCESS = "ShardCountExcess";

  const EVENT_NAME_CASH_IN = "CashIn";
  const EVENT_NAME_CASH_IN_PREMINT = "CashInPremint";
  const EVENT_NAME_CASH_OUT_REQUESTING = "RequestCashOut";
  const EVENT_NAME_CASH_OUT_REVERSING = "ReverseCashOut";
  const EVENT_NAME_CASH_OUT_CONFIRMATION = "ConfirmCashOut";
  const EVENT_NAME_MOCK_PREMINT_INCREASING = "MockPremintIncreasing";
  const EVENT_NAME_MOCK_PREMINT_DECREASING = "MockPremintDecreasing";
  const EVENT_NAME_MOCK_PREMINT_PREMINT_RESCHEDULING = "MockPremintReleaseRescheduling";
  const EVENT_NAME_SHARD_ADDED = "ShardAdded";
  const EVENT_NAME_SHARD_ADMIN_CONFIGURED = "ShardAdminConfigured";

  let pixCashierRootFactory: ContractFactory;
  let pixCashierShardFactory: ContractFactory;
  let tokenMockFactory: ContractFactory;
  let deployer: HardhatEthersSigner;
  let cashier: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let users: HardhatEthersSigner[];

  const ownerRole: string = ethers.id("OWNER_ROLE");
  const pauserRole: string = ethers.id("PAUSER_ROLE");
  const rescuerRole: string = ethers.id("RESCUER_ROLE");
  const cashierRole: string = ethers.id("CASHIER_ROLE");

  before(async () => {
    let secondUser: HardhatEthersSigner;
    let thirdUser: HardhatEthersSigner;
    [deployer, cashier, user, secondUser, thirdUser] = await ethers.getSigners();
    users = [user, secondUser, thirdUser];

    // Contract factories with the explicitly specified deployer account
    pixCashierRootFactory = await ethers.getContractFactory("PixCashierRoot");
    pixCashierRootFactory = pixCashierRootFactory.connect(deployer);
    pixCashierShardFactory = await ethers.getContractFactory("PixCashierShard");
    pixCashierShardFactory = pixCashierShardFactory.connect(deployer);
    tokenMockFactory = await ethers.getContractFactory("ERC20TokenMock");
    tokenMockFactory = tokenMockFactory.connect(deployer);
  });

  async function deployTokenMock(): Promise<Contract> {
    const name = "ERC20 Test";
    const symbol = "TEST";

    let tokenMock: Contract = await tokenMockFactory.deploy(name, symbol) as Contract;
    await tokenMock.waitForDeployment();
    tokenMock = connect(tokenMock, deployer); // Explicitly specifying the initial account

    return tokenMock;
  }

  async function deployContracts(): Promise<Fixture> {
    const tokenMock = await deployTokenMock();
    let pixCashierRoot: Contract = await upgrades.deployProxy(pixCashierRootFactory, [getAddress(tokenMock)]);
    await pixCashierRoot.waitForDeployment();
    pixCashierRoot = connect(pixCashierRoot, deployer); // Explicitly specifying the initial account

    let pixCashierRootAdmin: Contract = await upgrades.deployProxy(pixCashierRootFactory, [getAddress(tokenMock)]);
    await pixCashierRootAdmin.waitForDeployment();
    pixCashierRootAdmin = connect(pixCashierRootAdmin, deployer); // Explicitly specifying the initial account

    const pixCashierShards: Contract[] = [];
    const pixShardCount = 3;
    for (let i = 0; i < pixShardCount; ++i) {
      let pixCashierShard: Contract = await upgrades.deployProxy(pixCashierShardFactory, [getAddress(pixCashierRoot)]);
      await pixCashierShard.waitForDeployment();
      pixCashierShard = connect(pixCashierShard, deployer); // Explicitly specifying the initial account
      pixCashierShards.push(pixCashierShard);
    }

    return {
      pixCashierRoot,
      pixCashierRootAdmin,
      pixCashierShards,
      tokenMock
    };
  }

  async function deployAndConfigureContracts(): Promise<Fixture> {
    const fixture = await deployContracts();
    const { tokenMock, pixCashierRoot, pixCashierRootAdmin, pixCashierShards } = fixture;

    await proveTx(pixCashierRoot.grantRole(cashierRole, cashier.address));
    await proveTx(pixCashierRootAdmin.grantRole(cashierRole, cashier.address));

    for (const user of users) {
      await proveTx(tokenMock.mint(user.address, INITIAL_USER_BALANCE));
      await proveTx(connect(tokenMock, user).approve(getAddress(pixCashierRoot), ethers.MaxUint256));
      await proveTx(connect(tokenMock, user).approve(getAddress(pixCashierRootAdmin), ethers.MaxUint256));
    }

    const pixCashierShardAddresses: string[] = pixCashierShards.map(shard => getAddress(shard));
    await proveTx(pixCashierRoot.addShards(pixCashierShardAddresses));
    await proveTx(pixCashierRootAdmin.addShards(pixCashierShardAddresses));

    await proveTx(pixCashierRoot.configureShardAdmin(getAddress(pixCashierRootAdmin), true));

    return fixture;
  }

  async function pauseContract(contract: Contract) {
    await proveTx(contract.grantRole(pauserRole, deployer.address));
    await proveTx(contract.pause());
  }

  async function requestCashOuts(pixCashier: Contract, cashOuts: TestCashOut[]) {
    for (const cashOut of cashOuts) {
      await proveTx(
        connect(pixCashier, cashier).requestCashOutFrom(cashOut.account.address, cashOut.amount, cashOut.txId)
      );
      cashOut.status = CashOutStatus.Pending;
    }
  }

  function defineExpectedPixCashierState(cashOuts: TestCashOut[]): PixCashierState {
    let tokenBalance: number = 0;
    let pendingCashOutCounter: number = 0;
    const pendingCashOutTxIds: string[] = [];
    const cashOutBalancePerAccount: Map<string, number> = new Map<string, number>();

    for (const cashOut of cashOuts) {
      let newCashOutBalance: number = cashOutBalancePerAccount.get(cashOut.account.address) || 0;
      if (cashOut.status == CashOutStatus.Pending) {
        pendingCashOutTxIds.push(cashOut.txId);
        ++pendingCashOutCounter;
        tokenBalance += cashOut.amount;
        newCashOutBalance += cashOut.amount;
      }
      cashOutBalancePerAccount.set(cashOut.account.address, newCashOutBalance);
    }

    return {
      tokenBalance,
      pendingCashOutCounter,
      pendingCashOutTxIds,
      cashOutBalancePerAccount
    };
  }

  async function checkCashInStructuresOnBlockchain(pixCashier: Contract, cashIns: TestCashIn[]) {
    const txIds: string[] = cashIns.map(cashIn => cashIn.txId);
    const actualCashIns: Record<string, unknown>[] = await pixCashier.getCashIns(txIds);
    for (let i = 0; i < cashIns.length; ++i) {
      const cashIn: TestCashIn = cashIns[i];
      const actualCashIn: Record<string, unknown> = await pixCashier.getCashIn(cashIn.txId);
      checkCashInEquality(actualCashIn, cashIn, i);
      checkCashInEquality(actualCashIns[i], cashIn, i);
    }
  }

  async function checkCashOutStructuresOnBlockchain(pixCashier: Contract, cashOuts: TestCashOut[]) {
    const txIds: string[] = cashOuts.map(cashOut => cashOut.txId);
    const actualCashOuts: Record<string, unknown>[] = await pixCashier.getCashOuts(txIds);
    for (let i = 0; i < cashOuts.length; ++i) {
      const cashOut: TestCashOut = cashOuts[i];
      const actualCashOut: Record<string, unknown> = await pixCashier.getCashOut(cashOut.txId);
      checkCashOutEquality(actualCashOut, cashOut, i);
      checkCashOutEquality(actualCashOuts[i], cashOut, i);
    }
  }

  async function checkPixCashierState(
    tokenMock: Contract,
    pixCashierRoot: Contract,
    cashOuts: TestCashOut[]
  ) {
    const expectedState: PixCashierState = defineExpectedPixCashierState(cashOuts);
    await checkCashOutStructuresOnBlockchain(pixCashierRoot, cashOuts);

    expect(await tokenMock.balanceOf(getAddress(pixCashierRoot))).to.equal(
      expectedState.tokenBalance,
      `The PIX cashier total balance is wrong`
    );

    const actualPendingCashOutCounter = await pixCashierRoot.pendingCashOutCounter();
    expect(actualPendingCashOutCounter).to.equal(
      expectedState.pendingCashOutCounter,
      `The pending cash-out counter is wrong`
    );

    const actualPendingCashOutTxIds: string[] = await pixCashierRoot.getPendingCashOutTxIds(0, actualPendingCashOutCounter);
    expect(actualPendingCashOutTxIds).to.deep.equal(
      expectedState.pendingCashOutTxIds,
      `The pending cash-out tx ids are wrong`
    );

    for (const account of expectedState.cashOutBalancePerAccount.keys()) {
      const expectedCashOutBalance = expectedState.cashOutBalancePerAccount.get(account);
      if (!expectedCashOutBalance) {
        continue;
      }
      expect(await pixCashierRoot.cashOutBalanceOf(account)).to.equal(
        expectedCashOutBalance,
        `The cash-out balance for account ${account} is wrong`
      );
    }
  }

  function defineTestCashIns(num: number = 1, releaseTimestamp: number | undefined = undefined): TestCashIn[] {
    const cashIns: TestCashIn[] = [];
    if (num > 3) {
      throw new Error("The requested number of test cash-in structures is greater than 3");
    }
    for (let i = 0; i < num; ++i) {
      cashIns.push({
        account: users[i],
        amount: TOKEN_AMOUNTS[i],
        txId: TRANSACTIONS_ARRAY[i],
        status: CashInStatus.Nonexistent,
        releaseTimestamp: releaseTimestamp
      });
    }
    return cashIns;
  }

  function defineTestCashOuts(num: number = 1): TestCashOut[] {
    const cashOuts: TestCashOut[] = [];
    if (num > 3) {
      throw new Error("The requested number of test cash-out structures is greater than 3");
    }
    for (let i = 0; i < num; ++i) {
      cashOuts.push({
        account: users[i],
        amount: TOKEN_AMOUNTS[i],
        txId: TRANSACTIONS_ARRAY[i],
        status: CashOutStatus.Nonexistent
      });
    }
    return cashOuts;
  }

  async function executeCashIn(pixCashierRoot: Contract, tokenMock: Contract,  cashIn: TestCashIn) {
    const tx = connect(pixCashierRoot, cashier).cashIn(
      cashIn.account.address,
      cashIn.amount,
      cashIn.txId
    );
    await expect(tx).to.changeTokenBalances(
      tokenMock,
      [pixCashierRoot, cashIn.account],
      [0, +cashIn.amount]
    );
    await expect(tx).to.emit(pixCashierRoot, EVENT_NAME_CASH_IN).withArgs(
      cashIn.account.address,
      cashIn.amount,
      cashIn.txId
    );
    cashIn.status = CashInStatus.Executed;
    await checkCashInStructuresOnBlockchain(pixCashierRoot, [cashIn]);
  }

  async function executeCashInPremint(pixCashierRoot: Contract, tokenMock: Contract, cashIn: TestCashIn) {
    const tx = connect(pixCashierRoot, cashier).cashInPremint(
      cashIn.account.address,
      cashIn.amount,
      cashIn.txId,
      cashIn.releaseTimestamp
    );
    await expect(tx).to.emit(pixCashierRoot, EVENT_NAME_CASH_IN_PREMINT).withArgs(
      cashIn.account.address,
      cashIn.amount, // newAmount
      TOKEN_AMOUNT_ZERO, // oldAmount
      cashIn.txId,
      cashIn.releaseTimestamp
    );
    await expect(tx).to.emit(tokenMock, EVENT_NAME_MOCK_PREMINT_INCREASING).withArgs(
      cashIn.account.address,
      cashIn.amount,
      cashIn.releaseTimestamp
    );
    cashIn.status = CashInStatus.PremintExecuted;
    await checkCashInStructuresOnBlockchain(pixCashierRoot, [cashIn]);
  }

  async function executeCashInPremintRevoke(pixCashierRoot: Contract, tokenMock: Contract, cashIn: TestCashIn) {
    await executeCashInPremint(pixCashierRoot, tokenMock, cashIn);

    const tx = connect(pixCashierRoot, cashier).cashInPremintRevoke(
      cashIn.txId,
      cashIn.releaseTimestamp
    );
    cashIn.oldAmount = cashIn.amount;
    cashIn.amount = 0;
    cashIn.status = CashInStatus.Nonexistent;

    await expect(tx).to.emit(pixCashierRoot, EVENT_NAME_CASH_IN_PREMINT).withArgs(
      cashIn.account.address,
      cashIn.amount,
      cashIn.oldAmount ?? 0,
      cashIn.txId,
      cashIn.releaseTimestamp
    );
    await expect(tx).to.emit(tokenMock, EVENT_NAME_MOCK_PREMINT_DECREASING).withArgs(
      cashIn.account.address,
      cashIn.oldAmount,
      cashIn.releaseTimestamp
    );
    await checkCashInStructuresOnBlockchain(pixCashierRoot, [cashIn]);
  }

  async function executeRequestCashOut(pixCashierRoot: Contract, tokenMock: Contract, cashOut: TestCashOut): Promise<void> {
    await checkPixCashierState(tokenMock, pixCashierRoot , [cashOut]);
    const tx = connect(pixCashierRoot, cashier).requestCashOutFrom(
      cashOut.account.address,
      cashOut.amount,
      cashOut.txId
    );
    await expect(tx).to.changeTokenBalances(
      tokenMock,
      [pixCashierRoot, cashier, cashOut.account],
      [+cashOut.amount, 0, -cashOut.amount]
    );
    await expect(tx).to.emit(pixCashierRoot, EVENT_NAME_CASH_OUT_REQUESTING).withArgs(
      cashOut.account.address,
      cashOut.amount, // amount
      cashOut.amount, // balance
      cashOut.txId,
      cashier.address
    );
    cashOut.status = CashOutStatus.Pending;
    await checkPixCashierState(tokenMock, pixCashierRoot, [cashOut]);
  }

  async function executeCashOutConfirm (pixCashierRoot: Contract, tokenMock: Contract, cashOut: TestCashOut): Promise<void> {
    await requestCashOuts(pixCashierRoot, [cashOut]);
    await checkPixCashierState(tokenMock, pixCashierRoot, [cashOut]);
    const tx = connect(pixCashierRoot, cashier).confirmCashOut(cashOut.txId);

    await expect(tx).to.changeTokenBalances(
      tokenMock,
      [pixCashierRoot, cashOut.account],
      [-cashOut.amount, 0]
    );
    await expect(tx).to.emit(pixCashierRoot, EVENT_NAME_CASH_OUT_CONFIRMATION).withArgs(
      cashOut.account.address,
      cashOut.amount,
      BALANCE_ZERO,
      cashOut.txId
    );
    cashOut.status = CashOutStatus.Confirmed;
    await checkPixCashierState(tokenMock, pixCashierRoot, [cashOut]);
  }

  async function executeReverseCashOut(pixCashierRoot: Contract, tokenMock: Contract, cashOut: TestCashOut): Promise<void> {
    await requestCashOuts(pixCashierRoot, [cashOut]);
    await checkPixCashierState(tokenMock, pixCashierRoot, [cashOut]);
    const tx = connect(pixCashierRoot, cashier).reverseCashOut(cashOut.txId);
    await expect(tx).to.changeTokenBalances(
      tokenMock,
      [cashOut.account, pixCashierRoot, cashier],
      [+cashOut.amount, -cashOut.amount, 0]
    );
    await expect(tx).to.emit(pixCashierRoot, EVENT_NAME_CASH_OUT_REVERSING).withArgs(
      cashOut.account.address,
      cashOut.amount,
      BALANCE_ZERO,
      cashOut.txId
    );
    cashOut.status = CashOutStatus.Reversed;
    await checkPixCashierState(tokenMock, pixCashierRoot, [cashOut]);
  }

  async function executeUpgradeShardsTo(pixCashierRoot: Contract, pixCashierShards: Contract[], targetShardImplementationAddress: string) {
    const oldImplementationAddresses: string[] = await getImplementationAddresses(pixCashierShards);
    oldImplementationAddresses.forEach((_, i) => {
      expect(oldImplementationAddresses[i]).to.not.eq(
        targetShardImplementationAddress,
        `oldImplementationAddresses[${i}] is wrong`
      );
    });

    await proveTx(pixCashierRoot.upgradeShardsTo(targetShardImplementationAddress));

    const newImplementationAddresses: string[] = await getImplementationAddresses(pixCashierShards);
    newImplementationAddresses.forEach((_, i) => {
      expect(newImplementationAddresses[i]).to.eq(
        targetShardImplementationAddress,
        `newImplementationAddresses[${i}] is wrong`
      );
    });
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the root contract as expected", async () => {
      const { pixCashierRoot, tokenMock } = await setUpFixture(deployContracts);

      // The underlying contract address
      expect(await pixCashierRoot.underlyingToken()).to.equal(getAddress(tokenMock));

      // Role hashes
      expect(await pixCashierRoot.OWNER_ROLE()).to.equal(ownerRole);
      expect(await pixCashierRoot.PAUSER_ROLE()).to.equal(pauserRole);
      expect(await pixCashierRoot.RESCUER_ROLE()).to.equal(rescuerRole);
      expect(await pixCashierRoot.CASHIER_ROLE()).to.equal(cashierRole);

      // The role admins
      expect(await pixCashierRoot.getRoleAdmin(ownerRole)).to.equal(ownerRole);
      expect(await pixCashierRoot.getRoleAdmin(pauserRole)).to.equal(ownerRole);
      expect(await pixCashierRoot.getRoleAdmin(rescuerRole)).to.equal(ownerRole);
      expect(await pixCashierRoot.getRoleAdmin(cashierRole)).to.equal(ownerRole);

      // The deployer should have the owner role, but not the other roles
      expect(await pixCashierRoot.hasRole(ownerRole, deployer.address)).to.equal(true);
      expect(await pixCashierRoot.hasRole(pauserRole, deployer.address)).to.equal(false);
      expect(await pixCashierRoot.hasRole(rescuerRole, deployer.address)).to.equal(false);
      expect(await pixCashierRoot.hasRole(cashierRole, deployer.address)).to.equal(false);

      // The initial contract state is unpaused
      expect(await pixCashierRoot.paused()).to.equal(false);

      // The initial values of counters and pending cash-outs
      expect(await pixCashierRoot.pendingCashOutCounter()).to.equal(0);
      expect(await pixCashierRoot.getPendingCashOutTxIds(0, 1)).to.be.empty;
    });

    it("Configures the shard contract as expected", async () => {
      const { pixCashierRoot, pixCashierShards } = await setUpFixture(deployContracts);

      // Owner
      for (const pixCashierShard of pixCashierShards) {
        expect(await pixCashierShard.owner()).to.equal(getAddress(pixCashierRoot));
      }
    });

    it("Is reverted if it is called a second time for the root contract", async () => {
      const { pixCashierRoot, tokenMock } = await setUpFixture(deployContracts);
      await expect(
        pixCashierRoot.initialize(getAddress(tokenMock))
      ).to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_CONTRACT_INITIALIZATION_IS_INVALID);
    });

    it("Is reverted if it is called a second time for the shard contract", async () => {
      const { pixCashierRoot, pixCashierShards: [pixCashierShard] } = await setUpFixture(deployContracts);
      await expect(
        pixCashierShard.initialize(getAddress(pixCashierRoot))
      ).to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_CONTRACT_INITIALIZATION_IS_INVALID);
    });

    it("Is reverted if the passed token address is zero for the root contract", async () => {
      const anotherPixCashierRoot: Contract = await upgrades.deployProxy(pixCashierRootFactory, [], {
        initializer: false
      });

      await expect(
        anotherPixCashierRoot.initialize(ADDRESS_ZERO)
      ).to.be.revertedWithCustomError(pixCashierRootFactory, REVERT_ERROR_IF_TOKEN_ADDRESS_IZ_ZERO);
    });

    it("Is reverted if the passed owner address is zero for the shard contract", async () => {
      const anotherPixCashierShard: Contract = await upgrades.deployProxy(pixCashierShardFactory, [], {
        initializer: false
      });

      await expect(
        anotherPixCashierShard.initialize(ADDRESS_ZERO)
      ).to.be.revertedWithCustomError(pixCashierShardFactory, REVERT_ERROR_IF_OWNABLE_INVALID_OWNER);
    });

  });

  describe("Function 'upgradeToAndCall()'", async () => {
    it("Executes as expected for the root contract", async () => {
      const { pixCashierRoot } = await setUpFixture(deployContracts);
      await checkContractUupsUpgrading(pixCashierRoot, pixCashierRootFactory)
    });

    it("Executes as expected for the shard contract", async () => {
      const anotherPixCashierShard: Contract = await upgrades.deployProxy(pixCashierShardFactory, [deployer.address]);
      await checkContractUupsUpgrading(anotherPixCashierShard, pixCashierShardFactory);
    });

    it("Is reverted if the caller is not the owner for the root contract", async () => {
      const { pixCashierRoot } = await setUpFixture(deployContracts);

      await expect(connect(pixCashierRoot, user).upgradeToAndCall(user.address, "0x"))
        .to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT);
    });

    it("Is reverted if the caller is not the owner or admin for the shard contract", async () => {
      const anotherPixCashierShard: Contract = await upgrades.deployProxy(pixCashierShardFactory, [deployer.address]);

      await expect(connect(anotherPixCashierShard, user).upgradeToAndCall(user.address, "0x"))
        .to.be.revertedWithCustomError(anotherPixCashierShard, REVERT_ERROR_IF_UNAUTHORIZED);
    });
  });

  describe("Function 'upgradeTo()'", async () => {
    it("Executes as expected for the root contract", async () => {
      const { pixCashierRoot } = await setUpFixture(deployContracts);
      await checkContractUupsUpgrading(pixCashierRoot, pixCashierRootFactory, "upgradeTo(address)");
    });

    it("Executes as expected for the shard contract", async () => {
      const anotherPixCashierShard: Contract = await upgrades.deployProxy(pixCashierShardFactory, [deployer.address]);
      await checkContractUupsUpgrading(anotherPixCashierShard, pixCashierShardFactory, "upgradeTo(address)");
    });

    it("Is reverted if the caller is not the owner", async () => {
      const { pixCashierRoot } = await setUpFixture(deployContracts);

      await expect(connect(pixCashierRoot, user).upgradeTo(user.address))
        .to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT);
    });

    it("Is reverted if the caller is not the owner or admin", async () => {
      const anotherPixCashierShard: Contract = await upgrades.deployProxy(pixCashierShardFactory, [deployer.address]);

      await expect(connect(anotherPixCashierShard, user).upgradeTo(user.address))
        .to.be.revertedWithCustomError(anotherPixCashierShard, REVERT_ERROR_IF_UNAUTHORIZED);
    });
  });

  describe("Function 'addShards()'", async () => {
    it("Executes as expected", async () => {
      const { pixCashierRoot } = await setUpFixture(deployContracts);
      const shardAddresses = users.map(user => user.address);

      const tx1 = pixCashierRoot.addShards([shardAddresses[0]]);
      await expect(tx1).to.emit(pixCashierRoot, EVENT_NAME_SHARD_ADDED).withArgs(shardAddresses[0]);
      expect(await pixCashierRoot.getShardCount()).to.eq(1);

      const tx2 = pixCashierRoot.addShards(shardAddresses)
      for(const shardAddress of shardAddresses) {
        await expect(tx2).to.emit(pixCashierRoot, EVENT_NAME_SHARD_ADDED).withArgs(shardAddress);
      }
      expect(await pixCashierRoot.getShardCount()).to.eq(1 + shardAddresses.length);
    });

    it("Is reverted if the caller is not the owner", async () => {
      const { pixCashierRoot } = await setUpFixture(deployContracts);
      const fakeShardAddress = user.address;
      await expect(
        connect(pixCashierRoot, cashier).addShards([fakeShardAddress])
      ).to.be.revertedWithCustomError(
        pixCashierRoot,
        REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT
      ).withArgs(cashier.address, ownerRole);
    });

    it("Is reverted if the number of shard exceeds the allowed maximum", async () => {
      const { pixCashierRoot } = await setUpFixture(deployContracts);
      const shardMaxNumber = 1100;
      const fakeShardAddress: string[] = Array.from(
        { length: shardMaxNumber },
        (_v, i) => "0x" + ((i + 1).toString().padStart(40, "0"))
      );
      const additionalFakeShardAddress = user.address;
      await proveTx(pixCashierRoot.addShards(fakeShardAddress));

      await expect(
        pixCashierRoot.addShards([additionalFakeShardAddress])
      ).to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_SHARD_COUNT_EXCESS);
    });
  });

  describe("Function 'upgradeShardsTo()'", async () => {
    it("Executes as expected", async () => {
      const { pixCashierRoot, pixCashierRootAdmin, pixCashierShards } = await setUpFixture(deployAndConfigureContracts);

      const targetShardImplementation1: Contract = await pixCashierShardFactory.deploy() as Contract;
      await targetShardImplementation1.waitForDeployment();
      const targetShardImplementationAddress1 = getAddress(targetShardImplementation1);
      await executeUpgradeShardsTo(pixCashierRoot, pixCashierShards, targetShardImplementationAddress1);

      const targetShardImplementation2: Contract = await pixCashierShardFactory.deploy() as Contract;
      await targetShardImplementation2.waitForDeployment();
      const targetShardImplementationAddress2 = getAddress(targetShardImplementation2);
      await executeUpgradeShardsTo(pixCashierRootAdmin, pixCashierShards, targetShardImplementationAddress2);
    });

    it("Is reverted if the caller is not the owner", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(pixCashierRoot, user).upgradeShardsTo(user.address)
      ).to.be.revertedWithCustomError(
        pixCashierRoot,
        REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT
      ).withArgs(user.address, ownerRole);
    });

    it("Is reverted if the shard implementation address is zero", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        pixCashierRoot.upgradeShardsTo(ADDRESS_ZERO)
      ).to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_SHARD_ADDRESS_IZ_ZERO);
    });
  });

  describe("Function 'upgradeRootAndShardsTo()'", async () => {
    it("Executes as expected", async () => {
      const { pixCashierRoot, pixCashierShards } = await setUpFixture(deployAndConfigureContracts);

      const targetRootImplementation: Contract = await pixCashierRootFactory.deploy() as Contract;
      await targetRootImplementation.waitForDeployment();
      const targetRootImplementationAddress = getAddress(targetRootImplementation);

      const targetShardImplementation: Contract = await pixCashierShardFactory.deploy() as Contract;
      await targetShardImplementation.waitForDeployment();
      const targetShardImplementationAddress = getAddress(targetShardImplementation);

      const oldRootImplementationAddress = await upgrades.erc1967.getImplementationAddress(getAddress(pixCashierRoot));
      expect(oldRootImplementationAddress).to.not.eq(targetRootImplementationAddress);

      const oldShardImplementationAddresses: string[] = await getImplementationAddresses(pixCashierShards);
      oldShardImplementationAddresses.forEach((_, i) => {
        expect(oldShardImplementationAddresses[i]).to.not.eq(
          targetShardImplementationAddress,
          `oldShardImplementationAddresses[${i}] is wrong`
        );
      });

      await proveTx(pixCashierRoot.upgradeRootAndShardsTo(
        targetRootImplementationAddress,
        targetShardImplementationAddress
      ));

      const newRootImplementationAddress = await upgrades.erc1967.getImplementationAddress(getAddress(pixCashierRoot));
      expect(newRootImplementationAddress).to.eq(targetRootImplementationAddress);

      const newShardImplementationAddresses: string[] = await getImplementationAddresses(pixCashierShards);
      newShardImplementationAddresses.forEach((_, i) => {
        expect(newShardImplementationAddresses[i]).to.eq(
          targetShardImplementationAddress,
          `newShardImplementationAddresses[${i}] is wrong`
        );
      });
    });

    it("Is reverted if the caller is not the owner", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(pixCashierRoot, user).upgradeRootAndShardsTo(
          user.address,
          user.address
        )
      ).to.be.revertedWithCustomError(
        pixCashierRoot,
        REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT
      ).withArgs(user.address, ownerRole);
    });

    it("Is reverted if the root implementation address is zero", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      const targetShardImplementation: Contract = await pixCashierShardFactory.deploy() as Contract;
      await targetShardImplementation.waitForDeployment();
      const targetShardImplementationAddress = getAddress(targetShardImplementation);

      await expect(
        pixCashierRoot.upgradeRootAndShardsTo(
          ADDRESS_ZERO,
          targetShardImplementationAddress
        )
      ).to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_ROOT_ADDRESS_IZ_ZERO);
    });

    it("Is reverted if the shard implementation address is zero", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      const targetRootImplementation: Contract = await pixCashierRootFactory.deploy() as Contract;
      await targetRootImplementation.waitForDeployment();
      const targetRootImplementationAddress = getAddress(targetRootImplementation);

      await expect(
        pixCashierRoot.upgradeRootAndShardsTo(
          targetRootImplementationAddress,
          ADDRESS_ZERO
        )
      ).to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_SHARD_ADDRESS_IZ_ZERO);
    });
  });

  describe("Function 'configureShardAdmin()'", async () => {
    it("Executes as expected", async () => {
      const { pixCashierRoot, pixCashierRootAdmin, pixCashierShards } = await setUpFixture(deployAndConfigureContracts);

      for (const pixCashierShard of pixCashierShards) {
        expect(await pixCashierShard.isAdmin(user.address)).to.eq(false);
      }

      const tx1 = await proveTx(pixCashierRoot.configureShardAdmin(user.address, true));
      await expect(tx1)
      .to.emit(pixCashierRoot, EVENT_NAME_SHARD_ADMIN_CONFIGURED)
      .withArgs(
        user.address,
        true
      );

      for (const pixCashierShard of pixCashierShards) {
        expect(await pixCashierShard.isAdmin(user.address)).to.eq(true);
      }

      const tx2 = await proveTx(pixCashierRootAdmin.configureShardAdmin(user.address, false));
      await expect(tx2)
      .to.emit(pixCashierRootAdmin, EVENT_NAME_SHARD_ADMIN_CONFIGURED)
      .withArgs(
        user.address,
        false
      );

      for (const pixCashierShard of pixCashierShards) {
        expect(await pixCashierShard.isAdmin(user.address)).to.eq(false);
      }
    });

    it("Is reverted if the caller is not the owner or admin", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(pixCashierRoot, user).configureShardAdmin(user.address, true)
      ).to.be.revertedWithCustomError(
        pixCashierRoot,
        REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT
      ).withArgs(user.address, ownerRole);
    });
  });

  describe("Function 'cashIn()' accompanied by the 'registerCashIn()' one", async () => {
    it("Executes as expected", async () => {
      const { pixCashierRoot, pixCashierRootAdmin, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      const [cashIn, cashIn2] = defineTestCashIns(2);
      await executeCashIn(pixCashierRoot, tokenMock, cashIn);
      await executeCashIn(pixCashierRootAdmin, tokenMock, cashIn2);
    });

    it("Is reverted if the contract is paused", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await pauseContract(pixCashierRoot);
      await expect(
        connect(pixCashierRoot, cashier).cashIn(user.address, TOKEN_AMOUNT, TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the cashier role", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(pixCashierRoot, deployer).cashIn(user.address, TOKEN_AMOUNT, TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(
        pixCashierRoot,
        REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT
      ).withArgs(deployer.address, cashierRole);
    });

    it("Is reverted if the account address is zero", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(pixCashierRoot, cashier).cashIn(ADDRESS_ZERO, TOKEN_AMOUNT, TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_ACCOUNT_IS_ZERO);
    });

    it("Is reverted if the token amount is zero", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(pixCashierRoot, cashier).cashIn(user.address, TOKEN_AMOUNT_ZERO, TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_AMOUNT_IS_ZERO);
    });

    it("Is reverted if the token amount is greater than 64-bit unsigned integer", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      const amount = BigInt("0x10000000000000000");
      await expect(
        connect(pixCashierRoot, cashier).cashIn(user.address, amount, TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_AMOUNT_EXCESS);
    });

    it("Is reverted if the off-chain transaction ID is zero", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(pixCashierRoot, cashier).cashIn(user.address, TOKEN_AMOUNT, TRANSACTION_ID_ZERO)
      ).to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_TRANSACTION_ID_IS_ZERO);
    });

    it("Is reverted if minting function returns 'false'", async () => {
      const { pixCashierRoot, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      await proveTx(tokenMock.setMintResult(false));
      await expect(
        connect(pixCashierRoot, cashier).cashIn(user.address, TOKEN_AMOUNT, TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_TOKEN_MINTING_FAILURE);
    });

    it("Is reverted if the cash-in with the provided txId is already executed", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await proveTx(connect(pixCashierRoot, cashier).cashIn(user.address, TOKEN_AMOUNT, TRANSACTION_ID1));
      await expect(connect(pixCashierRoot, cashier).cashIn(deployer.address, TOKEN_AMOUNT + 1, TRANSACTION_ID1))
        .to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_CASH_IN_ALREADY_EXECUTED);
    });
  });

  describe("Functions 'cashInPremint()' accompanied by the 'registerCashIn()' one", async () => {
    it("Executes as expected", async () => {
      const { pixCashierRoot, pixCashierRootAdmin, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      const [cashIn, cashIn2] = defineTestCashIns(2, RELEASE_TIMESTAMP);
      await executeCashInPremint(pixCashierRoot, tokenMock, cashIn);
      await executeCashInPremint(pixCashierRootAdmin, tokenMock, cashIn2);
    });

    it("Is reverted if the contract is paused", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await pauseContract(pixCashierRoot);
      await expect(
        connect(pixCashierRoot, cashier).cashInPremint(user.address, TOKEN_AMOUNT, TRANSACTION_ID1, RELEASE_TIMESTAMP)
      ).to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the cashier role", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(pixCashierRoot, deployer).cashInPremint(user.address, TOKEN_AMOUNT, TRANSACTION_ID1, RELEASE_TIMESTAMP)
      ).to.be.revertedWithCustomError(
        pixCashierRoot,
        REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT
      ).withArgs(deployer.address, cashierRole);
    });

    it("Is reverted if the premint release time is zero", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(pixCashierRoot, cashier).cashInPremint(user.address, TOKEN_AMOUNT, TRANSACTION_ID1, RELEASE_TIMESTAMP_ZERO)
      ).to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_INAPPROPRIATE_PREMINT_RELEASE_TIME);
    });

    it("Is reverted if the account address is zero", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(pixCashierRoot, cashier).cashInPremint(
          ADDRESS_ZERO,
          TOKEN_AMOUNT,
          TRANSACTION_ID1,
          RELEASE_TIMESTAMP
        )
      ).to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_ACCOUNT_IS_ZERO);
    });

    it("Is reverted if the token amount is zero", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(pixCashierRoot, cashier).cashInPremint(user.address, TOKEN_AMOUNT_ZERO, TRANSACTION_ID1, RELEASE_TIMESTAMP)
      ).to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_AMOUNT_IS_ZERO);
    });

    it("Is reverted if the token amount is greater than 64-bit unsigned integer", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      const amount = BigInt("0x10000000000000000");
      await expect(
        connect(pixCashierRoot, cashier).cashInPremint(user.address, amount, TRANSACTION_ID1, RELEASE_TIMESTAMP)
      ).to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_AMOUNT_EXCESS);
    });

    it("Is reverted if the off-chain transaction ID is zero", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(pixCashierRoot, cashier).cashInPremint(
          user.address,
          TOKEN_AMOUNT,
          TRANSACTION_ID_ZERO,
          RELEASE_TIMESTAMP
        )
      ).to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_TRANSACTION_ID_IS_ZERO);
    });

    it("Is reverted if the cash-in with the provided txId is already executed", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await proveTx(connect(pixCashierRoot, cashier).cashIn(user.address, TOKEN_AMOUNT, TRANSACTION_ID1));
      await expect(
        connect(pixCashierRoot, cashier).cashInPremint(user.address, TOKEN_AMOUNT, TRANSACTION_ID1, RELEASE_TIMESTAMP)
      ).to.be.revertedWithCustomError(
        pixCashierRoot,
        REVERT_ERROR_IF_CASH_IN_ALREADY_EXECUTED
      );
    });
  });

  describe("Functions 'cashInPremintRevoke()' accompanied by the 'revokeCashIn()' one", async () => {
    it("Executes as expected", async () => {
      const { pixCashierRoot, pixCashierRootAdmin, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      const [cashIn, cashIn2] = defineTestCashIns(2, RELEASE_TIMESTAMP);
      await executeCashInPremintRevoke(pixCashierRoot, tokenMock, cashIn);
      await executeCashInPremintRevoke(pixCashierRootAdmin, tokenMock, cashIn2);
    });

    it("Is reverted if the contract is paused", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await pauseContract(pixCashierRoot);
      await expect(
        connect(pixCashierRoot, cashier).cashInPremintRevoke(TRANSACTION_ID1, RELEASE_TIMESTAMP)
      ).to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the cashier role", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(pixCashierRoot, deployer).cashInPremintRevoke(TRANSACTION_ID1, RELEASE_TIMESTAMP)
      ).to.be.revertedWithCustomError(
        pixCashierRoot,
        REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT
      ).withArgs(deployer.address, cashierRole);
    });

    it("Is reverted if the premint release time is zero", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(pixCashierRoot, cashier).cashInPremintRevoke(TRANSACTION_ID1, RELEASE_TIMESTAMP_ZERO)
      ).to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_INAPPROPRIATE_PREMINT_RELEASE_TIME);
    });

    it("Is reverted if the off-chain transaction ID is zero", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(pixCashierRoot, cashier).cashInPremintRevoke(
          TRANSACTION_ID_ZERO,
          RELEASE_TIMESTAMP
        )
      ).to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_TRANSACTION_ID_IS_ZERO);
    });

    it("Is reverted if the cash-in with the provided txId does not exist", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(connect(pixCashierRoot, cashier).cashInPremintRevoke(TRANSACTION_ID1, RELEASE_TIMESTAMP))
        .to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_INAPPROPRIATE_CASH_IN_STATUS);
    });
  });

  describe("Function 'reschedulePremintRelease()'", async () => {
    const originalReleaseTimestamp = 123;
    const targetReleaseTimestamp = 321;

    it("Executes as expected", async () => {
      const { pixCashierRoot, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      const tx: TransactionResponse = await connect(pixCashierRoot, cashier).reschedulePremintRelease(
        originalReleaseTimestamp,
        targetReleaseTimestamp
      );

      await expect(tx)
        .to.emit(tokenMock, EVENT_NAME_MOCK_PREMINT_PREMINT_RESCHEDULING)
        .withArgs(
          originalReleaseTimestamp,
          targetReleaseTimestamp
        );
    });

    it("Is reverted if the contract is paused", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await pauseContract(pixCashierRoot);
      await expect(
        connect(pixCashierRoot, cashier).reschedulePremintRelease(
          originalReleaseTimestamp,
          targetReleaseTimestamp
        )
      ).to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the cashier role", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(pixCashierRoot, deployer).reschedulePremintRelease(
          originalReleaseTimestamp,
          targetReleaseTimestamp
        )
      ).to.be.revertedWithCustomError(
        pixCashierRoot,
        REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT
      ).withArgs(deployer.address, cashierRole);
    });
  });

  describe("Function 'requestCashOutFrom()' accompanied by the 'registerCashOut()' one", async () => {
    it("Executes as expected", async () => {
      const { pixCashierRoot, pixCashierRootAdmin, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      const [cashOut, cashOut2] = defineTestCashOuts(2);
      await executeRequestCashOut(pixCashierRoot, tokenMock, cashOut);
      await executeRequestCashOut(pixCashierRootAdmin, tokenMock, cashOut2);
    });

    it("Is reverted if the contract is paused", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await pauseContract(pixCashierRoot);
      await expect(
        connect(pixCashierRoot, cashier).requestCashOutFrom(user.address, TOKEN_AMOUNT, TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the cashier role", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(pixCashierRoot, deployer).requestCashOutFrom(user.address, TOKEN_AMOUNT, TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(
        pixCashierRoot,
        REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT
      ).withArgs(deployer.address, cashierRole);
    });

    it("Is reverted if the account address is zero", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(pixCashierRoot, cashier).requestCashOutFrom(ADDRESS_ZERO, TOKEN_AMOUNT, TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_ACCOUNT_IS_ZERO);
    });

    it("Is reverted if the token amount is zero", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(pixCashierRoot, cashier).requestCashOutFrom(user.address, TOKEN_AMOUNT_ZERO, TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_AMOUNT_IS_ZERO);
    });

    it("Is reverted if the token amount is greater than 64-bit unsigned integer", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      const amount: bigint = BigInt("0x10000000000000000");
      await expect(
        connect(pixCashierRoot, cashier).requestCashOutFrom(user.address, amount, TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_AMOUNT_EXCESS);
    });

    it("Is reverted if the off-chain transaction ID is zero", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(pixCashierRoot, cashier).requestCashOutFrom(user.address, TOKEN_AMOUNT, TRANSACTION_ID_ZERO)
      ).to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_TRANSACTION_ID_IS_ZERO);
    });

    it("Is reverted if the cash-out with the provided txId is already pending", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await connect(pixCashierRoot, cashier).requestCashOutFrom(user.address, TOKEN_AMOUNT, TRANSACTION_ID1);
      await expect(connect(pixCashierRoot, cashier).requestCashOutFrom(user.address, TOKEN_AMOUNT, TRANSACTION_ID1))
        .to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_STATUS);
    });

    it("Is reverted if the cash-out with the provided txId is already confirmed", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await connect(pixCashierRoot, cashier).requestCashOutFrom(user.address, TOKEN_AMOUNT, TRANSACTION_ID1);
      await connect(pixCashierRoot, cashier).confirmCashOut(TRANSACTION_ID1);
      await expect(connect(pixCashierRoot, cashier).requestCashOutFrom(user.address, TOKEN_AMOUNT, TRANSACTION_ID1))
        .to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_STATUS);
    });

    it("Is reverted if txId of a reversed cash-out operation is reused for another account", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await connect(pixCashierRoot, cashier).requestCashOutFrom(user.address, TOKEN_AMOUNT, TRANSACTION_ID1);
      await connect(pixCashierRoot, cashier).reverseCashOut(TRANSACTION_ID1);
      await expect(connect(pixCashierRoot, cashier).requestCashOutFrom(deployer.address, TOKEN_AMOUNT, TRANSACTION_ID1))
        .to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_ACCOUNT);
    });

    it("Is reverted if the user has not enough tokens", async () => {
      const { pixCashierRoot, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      const tokenAmount = INITIAL_USER_BALANCE + 1;
      await expect(
        connect(pixCashierRoot, cashier).requestCashOutFrom(user.address, tokenAmount, TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(
        tokenMock,
        REVERT_ERROR_IF_ERC20_TOKEN_TRANSFER_AMOUNT_EXCEEDS_BALANCE
      ).withArgs(user.address, INITIAL_USER_BALANCE, tokenAmount);
    });
  });

  describe("Function 'confirmCashOut()' accompanied by the 'processCashOut()' one", async () => {
    it("Executes as expected", async () => {
      const { pixCashierRoot, pixCashierRootAdmin, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      const [cashOut, cashOut2] = defineTestCashOuts(2);
      await executeCashOutConfirm(pixCashierRoot, tokenMock, cashOut);
      await executeCashOutConfirm(pixCashierRootAdmin, tokenMock, cashOut2);
    });

    it("Is reverted if the contract is paused", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await pauseContract(pixCashierRoot);
      await expect(
        connect(pixCashierRoot, cashier).confirmCashOut(TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the cashier role", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(pixCashierRoot, deployer).confirmCashOut(TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(
        pixCashierRoot,
        REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT
      ).withArgs(deployer.address, cashierRole);
    });

    it("Is reverted if the off-chain transaction ID is zero", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(pixCashierRoot, cashier).confirmCashOut(TRANSACTION_ID_ZERO)
      ).to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_TRANSACTION_ID_IS_ZERO);
    });

    it("Is reverted if the cash-out with the provided txId was not requested previously", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(connect(pixCashierRoot, cashier).confirmCashOut(TRANSACTION_ID1))
        .to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_STATUS);
    });
  });

  describe("Function 'reverseCashOut()' accompanied by the 'processCashOut()' one", async () => {
    it("Executes as expected", async () => {
      const { pixCashierRoot, pixCashierRootAdmin, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      const [cashOut, cashOut2] = defineTestCashOuts(2);
      await executeReverseCashOut(pixCashierRoot, tokenMock, cashOut);
      await executeReverseCashOut(pixCashierRootAdmin, tokenMock, cashOut2);
    });

    it("Is reverted if the contract is paused", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await pauseContract(pixCashierRoot);
      await expect(
        connect(pixCashierRoot, cashier).reverseCashOut(TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the cashier role", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(pixCashierRoot, deployer).reverseCashOut(TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(
        pixCashierRoot,
        REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT
      ).withArgs(deployer.address, cashierRole);
    });

    it("Is reverted if the off-chain transaction ID is zero", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(pixCashierRoot, cashier).reverseCashOut(TRANSACTION_ID_ZERO)
      ).to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_TRANSACTION_ID_IS_ZERO);
    });

    it("Is reverted if the cash-out with the provided txId was not requested previously", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(connect(pixCashierRoot, cashier).reverseCashOut(TRANSACTION_ID1))
        .to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_STATUS);
    });
  });

  describe("Function 'getPendingCashOutTxIds()'", async () => {
    it("Returns expected values in different cases", async () => {
      const { pixCashierRoot } = await setUpFixture(deployAndConfigureContracts);
      const cashOuts = defineTestCashOuts(3);
      const txIds = cashOuts.map(cashOut => cashOut.txId);
      await requestCashOuts(pixCashierRoot, cashOuts);
      let actualTxIds: string[];

      actualTxIds = await pixCashierRoot.getPendingCashOutTxIds(0, 50);
      expect(actualTxIds).to.be.deep.equal(txIds);

      actualTxIds = await pixCashierRoot.getPendingCashOutTxIds(0, 2);
      expect(actualTxIds).to.be.deep.equal([txIds[0], txIds[1]]);

      actualTxIds = await pixCashierRoot.getPendingCashOutTxIds(1, 2);
      expect(actualTxIds).to.be.deep.equal([txIds[1], txIds[2]]);

      actualTxIds = await pixCashierRoot.getPendingCashOutTxIds(1, 1);
      expect(actualTxIds).to.be.deep.equal([txIds[1]]);

      actualTxIds = await pixCashierRoot.getPendingCashOutTxIds(1, 50);
      expect(actualTxIds).to.be.deep.equal([txIds[1], txIds[2]]);

      actualTxIds = await pixCashierRoot.getPendingCashOutTxIds(3, 50);
      expect(actualTxIds).to.be.deep.equal([]);

      actualTxIds = await pixCashierRoot.getPendingCashOutTxIds(1, 0);
      expect(actualTxIds).to.be.deep.equal([]);
    });
  });

  describe("Function 'getShardByTxId()'", async () => {
    it("Returns expected values for different transaction IDs", async () => {
      const { pixCashierRoot, pixCashierShards } = await setUpFixture(deployAndConfigureContracts);
      const shardCount = pixCashierShards.length;
      const expectedShardIndexes: number[] = TRANSACTIONS_ARRAY.map(txId => defineShardIndexByTxId(txId, shardCount));
      const expectedShardAddresses: string[] = expectedShardIndexes.map(i => getAddress(pixCashierShards[i]));

      for (let i = 0; i < TRANSACTIONS_ARRAY.length; ++i) {
        const txId = TRANSACTIONS_ARRAY[i];
        const expectedShardAddress = expectedShardAddresses[i];
        expect(await pixCashierRoot.getShardByTxId(txId)).to.eq(
          expectedShardAddress,
          `Shard address for transaction ID ${txId}`
        );
      }
    });
  });

  describe("Function 'getShardRange()'", async () => {
    it("Returns expected values in different cases", async () => {
      const { pixCashierRoot, pixCashierShards } = await setUpFixture(deployAndConfigureContracts);
      const shardAddresses = pixCashierShards.map(shard => getAddress(shard));
      const shardCount = pixCashierShards.length;
      let actualShardAddresses: string[];

      expect(pixCashierShards.length).greaterThanOrEqual(3);
      expect(pixCashierShards.length).lessThan(50);

      actualShardAddresses = await pixCashierRoot.getShardRange(0, 50);
      expect(actualShardAddresses).to.be.deep.equal(shardAddresses);

      actualShardAddresses = await pixCashierRoot.getShardRange(0, 2);
      expect(actualShardAddresses).to.be.deep.equal([shardAddresses[0], shardAddresses[1]]);

      actualShardAddresses = await pixCashierRoot.getShardRange(1, 2);
      expect(actualShardAddresses).to.be.deep.equal([shardAddresses[1], shardAddresses[2]]);

      actualShardAddresses = await pixCashierRoot.getShardRange(1, 1);
      expect(actualShardAddresses).to.be.deep.equal([shardAddresses[1]]);

      actualShardAddresses = await pixCashierRoot.getShardRange(1, 50);
      expect(actualShardAddresses).to.be.deep.equal(shardAddresses.slice(1));

      actualShardAddresses = await pixCashierRoot.getShardRange(shardCount, 50);
      expect(actualShardAddresses).to.be.deep.equal(shardAddresses.slice(shardCount));

      actualShardAddresses = await pixCashierRoot.getShardRange(1, 0);
      expect(actualShardAddresses).to.be.deep.equal([]);
    });
  });

  describe("Complex scenarios", async () => {
    it("Scenario 1 with cash-out reversing executes successfully", async () => {
      const { pixCashierRoot, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      const [cashOut] = defineTestCashOuts();
      await requestCashOuts(pixCashierRoot, [cashOut]);
      await proveTx(connect(pixCashierRoot, cashier).reverseCashOut(cashOut.txId));
      cashOut.status = CashOutStatus.Reversed;
      await checkPixCashierState(tokenMock, pixCashierRoot, [cashOut]);

      // After reversing a cash-out with the same txId can't be reversed again.
      await expect(connect(pixCashierRoot, cashier).reverseCashOut(cashOut.txId))
        .to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_STATUS);

      // After reversing a cash-out with the same txId can't be confirmed.
      await expect(connect(pixCashierRoot, cashier).confirmCashOut(cashOut.txId))
        .to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_STATUS);

      expect(await tokenMock.balanceOf(cashOut.account.address)).to.equal(INITIAL_USER_BALANCE);

      // After reversing a cash-out with the same txId can be requested again.
      await requestCashOuts(pixCashierRoot, [cashOut]);
      await checkPixCashierState(tokenMock, pixCashierRoot, [cashOut]);
      expect(await tokenMock.balanceOf(cashOut.account.address)).to.equal(INITIAL_USER_BALANCE - cashOut.amount);
    });

    it("Scenario 2 with cash-out confirming executes successfully", async () => {
      const { pixCashierRoot, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      const [cashOut] = defineTestCashOuts();
      await requestCashOuts(pixCashierRoot, [cashOut]);
      await proveTx(connect(pixCashierRoot, cashier).confirmCashOut(cashOut.txId));
      cashOut.status = CashOutStatus.Confirmed;
      await checkPixCashierState(tokenMock, pixCashierRoot, [cashOut]);

      // After confirming a cash-out with the same txId can't be reversed again.
      await expect(connect(pixCashierRoot, cashier).reverseCashOut(cashOut.txId))
        .to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_STATUS);

      // After confirming a cash-out with the same txId can't be confirmed.
      await expect(connect(pixCashierRoot, cashier).confirmCashOut(cashOut.txId))
        .to.be.revertedWithCustomError(pixCashierRoot, REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_STATUS);

      expect(await tokenMock.balanceOf(cashOut.account.address)).to.equal(INITIAL_USER_BALANCE - cashOut.amount);
    });
  });

  describe("Scenarios for distributing data among shards", async () => {
    async function prepareTest(): Promise<{
      fixture: Fixture,
      txIds: string[],
      shardMatchIndexes: number[],
      txIdsByShardIndex: string[][]
    }> {
      const fixture = await setUpFixture(deployAndConfigureContracts);
      const shardCount = fixture.pixCashierShards.length;
      const txIdCount = shardCount * 3;
      const txIdIndexes = Array.from(Array(txIdCount).keys());
      const txIds: string[] = txIdIndexes.map(i => ethers.encodeBytes32String("txId" + i.toString()));
      const shardMatchIndexes: number[] = txIds.map(txId => defineShardIndexByTxId(txId, shardCount));
      const shardOrderedIndexes: number[] = Array.from(Array(shardCount).keys());
      const txIdsByShardIndex: string[][] = Array.from({ length: shardCount }, () => []);
      for (let i = 0; i < txIds.length; ++i) {
        const txId = txIds[i];
        const shardMatchIndex = shardMatchIndexes[i];
        txIdsByShardIndex[shardMatchIndex].push(txId);
      }

      expect(shardMatchIndexes).to.include.members(shardOrderedIndexes);

      return { fixture, txIds, shardMatchIndexes, txIdsByShardIndex };
    }

    it("Cash-in data distribution executes as expected", async () => {
      const { fixture, txIds, shardMatchIndexes, txIdsByShardIndex } = await prepareTest();
      const { pixCashierRoot, pixCashierShards } = fixture;
      const cashIns: TestCashIn[] = txIds.map((txId, i) => ({
        account: user,
        amount: i + 1,
        txId,
        status: CashInStatus.Executed
      }));
      for (const cashIn of cashIns) {
        await proveTx(connect(pixCashierRoot, cashier).cashIn(
          cashIn.account.address,
          cashIn.amount,
          cashIn.txId
        ));
      }
      // Get and check structures one by one
      for (let i = 0; i < txIds.length; ++i) {
        const txId = txIds[i];
        const shardIndex = shardMatchIndexes[i];
        const expectedCashIn = cashIns[i];
        const actualCashIn = await pixCashierShards[shardIndex].getCashIn(txId);
        checkCashInEquality(actualCashIn, expectedCashIn, i);
      }

      // Get and check structures by shards
      for (let i = 0; i < txIdsByShardIndex.length; ++i) {
        const txIds = txIdsByShardIndex[i];
        const expectedCashIns: TestCashIn[] = cashIns.filter(cashIn => txIds.includes(cashIn.txId));
        const actualCashIns = await pixCashierShards[i].getCashIns(txIds);
        for (let j = 0; j < txIds.length; ++j) {
          checkCashInEquality(actualCashIns[j], expectedCashIns[j], j);
        }
      }
    });

    it("Cash-out data distribution executes as expected", async () => {
      const { fixture, txIds, shardMatchIndexes, txIdsByShardIndex } = await prepareTest();
      const { pixCashierRoot, pixCashierShards } = fixture;
      const cashOuts: TestCashOut[] = txIds.map((txId, i) => ({
        account: user,
        amount: i + 1,
        txId,
        status: CashOutStatus.Pending
      }));
      await requestCashOuts(pixCashierRoot, cashOuts);

      // Get and check structures one by one
      for (let i = 0; i < txIds.length; ++i) {
        const txId = txIds[i];
        const shardIndex = shardMatchIndexes[i];
        const expectedCashOut = cashOuts[i];
        const actualCashOut = await pixCashierShards[shardIndex].getCashOut(txId);
        checkCashOutEquality(actualCashOut, expectedCashOut, i);
      }

      // Get and check structures by shards
      for (let i = 0; i < txIdsByShardIndex.length; ++i) {
        const txIds = txIdsByShardIndex[i];
        const expectedCashOuts: TestCashOut[] = cashOuts.filter(cashOut => txIds.includes(cashOut.txId));
        const actualCashOuts = await pixCashierShards[i].getCashOuts(txIds);
        for (let j = 0; j < txIds.length; ++j) {
          checkCashOutEquality(actualCashOuts[j], expectedCashOuts[j], j);
        }
      }
    });
  });

  describe("Special scenarios for shard functions", async () => {
    it("The 'registerCashIn()' function is reverted if it is called not by the owner or admin", async () => {
      const { pixCashierShards } = await setUpFixture(deployAndConfigureContracts);
      await expect(connect(pixCashierShards[0], deployer).registerCashIn(
        user.address, // account
        1, // amount
        TRANSACTION_ID1,
        CashInStatus.Executed
      )).to.be.revertedWithCustomError(pixCashierShards[0], REVERT_ERROR_IF_UNAUTHORIZED);
    });

    it("The 'revokeCashIn()' function is reverted if it is called not by the owner or admin", async () => {
      const { pixCashierShards } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(pixCashierShards[0], deployer).revokeCashIn(TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(pixCashierShards[0], REVERT_ERROR_IF_UNAUTHORIZED);
    });

    it("The 'registerCashOut()' function is reverted if it is called not by the owner or admin", async () => {
      const { pixCashierShards } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(pixCashierShards[0], deployer).registerCashOut(
          user.address, // account
          1, // amount
          TRANSACTION_ID1
        )
      ).to.be.revertedWithCustomError(pixCashierShards[0], REVERT_ERROR_IF_UNAUTHORIZED);
    });

    it("The 'registerCashOut()' function is reverted if it is called not by the owner or admin", async () => {
      const { pixCashierShards } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(pixCashierShards[0], deployer).processCashOut(
          TRANSACTION_ID1,
          CashOutStatus.Confirmed
        )
      ).to.be.revertedWithCustomError(pixCashierShards[0], REVERT_ERROR_IF_UNAUTHORIZED);
    });
  });
});
