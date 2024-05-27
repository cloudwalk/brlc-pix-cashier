import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { proveTx } from "../test-utils/eth";
import { createRevertMessageDueToMissingRole } from "../test-utils/misc";
import { TransactionResponse } from "@ethersproject/abstract-provider";

const ADDRESS_ZERO = ethers.constants.AddressZero;

enum CashInStatus {
  Nonexistent = 0,
  Executed = 1,
  PremintExecuted = 2
}

enum CashInBatchStatus {
  Nonexistent = 0,
  Executed = 1,
  PremintExecuted = 2
}

enum CashInExecutionStatus {
  Success = 0,
  AlreadyExecuted = 1,
  InappropriateStatus = 2
}

enum CashOutStatus {
  Nonexistent = 0,
  Pending = 1,
  Reversed = 2,
  Confirmed = 3
}

interface TestCashIn {
  account: SignerWithAddress;
  amount: number;
  txId: string;
  status: CashInStatus;
  releaseTimestamp?: number;
  oldAmount?: number;
}

interface TestCashInBatch {
  batchId: string;
  status: CashInBatchStatus;
}

interface TestCashOut {
  account: SignerWithAddress;
  amount: number;
  txId: string;
  status: CashOutStatus;
}

interface PixCashierState {
  tokenBalance: number;
  pendingCashOutCounter: number;
  processedCashOutCounter: number;
  pendingCashOutTxIds: string[];
  cashOutBalancePerAccount: Map<string, number>;
}

interface Fixture {
  pixCashier: Contract;
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

function checkCashInBatchEquality(
  actualOnChainCashInBatch: Record<string, unknown>,
  expectedCashInBatch: TestCashInBatch,
  cashInBatchIndex: number
) {
  expect(actualOnChainCashInBatch.status).to.equal(
    expectedCashInBatch.status,
    `cashInBatches[${cashInBatchIndex}].status is incorrect`
  );
}

async function setUpFixture<T>(func: () => Promise<T>): Promise<T> {
  if (network.name === "hardhat") {
    return loadFixture(func);
  } else {
    return func();
  }
}

describe("Contract 'PixCashier'", async () => {
  const TRANSACTION_ID1 = ethers.utils.formatBytes32String("MOCK_TRANSACTION_ID1");
  const TRANSACTION_ID2 = ethers.utils.formatBytes32String("MOCK_TRANSACTION_ID2");
  const TRANSACTION_ID3 = ethers.utils.formatBytes32String("MOCK_TRANSACTION_ID3");
  const TRANSACTIONS_ARRAY: string[] = [TRANSACTION_ID1, TRANSACTION_ID2, TRANSACTION_ID3];
  const INITIAL_USER_BALANCE = 1_000_000;
  const TOKEN_AMOUNT = 100;
  const TOKEN_AMOUNTS: number[] = [TOKEN_AMOUNT, 200, 300];
  const TOKEN_AMOUNT_ZERO = 0;
  const BALANCE_ZERO = 0;
  const RELEASE_TIMESTAMP = 123456;
  const RELEASE_TIMESTAMP_ZERO = 0;
  const BATCH_ID_STUB1 = ethers.utils.formatBytes32String("MOCK_BATCH_ID1");
  const BATCH_ID_STUB2 = ethers.utils.formatBytes32String("MOCK_BATCH_ID2");
  const TRANSACTION_ID_ZERO = ethers.constants.HashZero;
  const BATCH_ID_ZERO = ethers.constants.HashZero;

  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED = "Initializable: contract is already initialized";
  const REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED = "Pausable: paused";
  const REVERT_MESSAGE_IF_TOKEN_TRANSFER_AMOUNT_EXCEEDS_BALANCE = "ERC20: transfer amount exceeds balance";

  const REVERT_ERROR_IF_TOKEN_ADDRESS_IZ_ZERO = "ZeroTokenAddress";
  const REVERT_ERROR_IF_ACCOUNT_IS_BLOCKLISTED = "BlocklistedAccount";
  const REVERT_ERROR_IF_ACCOUNT_IS_ZERO = "ZeroAccount";
  const REVERT_ERROR_IF_AMOUNT_IS_ZERO = "ZeroAmount";
  const REVERT_ERROR_IF_CASH_IN_ALREADY_EXECUTED = "CashInAlreadyExecuted";
  const REVERT_ERROR_IF_TRANSACTION_ID_IS_ZERO = "ZeroTxId";
  const REVERT_ERROR_IF_TOKEN_MINTING_FAILURE = "TokenMintingFailure";
  const REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_ACCOUNT = "InappropriateCashOutAccount";
  const REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_STATUS = "InappropriateCashOutStatus";
  const REVERT_ERROR_IF_EMPTY_TRANSACTION_IDS_ARRAY = "EmptyTransactionIdsArray";
  const REVERT_ERROR_IF_INVALID_BATCH_ARRAYS = "InvalidBatchArrays";
  const REVERT_ERROR_IF_CASH_IN_BATCH_ALREADY_EXECUTED = "CashInBatchAlreadyExecuted";
  const REVERT_ERROR_IF_BATCH_ID_IS_ZERO = "ZeroBatchId";
  const REVERT_ERROR_IF_INAPPROPRIATE_PREMINT_RELEASE_TIME = "InappropriatePremintReleaseTime";
  const REVERT_ERROR_IF_INAPPROPRIATE_CASH_IN_STATUS = "InappropriateCashInStatus";

  const EVENT_NAME_CASH_IN = "CashIn";
  const EVENT_NAME_CASH_IN_BATCH = "CashInBatch";
  const EVENT_NAME_CASH_IN_PREMINT = "CashInPremint";
  const EVENT_NAME_CASH_OUT_REQUESTING = "RequestCashOut";
  const EVENT_NAME_CASH_OUT_REVERSING = "ReverseCashOut";
  const EVENT_NAME_CASH_OUT_CONFIRMATION = "ConfirmCashOut";
  const EVENT_NAME_MOCK_PREMINT_INCREASING = "MockPremintIncreasing";
  const EVENT_NAME_MOCK_PREMINT_DECREASING = "MockPremintDecreasing";
  const EVENT_NAME_MOCK_PREMINT_PREMINT_RESCHEDULING = "MockPremintReleaseRescheduling";

  let pixCashierFactory: ContractFactory;
  let tokenMockFactory: ContractFactory;
  let deployer: SignerWithAddress;
  let cashier: SignerWithAddress;
  let user: SignerWithAddress;
  let users: SignerWithAddress[];
  let userAddresses: string[];

  const ownerRole: string = ethers.utils.id("OWNER_ROLE");
  const blocklisterRole: string = ethers.utils.id("BLOCKLISTER_ROLE");
  const pauserRole: string = ethers.utils.id("PAUSER_ROLE");
  const rescuerRole: string = ethers.utils.id("RESCUER_ROLE");
  const cashierRole: string = ethers.utils.id("CASHIER_ROLE");

  before(async () => {
    pixCashierFactory = await ethers.getContractFactory("PixCashier");
    tokenMockFactory = await ethers.getContractFactory("ERC20TokenMock");

    let secondUser: SignerWithAddress;
    let thirdUser: SignerWithAddress;
    [deployer, cashier, user, secondUser, thirdUser] = await ethers.getSigners();
    users = [user, secondUser, thirdUser];
    userAddresses = users.map(user => user.address);
  });

  async function deployTokenMock(): Promise<Contract> {
    const name = "ERC20 Test";
    const symbol = "TEST";

    const tokenMock: Contract = await upgrades.deployProxy(tokenMockFactory, [name, symbol]);
    await tokenMock.deployed();

    return tokenMock;
  }

  async function deployContracts(): Promise<Fixture> {
    const tokenMock = await deployTokenMock();
    const pixCashier: Contract = await upgrades.deployProxy(pixCashierFactory, [tokenMock.address]);
    await pixCashier.deployed();

    return { pixCashier, tokenMock };
  }

  async function deployAndConfigureContracts(): Promise<Fixture> {
    const tokenMock = await deployTokenMock();
    const pixCashier: Contract = await upgrades.deployProxy(pixCashierFactory, [tokenMock.address]);
    await pixCashier.deployed();
    await proveTx(pixCashier.grantRole(cashierRole, cashier.address));
    for (const user of users) {
      await proveTx(tokenMock.mint(user.address, INITIAL_USER_BALANCE));
      await proveTx(tokenMock.connect(user).approve(pixCashier.address, ethers.constants.MaxUint256));
    }

    return { pixCashier, tokenMock };
  }

  async function pauseContract(contract: Contract) {
    await proveTx(contract.grantRole(pauserRole, deployer.address));
    await proveTx(contract.pause());
  }

  async function requestCashOuts(pixCashier: Contract, cashOuts: TestCashOut[]) {
    for (const cashOut of cashOuts) {
      await proveTx(
        pixCashier.connect(cashier).requestCashOutFrom(cashOut.account.address, cashOut.amount, cashOut.txId)
      );
      cashOut.status = CashOutStatus.Pending;
    }
  }

  function defineExpectedPixCashierState(cashOuts: TestCashOut[]): PixCashierState {
    let tokenBalance: number = 0;
    let pendingCashOutCounter: number = 0;
    let processedCashOutCounter: number = 0;
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
      if (cashOut.status == CashOutStatus.Reversed || cashOut.status == CashOutStatus.Confirmed) {
        ++processedCashOutCounter;
      }
    }

    return {
      tokenBalance,
      pendingCashOutCounter,
      processedCashOutCounter,
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

  async function checkCashInBatchStructuresOnBlockchain(pixCashier: Contract, cashInBatches: TestCashInBatch[]) {
    const batchIds: string[] = cashInBatches.map(cashInBatch => cashInBatch.batchId);
    const actualCashInBatches: Record<string, unknown>[] = await pixCashier.getCashInBatches(batchIds);
    for (let i = 0; i < cashInBatches.length; ++i) {
      const cashInBatch: TestCashInBatch = cashInBatches[i];
      const actualCashInBatch: Record<string, unknown> = await pixCashier.getCashInBatch(cashInBatch.batchId);
      checkCashInBatchEquality(actualCashInBatch, cashInBatch, i);
      checkCashInBatchEquality(actualCashInBatches[i], cashInBatch, i);
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
    fixture: Fixture,
    cashOuts: TestCashOut[],
    expectedProcessedCashOutCounter?: number
  ) {
    const { tokenMock, pixCashier } = fixture;
    const expectedState: PixCashierState = defineExpectedPixCashierState(cashOuts);
    await checkCashOutStructuresOnBlockchain(pixCashier, cashOuts);

    expect(await tokenMock.balanceOf(pixCashier.address)).to.equal(
      expectedState.tokenBalance,
      `The PIX cashier total balance is wrong`
    );

    const actualPendingCashOutCounter = await pixCashier.pendingCashOutCounter();
    expect(actualPendingCashOutCounter).to.equal(
      expectedState.pendingCashOutCounter,
      `The pending cash-out counter is wrong`
    );

    if (!expectedProcessedCashOutCounter) {
      expectedProcessedCashOutCounter = expectedState.processedCashOutCounter;
    }
    expect(await pixCashier.processedCashOutCounter()).to.equal(
      expectedProcessedCashOutCounter,
      `The processed cash-out counter is wrong`
    );

    const actualPendingCashOutTxIds: string[] = await pixCashier.getPendingCashOutTxIds(0, actualPendingCashOutCounter);
    expect(actualPendingCashOutTxIds).to.deep.equal(
      expectedState.pendingCashOutTxIds,
      `The pending cash-out tx ids are wrong`
    );

    for (const account of expectedState.cashOutBalancePerAccount.keys()) {
      const expectedCashOutBalance = expectedState.cashOutBalancePerAccount.get(account);
      if (!expectedCashOutBalance) {
        continue;
      }
      expect(await pixCashier.cashOutBalanceOf(account)).to.equal(
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

  describe("Function 'initialize()'", async () => {
    it("Configures the contract as expected", async () => {
      const { pixCashier, tokenMock } = await setUpFixture(deployContracts);

      // The underlying contract address
      expect(await pixCashier.underlyingToken()).to.equal(tokenMock.address);

      // Role hashes
      expect(await pixCashier.OWNER_ROLE()).to.equal(ownerRole);
      expect(await pixCashier.PAUSER_ROLE()).to.equal(pauserRole);
      expect(await pixCashier.RESCUER_ROLE()).to.equal(rescuerRole);
      expect(await pixCashier.CASHIER_ROLE()).to.equal(cashierRole);

      // The role admins
      expect(await pixCashier.getRoleAdmin(ownerRole)).to.equal(ownerRole);
      expect(await pixCashier.getRoleAdmin(blocklisterRole)).to.equal(ownerRole);
      expect(await pixCashier.getRoleAdmin(pauserRole)).to.equal(ownerRole);
      expect(await pixCashier.getRoleAdmin(rescuerRole)).to.equal(ownerRole);
      expect(await pixCashier.getRoleAdmin(cashierRole)).to.equal(ownerRole);

      // The deployer should have the owner role, but not the other roles
      expect(await pixCashier.hasRole(ownerRole, deployer.address)).to.equal(true);
      expect(await pixCashier.hasRole(blocklisterRole, deployer.address)).to.equal(false);
      expect(await pixCashier.hasRole(pauserRole, deployer.address)).to.equal(false);
      expect(await pixCashier.hasRole(rescuerRole, deployer.address)).to.equal(false);
      expect(await pixCashier.hasRole(cashierRole, deployer.address)).to.equal(false);

      // The initial contract state is unpaused
      expect(await pixCashier.paused()).to.equal(false);

      // The initial values of counters and pending cash-outs
      expect(await pixCashier.pendingCashOutCounter()).to.equal(0);
      expect(await pixCashier.processedCashOutCounter()).to.equal(0);
      expect(await pixCashier.getPendingCashOutTxIds(0, 1)).to.be.empty;
    });

    it("Is reverted if it is called a second time", async () => {
      const { pixCashier, tokenMock } = await setUpFixture(deployContracts);
      await expect(
        pixCashier.initialize(tokenMock.address)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
    });

    it("Is reverted if the passed token address is zero", async () => {
      const anotherPixCashier: Contract = await upgrades.deployProxy(pixCashierFactory, [], {
        initializer: false
      });

      await expect(
        anotherPixCashier.initialize(ADDRESS_ZERO)
      ).to.be.revertedWithCustomError(pixCashierFactory, REVERT_ERROR_IF_TOKEN_ADDRESS_IZ_ZERO);
    });
  });

  describe("Function 'cashIn()'", async () => {
    it("Executes as expected", async () => {
      const { pixCashier, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      const [cashIn] = defineTestCashIns();
      const tx = pixCashier.connect(cashier).cashIn(
        cashIn.account.address,
        cashIn.amount,
        cashIn.txId
      );
      await expect(tx).to.changeTokenBalances(
        tokenMock,
        [pixCashier, cashIn.account],
        [0, +cashIn.amount]
      );
      await expect(tx).to.emit(pixCashier, EVENT_NAME_CASH_IN).withArgs(
        cashIn.account.address,
        cashIn.amount,
        cashIn.txId
      );

      cashIn.status = CashInStatus.Executed;
      await checkCashInStructuresOnBlockchain(pixCashier, [cashIn]);
    });

    it("Is reverted if the contract is paused", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await pauseContract(pixCashier);
      await expect(
        pixCashier.connect(cashier).cashIn(user.address, TOKEN_AMOUNT, TRANSACTION_ID1)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the cashier role", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        pixCashier.connect(deployer).cashIn(user.address, TOKEN_AMOUNT, TRANSACTION_ID1)
      ).to.be.revertedWith(createRevertMessageDueToMissingRole(deployer.address, cashierRole));
    });

    it("Is reverted if the account is blocklisted", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await proveTx(pixCashier.connect(user).selfBlocklist());
      await expect(
        pixCashier.connect(cashier).cashIn(user.address, TOKEN_AMOUNT, TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_ACCOUNT_IS_BLOCKLISTED);
    });

    it("Is reverted if the account address is zero", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        pixCashier.connect(cashier).cashIn(ADDRESS_ZERO, TOKEN_AMOUNT, TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_ACCOUNT_IS_ZERO);
    });

    it("Is reverted if the token amount is zero", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        pixCashier.connect(cashier).cashIn(user.address, TOKEN_AMOUNT_ZERO, TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_AMOUNT_IS_ZERO);
    });

    it("Is reverted if the off-chain transaction ID is zero", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        pixCashier.connect(cashier).cashIn(user.address, TOKEN_AMOUNT, TRANSACTION_ID_ZERO)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_TRANSACTION_ID_IS_ZERO);
    });

    it("Is reverted if minting function returns 'false'", async () => {
      const { pixCashier, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      await proveTx(tokenMock.setMintResult(false));
      await expect(
        pixCashier.connect(cashier).cashIn(user.address, TOKEN_AMOUNT, TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_TOKEN_MINTING_FAILURE);
    });

    it("Is reverted if the cash-in with the provided txId is already executed", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await proveTx(pixCashier.connect(cashier).cashIn(user.address, TOKEN_AMOUNT, TRANSACTION_ID1));
      await expect(pixCashier.connect(cashier).cashIn(deployer.address, TOKEN_AMOUNT + 1, TRANSACTION_ID1))
        .to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_CASH_IN_ALREADY_EXECUTED)
        .withArgs(TRANSACTION_ID1);
    });
  });

  describe("Function 'cashInPremint()'", async () => {
    it("Executes as expected", async () => {
      const { pixCashier, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      const [cashIn] = defineTestCashIns(1, RELEASE_TIMESTAMP);
      const tx = pixCashier.connect(cashier).cashInPremint(
        cashIn.account.address,
        cashIn.amount,
        cashIn.txId,
        cashIn.releaseTimestamp
      );
      await expect(tx).to.emit(pixCashier, EVENT_NAME_CASH_IN_PREMINT).withArgs(
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

      await checkCashInStructuresOnBlockchain(pixCashier, [cashIn]);
    });

    it("Is reverted if the contract is paused", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await pauseContract(pixCashier);
      await expect(
        pixCashier.connect(cashier).cashInPremint(user.address, TOKEN_AMOUNT, TRANSACTION_ID1, RELEASE_TIMESTAMP)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the cashier role", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        pixCashier.connect(deployer).cashInPremint(user.address, TOKEN_AMOUNT, TRANSACTION_ID1, RELEASE_TIMESTAMP)
      ).to.be.revertedWith(createRevertMessageDueToMissingRole(deployer.address, cashierRole));
    });

    it("Is reverted if the premint release time is zero", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        pixCashier.connect(cashier).cashInPremint(user.address, TOKEN_AMOUNT, TRANSACTION_ID1, RELEASE_TIMESTAMP_ZERO)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INAPPROPRIATE_PREMINT_RELEASE_TIME);
    });

    it("Is reverted if the account is blocklisted", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await proveTx(pixCashier.connect(user).selfBlocklist());
      await expect(
        pixCashier.connect(cashier).cashInPremint(user.address, TOKEN_AMOUNT, TRANSACTION_ID1, RELEASE_TIMESTAMP)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_ACCOUNT_IS_BLOCKLISTED);
    });

    it("Is reverted if the account address is zero", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        pixCashier.connect(cashier).cashInPremint(
          ADDRESS_ZERO,
          TOKEN_AMOUNT,
          TRANSACTION_ID1,
          RELEASE_TIMESTAMP
        )
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_ACCOUNT_IS_ZERO);
    });

    it("Is reverted if the off-chain transaction ID is zero", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        pixCashier.connect(cashier).cashInPremint(
          user.address,
          TOKEN_AMOUNT,
          TRANSACTION_ID_ZERO,
          RELEASE_TIMESTAMP
        )
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_TRANSACTION_ID_IS_ZERO);
    });

    it("Is reverted if the token amount is zero", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        pixCashier.connect(cashier).cashInPremint(user.address, TOKEN_AMOUNT_ZERO, TRANSACTION_ID1, RELEASE_TIMESTAMP)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_AMOUNT_IS_ZERO);
    });

    it("Is reverted if the cash-in with the provided txId is already executed", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await proveTx(pixCashier.connect(cashier).cashIn(user.address, TOKEN_AMOUNT, TRANSACTION_ID1));
      await expect(
        pixCashier.connect(cashier).cashInPremint(user.address, TOKEN_AMOUNT, TRANSACTION_ID1, RELEASE_TIMESTAMP)
      ).to.be.revertedWithCustomError(
        pixCashier,
        REVERT_ERROR_IF_CASH_IN_ALREADY_EXECUTED
      ).withArgs(TRANSACTION_ID1);
    });
  });

  describe("Function 'cashInPremintRevoke()'", async () => {
    it("Executes as expected", async () => {
      const { pixCashier, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      const [cashIn] = defineTestCashIns(1, RELEASE_TIMESTAMP);

      await proveTx(
        pixCashier.connect(cashier).cashInPremint(
          cashIn.account.address,
          cashIn.amount,
          cashIn.txId,
          cashIn.releaseTimestamp
        )
      );
      cashIn.status = CashInStatus.PremintExecuted;
      await checkCashInStructuresOnBlockchain(pixCashier, [cashIn]);

      const tx = pixCashier.connect(cashier).cashInPremintRevoke(
        cashIn.txId,
        cashIn.releaseTimestamp
      );
      cashIn.oldAmount = cashIn.amount;
      cashIn.amount = 0;
      cashIn.status = CashInStatus.Nonexistent;

      await expect(tx).to.emit(pixCashier, EVENT_NAME_CASH_IN_PREMINT).withArgs(
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
      await checkCashInStructuresOnBlockchain(pixCashier, [cashIn]);
    });

    it("Is reverted if the contract is paused", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await pauseContract(pixCashier);
      await expect(
        pixCashier.connect(cashier).cashInPremintRevoke(TRANSACTION_ID1, RELEASE_TIMESTAMP)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the cashier role", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        pixCashier.connect(deployer).cashInPremintRevoke(TRANSACTION_ID1, RELEASE_TIMESTAMP)
      ).to.be.revertedWith(createRevertMessageDueToMissingRole(deployer.address, cashierRole));
    });

    it("Is reverted if the premint release time is zero", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        pixCashier.connect(cashier).cashInPremintRevoke(TRANSACTION_ID1, RELEASE_TIMESTAMP_ZERO)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INAPPROPRIATE_PREMINT_RELEASE_TIME);
    });

    it("Is reverted if the account is blocklisted", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await pixCashier.connect(cashier).cashInPremint(user.address, TOKEN_AMOUNT, TRANSACTION_ID1, RELEASE_TIMESTAMP);
      await proveTx(pixCashier.connect(user).selfBlocklist());
      await expect(
        pixCashier.connect(cashier).cashInPremintRevoke(TRANSACTION_ID1, RELEASE_TIMESTAMP)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_ACCOUNT_IS_BLOCKLISTED);
    });

    it("Is reverted if the off-chain transaction ID is zero", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        pixCashier.connect(cashier).cashInPremintRevoke(
          TRANSACTION_ID_ZERO,
          RELEASE_TIMESTAMP
        )
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_TRANSACTION_ID_IS_ZERO);
    });

    it("Is reverted if the cash-in with the provided txId does not exist", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await expect(pixCashier.connect(cashier).cashInPremintRevoke(TRANSACTION_ID1, RELEASE_TIMESTAMP))
        .to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INAPPROPRIATE_CASH_IN_STATUS)
        .withArgs(TRANSACTION_ID1, CashInStatus.Nonexistent);
    });
  });

  describe("Function 'cashInBatch()'", async () => {
    it("Executes as expected even if one of the cash-in operations is already executed", async () => {
      const { pixCashier, tokenMock } = await setUpFixture(deployAndConfigureContracts);

      const cashIns = defineTestCashIns(3);
      const accountAddresses = cashIns.map(cashIn => cashIn.account.address);
      const amounts = cashIns.map(cashIn => cashIn.amount);
      const txIds = cashIns.map(cashIn => cashIn.txId);

      await proveTx(pixCashier.connect(cashier).cashIn(
        cashIns[1].account.address,
        cashIns[1].amount,
        cashIns[1].txId
      ));

      const expectedExecutionResults: CashInExecutionStatus[] = [
        CashInExecutionStatus.Success,
        CashInExecutionStatus.AlreadyExecuted,
        CashInExecutionStatus.Success
      ];

      const tx: TransactionResponse = await pixCashier.connect(cashier).cashInBatch(
        accountAddresses,
        amounts,
        txIds,
        BATCH_ID_STUB1
      );
      cashIns.forEach(cashIn => cashIn.status = CashInStatus.Executed);

      amounts[1] = 0;
      await expect(tx).to.changeTokenBalances(
        tokenMock,
        [pixCashier, ...accountAddresses],
        [0, ...amounts]
      );
      await expect(tx).to.emit(pixCashier, EVENT_NAME_CASH_IN_BATCH).withArgs(
        BATCH_ID_STUB1,
        TRANSACTIONS_ARRAY,
        expectedExecutionResults
      );
      await expect(tx).to.emit(pixCashier, EVENT_NAME_CASH_IN).withArgs(
        cashIns[0].account.address,
        cashIns[0].amount,
        cashIns[0].txId
      );
      await expect(tx).to.emit(pixCashier, EVENT_NAME_CASH_IN).withArgs(
        cashIns[2].account.address,
        cashIns[2].amount,
        cashIns[2].txId
      );

      const cashInBatches: TestCashInBatch[] = [
        { batchId: BATCH_ID_STUB1, status: CashInBatchStatus.Executed },
        { batchId: BATCH_ID_STUB2, status: CashInBatchStatus.Nonexistent }
      ];

      await checkCashInStructuresOnBlockchain(pixCashier, cashIns);
      await checkCashInBatchStructuresOnBlockchain(pixCashier, cashInBatches);
    });

    it("Is reverted if the contract is paused", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await pauseContract(pixCashier);
      await expect(
        pixCashier.connect(cashier).cashInBatch(userAddresses, TOKEN_AMOUNTS, TRANSACTIONS_ARRAY, BATCH_ID_STUB1)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the cashier role", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        pixCashier.connect(deployer).cashInBatch(userAddresses, TOKEN_AMOUNTS, TRANSACTIONS_ARRAY, BATCH_ID_STUB1)
      ).to.be.revertedWith(createRevertMessageDueToMissingRole(deployer.address, cashierRole));
    });

    it("Is reverted if one of the account addresses is zero", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      const accountsWithZero = [userAddresses[0], ADDRESS_ZERO, userAddresses[2]];
      await expect(
        pixCashier.connect(cashier).cashInBatch(accountsWithZero, TOKEN_AMOUNTS, TRANSACTIONS_ARRAY, BATCH_ID_STUB1)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_ACCOUNT_IS_ZERO);
    });

    it("Is reverted if one of the accounts is blocklisted", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await proveTx(pixCashier.connect(users[1]).selfBlocklist());
      await expect(
        pixCashier.connect(cashier).cashInBatch(userAddresses, TOKEN_AMOUNTS, TRANSACTIONS_ARRAY, BATCH_ID_STUB1)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_ACCOUNT_IS_BLOCKLISTED);
    });

    it("Is reverted if one of the token amounts is zero", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      const amountsWithZero = [TOKEN_AMOUNTS[0], TOKEN_AMOUNTS[1], TOKEN_AMOUNT_ZERO];
      await expect(
        pixCashier.connect(cashier).cashInBatch(userAddresses, amountsWithZero, TRANSACTIONS_ARRAY, BATCH_ID_STUB1)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_AMOUNT_IS_ZERO);
    });

    it("Is reverted if one of the off-chain transaction IDs is zero", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      const txIdsWithZero = [TRANSACTION_ID1, TRANSACTION_ID_ZERO, TRANSACTION_ID3];
      await expect(
        pixCashier.connect(cashier).cashInBatch(userAddresses, TOKEN_AMOUNTS, txIdsWithZero, BATCH_ID_STUB1)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_TRANSACTION_ID_IS_ZERO);
    });

    it("Is reverted if the account array is empty", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      const emptyAccountArray: string[] = [];
      await expect(
        pixCashier.connect(cashier).cashInBatch(emptyAccountArray, TOKEN_AMOUNTS, TRANSACTIONS_ARRAY, BATCH_ID_STUB1)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INVALID_BATCH_ARRAYS);
    });

    it("Is reverted if the length of any passed arrays is different to others", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      const moreAccounts = [user.address, ...userAddresses];
      const moreAmounts = [TOKEN_AMOUNT, ...TOKEN_AMOUNTS];
      const moreTransactions = [TRANSACTION_ID1, ...TRANSACTIONS_ARRAY];

      await expect(
        pixCashier.connect(cashier).cashInBatch(moreAccounts, TOKEN_AMOUNTS, TRANSACTIONS_ARRAY, BATCH_ID_STUB1)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INVALID_BATCH_ARRAYS);

      await expect(
        pixCashier.connect(cashier).cashInBatch(userAddresses, moreAmounts, TRANSACTIONS_ARRAY, BATCH_ID_STUB1)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INVALID_BATCH_ARRAYS);

      await expect(
        pixCashier.connect(cashier).cashInBatch(userAddresses, TOKEN_AMOUNTS, moreTransactions, BATCH_ID_STUB1)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INVALID_BATCH_ARRAYS);
    });

    it("Is reverted if minting function returns 'false'", async () => {
      const { pixCashier, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      await proveTx(tokenMock.setMintResult(false));
      await expect(
        pixCashier.connect(cashier).cashInBatch(userAddresses, TOKEN_AMOUNTS, TRANSACTIONS_ARRAY, BATCH_ID_STUB1)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_TOKEN_MINTING_FAILURE);
    });

    it("Is reverted if the provided batch ID is zero", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        pixCashier.connect(cashier).cashInBatch(userAddresses, TOKEN_AMOUNTS, TRANSACTIONS_ARRAY, BATCH_ID_ZERO)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_BATCH_ID_IS_ZERO);
    });

    it("Is reverted if a cash-in batch with the provided ID is already executed", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await proveTx(
        pixCashier.connect(cashier).cashInBatch(userAddresses, TOKEN_AMOUNTS, TRANSACTIONS_ARRAY, BATCH_ID_STUB1)
      );
      await proveTx(pixCashier.connect(cashier).cashInPremintBatch(
        userAddresses,
        TOKEN_AMOUNTS,
        TRANSACTIONS_ARRAY,
        RELEASE_TIMESTAMP,
        BATCH_ID_STUB2
      ));
      await expect(
        pixCashier.connect(cashier).cashInBatch(
          userAddresses,
          TOKEN_AMOUNTS,
          TRANSACTIONS_ARRAY,
          BATCH_ID_STUB1
        )
      ).to.be.revertedWithCustomError(
        pixCashier,
        REVERT_ERROR_IF_CASH_IN_BATCH_ALREADY_EXECUTED
      ).withArgs(BATCH_ID_STUB1);
      await expect(
        pixCashier.connect(cashier).cashInBatch(
          userAddresses,
          TOKEN_AMOUNTS,
          TRANSACTIONS_ARRAY,
          BATCH_ID_STUB2
        )
      ).to.be.revertedWithCustomError(
        pixCashier,
        REVERT_ERROR_IF_CASH_IN_BATCH_ALREADY_EXECUTED
      ).withArgs(BATCH_ID_STUB2);
    });
  });

  describe("Function 'cashInPremintBatch()'", async () => {
    it("Executes as expected even if one of the cash-in operations is already executed", async () => {
      const { pixCashier, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      const cashIns = defineTestCashIns(3, RELEASE_TIMESTAMP);

      await proveTx(pixCashier.connect(cashier).cashIn(
        cashIns[1].account.address,
        cashIns[1].amount,
        cashIns[1].txId
      ));
      cashIns[1].status = CashInStatus.Executed;

      const expectedExecutionResults: CashInExecutionStatus[] = [
        CashInExecutionStatus.Success,
        CashInExecutionStatus.AlreadyExecuted,
        CashInExecutionStatus.Success
      ];

      const tx: TransactionResponse = await pixCashier.connect(cashier).cashInPremintBatch(
        cashIns.map(cashIn => cashIn.account.address),
        cashIns.map(cashIn => cashIn.amount),
        cashIns.map(cashIn => cashIn.txId),
        RELEASE_TIMESTAMP,
        BATCH_ID_STUB1
      );
      cashIns[0].status = CashInStatus.PremintExecuted;
      cashIns[2].status = CashInStatus.PremintExecuted;

      await expect(tx).to.emit(tokenMock, EVENT_NAME_MOCK_PREMINT_INCREASING).withArgs(
        cashIns[0].account.address,
        cashIns[0].amount,
        cashIns[0].releaseTimestamp ?? 0
      );
      await expect(tx).to.emit(tokenMock, EVENT_NAME_MOCK_PREMINT_INCREASING).withArgs(
        cashIns[2].account.address,
        cashIns[2].amount,
        cashIns[2].releaseTimestamp ?? 0
      );

      await expect(tx).to.emit(pixCashier, EVENT_NAME_CASH_IN_BATCH).withArgs(
        BATCH_ID_STUB1,
        TRANSACTIONS_ARRAY,
        expectedExecutionResults
      );
      await expect(tx).to.emit(pixCashier, EVENT_NAME_CASH_IN_PREMINT).withArgs(
        cashIns[0].account.address,
        cashIns[0].amount, // newAmount
        TOKEN_AMOUNT_ZERO, // oldAmount
        cashIns[0].txId,
        RELEASE_TIMESTAMP
      );
      await expect(tx).to.emit(pixCashier, EVENT_NAME_CASH_IN_PREMINT).withArgs(
        cashIns[2].account.address,
        cashIns[2].amount, // newAmount
        TOKEN_AMOUNT_ZERO, // oldAmount
        cashIns[2].txId,
        RELEASE_TIMESTAMP
      );

      const cashInBatches: TestCashInBatch[] = [
        { batchId: BATCH_ID_STUB1, status: CashInBatchStatus.PremintExecuted },
        { batchId: BATCH_ID_STUB2, status: CashInBatchStatus.Nonexistent }
      ];

      await checkCashInStructuresOnBlockchain(pixCashier, cashIns);
      await checkCashInBatchStructuresOnBlockchain(pixCashier, cashInBatches);
    });

    it("Is reverted if the contract is paused", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await pauseContract(pixCashier);
      await expect(
        pixCashier.connect(cashier).cashInPremintBatch(
          userAddresses,
          TOKEN_AMOUNTS,
          TRANSACTIONS_ARRAY,
          RELEASE_TIMESTAMP,
          BATCH_ID_STUB1
        )
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the cashier role", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        pixCashier.connect(deployer).cashInPremintBatch(
          userAddresses,
          TOKEN_AMOUNTS,
          TRANSACTIONS_ARRAY,
          RELEASE_TIMESTAMP,
          BATCH_ID_STUB1
        )
      ).to.be.revertedWith(createRevertMessageDueToMissingRole(deployer.address, cashierRole));
    });

    it("Is reverted if one of the account addresses is zero", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      const accountsWithZero = [userAddresses[0], ADDRESS_ZERO, userAddresses[2]];
      await expect(
        pixCashier.connect(cashier).cashInPremintBatch(
          accountsWithZero,
          TOKEN_AMOUNTS,
          TRANSACTIONS_ARRAY,
          RELEASE_TIMESTAMP,
          BATCH_ID_STUB1
        )
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_ACCOUNT_IS_ZERO);
    });

    it("Is reverted if one of the accounts is blocklisted", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await proveTx(pixCashier.connect(users[1]).selfBlocklist());
      await expect(
        pixCashier.connect(cashier).cashInPremintBatch(
          userAddresses,
          TOKEN_AMOUNTS,
          TRANSACTIONS_ARRAY,
          RELEASE_TIMESTAMP,
          BATCH_ID_STUB1
        )
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_ACCOUNT_IS_BLOCKLISTED);
    });

    it("Is reverted if one of the token amounts is zero", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      const amountsWithZero = [TOKEN_AMOUNTS[0], TOKEN_AMOUNTS[1], TOKEN_AMOUNT_ZERO];
      await expect(
        pixCashier.connect(cashier).cashInPremintBatch(
          userAddresses,
          amountsWithZero,
          TRANSACTIONS_ARRAY,
          RELEASE_TIMESTAMP,
          BATCH_ID_STUB1
        )
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_AMOUNT_IS_ZERO);
    });

    it("Is reverted if one of the off-chain transaction IDs is zero", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      const transactionIdsWithZero = [TRANSACTION_ID1, TRANSACTION_ID_ZERO, TRANSACTION_ID3];
      await expect(
        pixCashier.connect(cashier).cashInPremintBatch(
          userAddresses,
          TOKEN_AMOUNTS,
          transactionIdsWithZero,
          RELEASE_TIMESTAMP,
          BATCH_ID_STUB1
        )
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_TRANSACTION_ID_IS_ZERO);
    });

    it("Is reverted if the account array is empty", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      const emptyAccountArray: string[] = [];

      await expect(
        pixCashier.connect(cashier).cashInPremintBatch(
          emptyAccountArray,
          TOKEN_AMOUNTS,
          TRANSACTIONS_ARRAY,
          RELEASE_TIMESTAMP,
          BATCH_ID_STUB1
        )
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INVALID_BATCH_ARRAYS);
    });

    it("Is reverted if the length of any passed arrays is different to others", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      const moreAccounts = [user.address, ...userAddresses];
      const moreAmounts = [TOKEN_AMOUNT, ...TOKEN_AMOUNTS];
      const moreTransactions = [TRANSACTION_ID1, ...TRANSACTIONS_ARRAY];

      await expect(
        pixCashier.connect(cashier).cashInPremintBatch(
          moreAccounts,
          TOKEN_AMOUNTS,
          TRANSACTIONS_ARRAY,
          RELEASE_TIMESTAMP,
          BATCH_ID_STUB1
        )
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INVALID_BATCH_ARRAYS);

      await expect(
        pixCashier.connect(cashier).cashInPremintBatch(
          userAddresses,
          moreAmounts,
          TRANSACTIONS_ARRAY,
          RELEASE_TIMESTAMP,
          BATCH_ID_STUB1
        )
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INVALID_BATCH_ARRAYS);

      await expect(
        pixCashier.connect(cashier).cashInPremintBatch(
          userAddresses,
          TOKEN_AMOUNTS,
          moreTransactions,
          RELEASE_TIMESTAMP,
          BATCH_ID_STUB1
        )
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INVALID_BATCH_ARRAYS);
    });

    it("Is reverted if the provided release time is zero", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        pixCashier.connect(cashier).cashInPremintBatch(
          userAddresses,
          TOKEN_AMOUNTS,
          TRANSACTIONS_ARRAY,
          RELEASE_TIMESTAMP_ZERO,
          BATCH_ID_ZERO
        )
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INAPPROPRIATE_PREMINT_RELEASE_TIME);
    });

    it("Is reverted if the provided batch ID is zero", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        pixCashier.connect(cashier).cashInPremintBatch(
          userAddresses,
          TOKEN_AMOUNTS,
          TRANSACTIONS_ARRAY,
          RELEASE_TIMESTAMP,
          BATCH_ID_ZERO
        )
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_BATCH_ID_IS_ZERO);
    });

    it("Is reverted if a cash-in batch with the provided ID is already executed", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await proveTx(
        pixCashier.connect(cashier).cashInBatch(userAddresses, TOKEN_AMOUNTS, TRANSACTIONS_ARRAY, BATCH_ID_STUB1)
      );
      await proveTx(pixCashier.connect(cashier).cashInPremintBatch(
        userAddresses,
        TOKEN_AMOUNTS,
        TRANSACTIONS_ARRAY,
        RELEASE_TIMESTAMP,
        BATCH_ID_STUB2
      ));
      await expect(
        pixCashier.connect(cashier).cashInPremintBatch(
          userAddresses,
          TOKEN_AMOUNTS,
          TRANSACTIONS_ARRAY,
          RELEASE_TIMESTAMP,
          BATCH_ID_STUB1
        )
      ).to.be.revertedWithCustomError(
        pixCashier,
        REVERT_ERROR_IF_CASH_IN_BATCH_ALREADY_EXECUTED
      ).withArgs(BATCH_ID_STUB1);
      await expect(
        pixCashier.connect(cashier).cashInPremintBatch(
          userAddresses,
          TOKEN_AMOUNTS,
          TRANSACTIONS_ARRAY,
          RELEASE_TIMESTAMP,
          BATCH_ID_STUB2
        )
      ).to.be.revertedWithCustomError(
        pixCashier,
        REVERT_ERROR_IF_CASH_IN_BATCH_ALREADY_EXECUTED
      ).withArgs(BATCH_ID_STUB2);
    });
  });

  describe("Function 'cashInPremintRevokeBatch()'", async () => {
    it("Executes as expected even if one of the cash-in operations has wrong status", async () => {
      const { pixCashier, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      const cashIns = defineTestCashIns(3, RELEASE_TIMESTAMP);
      const accountAddresses = cashIns.map(cashIn => cashIn.account.address);
      const amounts = cashIns.map(cashIn => cashIn.amount);
      const txIds = cashIns.map(cashIn => cashIn.txId);

      await proveTx(pixCashier.connect(cashier).cashInPremintBatch(
        accountAddresses,
        amounts,
        txIds,
        RELEASE_TIMESTAMP,
        BATCH_ID_STUB2
      ));
      cashIns.forEach(cashIn => cashIn.status = CashInStatus.PremintExecuted);

      await proveTx(pixCashier.connect(cashier).cashInPremintRevoke(
        cashIns[1].txId,
        cashIns[1].releaseTimestamp ?? 0
      ));
      cashIns[1].status = CashInStatus.Nonexistent;

      const expectedExecutionResults: CashInExecutionStatus[] = [
        CashInExecutionStatus.Success,
        CashInExecutionStatus.InappropriateStatus,
        CashInExecutionStatus.Success
      ];

      const tx = pixCashier.connect(cashier).cashInPremintRevokeBatch(
        txIds,
        RELEASE_TIMESTAMP,
        BATCH_ID_STUB1
      );
      cashIns.forEach(cashIn => cashIn.status = CashInStatus.Nonexistent);

      await expect(tx).to.emit(tokenMock, EVENT_NAME_MOCK_PREMINT_DECREASING).withArgs(
        cashIns[0].account.address,
        cashIns[0].amount,
        cashIns[0].releaseTimestamp ?? 0
      );
      await expect(tx).to.emit(tokenMock, EVENT_NAME_MOCK_PREMINT_DECREASING).withArgs(
        cashIns[2].account.address,
        cashIns[2].amount,
        cashIns[2].releaseTimestamp ?? 0
      );

      await expect(tx).to.emit(pixCashier, EVENT_NAME_CASH_IN_BATCH).withArgs(
        BATCH_ID_STUB1,
        TRANSACTIONS_ARRAY,
        expectedExecutionResults
      );
      await expect(tx).to.emit(pixCashier, EVENT_NAME_CASH_IN_PREMINT).withArgs(
        cashIns[0].account.address,
        TOKEN_AMOUNT_ZERO, // newAmount
        cashIns[0].amount, // oldAmount
        cashIns[0].txId,
        RELEASE_TIMESTAMP
      );
      await expect(tx).to.emit(pixCashier, EVENT_NAME_CASH_IN_PREMINT).withArgs(
        cashIns[2].account.address,
        TOKEN_AMOUNT_ZERO, // newAmount
        cashIns[2].amount, // oldAmount
        cashIns[2].txId,
        RELEASE_TIMESTAMP
      );

      const cashInBatches: TestCashInBatch[] = [
        { batchId: BATCH_ID_STUB2, status: CashInBatchStatus.PremintExecuted },
        { batchId: BATCH_ID_STUB1, status: CashInBatchStatus.PremintExecuted }
      ];

      await checkCashInStructuresOnBlockchain(pixCashier, cashIns);
      await checkCashInBatchStructuresOnBlockchain(pixCashier, cashInBatches);
    });

    it("Is reverted if the contract is paused", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await pauseContract(pixCashier);
      await expect(
        pixCashier.connect(cashier).cashInPremintRevokeBatch(
          TRANSACTIONS_ARRAY,
          RELEASE_TIMESTAMP,
          BATCH_ID_STUB1
        )
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the cashier role", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        pixCashier.connect(deployer).cashInPremintRevokeBatch(
          TRANSACTIONS_ARRAY,
          RELEASE_TIMESTAMP,
          BATCH_ID_STUB1
        )
      ).to.be.revertedWith(createRevertMessageDueToMissingRole(deployer.address, cashierRole));
    });

    it("Is reverted if one of the accounts is blocklisted", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await proveTx(pixCashier.connect(cashier).cashInPremintBatch(
        userAddresses,
        TOKEN_AMOUNTS,
        TRANSACTIONS_ARRAY,
        RELEASE_TIMESTAMP,
        BATCH_ID_STUB2
      ));
      await proveTx(pixCashier.connect(users[1]).selfBlocklist());
      await expect(
        pixCashier.connect(cashier).cashInPremintRevokeBatch(
          TRANSACTIONS_ARRAY,
          RELEASE_TIMESTAMP,
          BATCH_ID_STUB1
        )
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_ACCOUNT_IS_BLOCKLISTED);
    });

    it("Is reverted if one of the off-chain transaction IDs is zero", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      const transactionIdsWithZero = [TRANSACTION_ID1, TRANSACTION_ID_ZERO, TRANSACTION_ID3];
      await expect(
        pixCashier.connect(cashier).cashInPremintRevokeBatch(
          transactionIdsWithZero,
          RELEASE_TIMESTAMP,
          BATCH_ID_STUB1
        )
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_TRANSACTION_ID_IS_ZERO);
    });

    it("Is reverted if the txId array is empty", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      const emptyTxIdArray: string[] = [];

      await expect(
        pixCashier.connect(cashier).cashInPremintRevokeBatch(
          emptyTxIdArray,
          RELEASE_TIMESTAMP,
          BATCH_ID_STUB1
        )
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INVALID_BATCH_ARRAYS);
    });

    it("Is reverted if the provided release time is zero", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        pixCashier.connect(cashier).cashInPremintRevokeBatch(
          TRANSACTIONS_ARRAY,
          RELEASE_TIMESTAMP_ZERO,
          BATCH_ID_ZERO
        )
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INAPPROPRIATE_PREMINT_RELEASE_TIME);
    });

    it("Is reverted if the provided batch ID is zero", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        pixCashier.connect(cashier).cashInPremintRevokeBatch(
          TRANSACTIONS_ARRAY,
          RELEASE_TIMESTAMP,
          BATCH_ID_ZERO
        )
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_BATCH_ID_IS_ZERO);
    });

    it("Is reverted if a cash-in batch with the provided ID is already executed", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await proveTx(pixCashier.connect(cashier).cashInBatch(
        userAddresses,
        TOKEN_AMOUNTS,
        TRANSACTIONS_ARRAY,
        BATCH_ID_STUB1
      ));
      await proveTx(pixCashier.connect(cashier).cashInPremintBatch(
        userAddresses,
        TOKEN_AMOUNTS,
        TRANSACTIONS_ARRAY,
        RELEASE_TIMESTAMP,
        BATCH_ID_STUB2
      ));
      await expect(
        pixCashier.connect(cashier).cashInPremintRevokeBatch(
          TRANSACTIONS_ARRAY,
          RELEASE_TIMESTAMP,
          BATCH_ID_STUB1
        )
      ).to.be.revertedWithCustomError(
        pixCashier,
        REVERT_ERROR_IF_CASH_IN_BATCH_ALREADY_EXECUTED
      ).withArgs(BATCH_ID_STUB1);
      await expect(
        pixCashier.connect(cashier).cashInPremintRevokeBatch(
          TRANSACTIONS_ARRAY,
          RELEASE_TIMESTAMP,
          BATCH_ID_STUB2
        )
      ).to.be.revertedWithCustomError(
        pixCashier,
        REVERT_ERROR_IF_CASH_IN_BATCH_ALREADY_EXECUTED
      ).withArgs(BATCH_ID_STUB2);
    });
  });

  describe("Function 'reschedulePremintRelease()'", async () => {
    const originalReleaseTimestamp = 123;
    const targetReleaseTimestamp = 321;

    it("Executes as expected", async () => {
      const { pixCashier, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      const tx: TransactionResponse = await pixCashier.connect(cashier).reschedulePremintRelease(
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
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await pauseContract(pixCashier);
      await expect(
        pixCashier.connect(cashier).reschedulePremintRelease(
          originalReleaseTimestamp,
          targetReleaseTimestamp
        )
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the cashier role", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        pixCashier.connect(deployer).reschedulePremintRelease(
          originalReleaseTimestamp,
          targetReleaseTimestamp
        )
      ).to.be.revertedWith(createRevertMessageDueToMissingRole(deployer.address, cashierRole));
    });
  });

  describe("Function 'requestCashOutFrom()'", async () => {
    it("Executes as expected", async () => {
      const fixture: Fixture = await setUpFixture(deployAndConfigureContracts);
      const { pixCashier, tokenMock } = fixture;

      const [cashOut] = defineTestCashOuts();

      await checkPixCashierState(fixture, [cashOut]);
      const tx = pixCashier.connect(cashier).requestCashOutFrom(
        cashOut.account.address,
        cashOut.amount,
        cashOut.txId
      );
      await expect(tx).to.changeTokenBalances(
        tokenMock,
        [pixCashier, cashier, cashOut.account],
        [+cashOut.amount, 0, -cashOut.amount]
      );
      await expect(tx).to.emit(pixCashier, EVENT_NAME_CASH_OUT_REQUESTING).withArgs(
        cashOut.account.address,
        cashOut.amount, // amount
        cashOut.amount, // balance
        cashOut.txId,
        cashier.address
      );
      cashOut.status = CashOutStatus.Pending;
      await checkPixCashierState(fixture, [cashOut]);
    });

    it("Is reverted if the contract is paused", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await pauseContract(pixCashier);
      await expect(
        pixCashier.connect(cashier).requestCashOutFrom(user.address, TOKEN_AMOUNT, TRANSACTION_ID1)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the cashier role", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        pixCashier.connect(deployer).requestCashOutFrom(user.address, TOKEN_AMOUNT, TRANSACTION_ID1)
      ).to.be.revertedWith(createRevertMessageDueToMissingRole(deployer.address, cashierRole));
    });

    it("Is reverted if the account is blocklisted", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await proveTx(pixCashier.connect(user).selfBlocklist());
      await expect(
        pixCashier.connect(cashier).requestCashOutFrom(user.address, TOKEN_AMOUNT, TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_ACCOUNT_IS_BLOCKLISTED);
    });

    it("Is reverted if the account address is zero", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        pixCashier.connect(cashier).requestCashOutFrom(ADDRESS_ZERO, TOKEN_AMOUNT, TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_ACCOUNT_IS_ZERO);
    });

    it("Is reverted if the token amount is zero", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        pixCashier.connect(cashier).requestCashOutFrom(user.address, TOKEN_AMOUNT_ZERO, TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_AMOUNT_IS_ZERO);
    });

    it("Is reverted if the off-chain transaction ID is zero", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        pixCashier.connect(cashier).requestCashOutFrom(user.address, TOKEN_AMOUNT, TRANSACTION_ID_ZERO)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_TRANSACTION_ID_IS_ZERO);
    });

    it("Is reverted if the cash-out with the provided txId is already pending", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await pixCashier.connect(cashier).requestCashOutFrom(user.address, TOKEN_AMOUNT, TRANSACTION_ID1);
      await expect(pixCashier.connect(cashier).requestCashOutFrom(user.address, TOKEN_AMOUNT, TRANSACTION_ID1))
        .to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_STATUS)
        .withArgs(TRANSACTION_ID1, CashOutStatus.Pending);
    });

    it("Is reverted if the cash-out with the provided txId is already confirmed", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await pixCashier.connect(cashier).requestCashOutFrom(user.address, TOKEN_AMOUNT, TRANSACTION_ID1);
      await pixCashier.connect(cashier).confirmCashOut(TRANSACTION_ID1);
      await expect(pixCashier.connect(cashier).requestCashOutFrom(user.address, TOKEN_AMOUNT, TRANSACTION_ID1))
        .to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_STATUS)
        .withArgs(TRANSACTION_ID1, CashOutStatus.Confirmed);
    });

    it("Is reverted if txId of a reversed cash-out operation is reused for another account", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await pixCashier.connect(cashier).requestCashOutFrom(user.address, TOKEN_AMOUNT, TRANSACTION_ID1);
      await pixCashier.connect(cashier).reverseCashOut(TRANSACTION_ID1);
      await expect(pixCashier.connect(cashier).requestCashOutFrom(deployer.address, TOKEN_AMOUNT, TRANSACTION_ID1))
        .to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_ACCOUNT)
        .withArgs(TRANSACTION_ID1, user.address);
    });

    it("Is reverted if the user has not enough tokens", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      const tokenAmount = INITIAL_USER_BALANCE + 1;
      await expect(
        pixCashier.connect(cashier).requestCashOutFrom(user.address, tokenAmount, TRANSACTION_ID1)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_TOKEN_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
    });
  });

  describe("Function 'requestCashOutFromBatch()'", async () => {
    it("Executes as expected", async () => {
      const fixture: Fixture = await setUpFixture(deployAndConfigureContracts);
      const { pixCashier, tokenMock } = fixture;
      const cashOuts = defineTestCashOuts(3);
      const accountAddresses: string[] = cashOuts.map(cashOut => cashOut.account.address);
      const amounts = cashOuts.map(cashOut => cashOut.amount);

      const amountSum = cashOuts
        .map(cashOut => cashOut.amount)
        .reduce((sum: number, amount: number) => sum + amount);
      await checkPixCashierState(fixture, cashOuts);
      const tx = pixCashier.connect(cashier).requestCashOutFromBatch(accountAddresses, amounts, TRANSACTIONS_ARRAY);
      await expect(tx).to.changeTokenBalances(
        tokenMock,
        [pixCashier, cashier, ...accountAddresses],
        [+amountSum, 0, ...amounts.map(amount => -amount)]
      );
      await expect(tx).to.emit(pixCashier, EVENT_NAME_CASH_OUT_REQUESTING).withArgs(
        cashOuts[0].account.address,
        cashOuts[0].amount,
        cashOuts[0].amount,
        cashOuts[0].txId,
        cashier.address
      );
      await expect(tx).to.emit(pixCashier, EVENT_NAME_CASH_OUT_REQUESTING).withArgs(
        cashOuts[1].account.address,
        cashOuts[1].amount,
        cashOuts[1].amount,
        cashOuts[1].txId,
        cashier.address
      );
      await expect(tx).to.emit(pixCashier, EVENT_NAME_CASH_OUT_REQUESTING).withArgs(
        cashOuts[2].account.address,
        cashOuts[2].amount,
        cashOuts[2].amount,
        cashOuts[2].txId,
        cashier.address
      );
      cashOuts.forEach(cashOut => cashOut.status = CashOutStatus.Pending);
      await checkPixCashierState(fixture, cashOuts);
    });

    it("Is reverted if the contract is paused", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await pauseContract(pixCashier);
      await expect(
        pixCashier.connect(cashier).requestCashOutFromBatch(userAddresses, TOKEN_AMOUNTS, TRANSACTIONS_ARRAY)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the cashier role", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        pixCashier.connect(deployer).requestCashOutFromBatch(userAddresses, TOKEN_AMOUNTS, TRANSACTIONS_ARRAY)
      ).to.be.revertedWith(createRevertMessageDueToMissingRole(deployer.address, cashierRole));
    });

    it("Is reverted if the length of any passed arrays is different to others", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      const moreAccounts = [user.address, ...userAddresses];
      const moreAmounts = [TOKEN_AMOUNT, ...TOKEN_AMOUNTS];
      const moreTransactions = [TRANSACTION_ID1, ...TRANSACTIONS_ARRAY];

      await expect(
        pixCashier.connect(cashier).requestCashOutFromBatch(moreAccounts, TOKEN_AMOUNTS, TRANSACTIONS_ARRAY)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INVALID_BATCH_ARRAYS);

      await expect(
        pixCashier.connect(cashier).requestCashOutFromBatch(userAddresses, moreAmounts, TRANSACTIONS_ARRAY)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INVALID_BATCH_ARRAYS);

      await expect(
        pixCashier.connect(cashier).requestCashOutFromBatch(userAddresses, TOKEN_AMOUNTS, moreTransactions)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INVALID_BATCH_ARRAYS);
    });

    it("Is reverted if the account is blocklisted", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await proveTx(pixCashier.connect(users[1]).selfBlocklist());
      await expect(
        pixCashier.connect(cashier).requestCashOutFromBatch(userAddresses, TOKEN_AMOUNTS, TRANSACTIONS_ARRAY)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_ACCOUNT_IS_BLOCKLISTED);
    });

    it("Is reverted if the account address is zero", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      const accountsWithZero = [userAddresses[0], ADDRESS_ZERO, userAddresses[2]];
      await expect(
        pixCashier.connect(cashier).requestCashOutFromBatch(accountsWithZero, TOKEN_AMOUNTS, TRANSACTIONS_ARRAY)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_ACCOUNT_IS_ZERO);
    });

    it("Is reverted if the token amount is zero", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      const amountsWithZero = [TOKEN_AMOUNTS[0], TOKEN_AMOUNTS[1], TOKEN_AMOUNT_ZERO];
      await expect(
        pixCashier.connect(cashier).requestCashOutFromBatch(userAddresses, amountsWithZero, TRANSACTIONS_ARRAY)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_AMOUNT_IS_ZERO);
    });

    it("Is reverted if the off-chain transaction ID is zero", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      const txIdsWithZero = [TRANSACTION_ID1, TRANSACTION_ID_ZERO, TRANSACTION_ID3];
      await expect(
        pixCashier.connect(cashier).requestCashOutFromBatch(userAddresses, TOKEN_AMOUNTS, txIdsWithZero)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_TRANSACTION_ID_IS_ZERO);
    });

    it("Is reverted if the cash-out with the provided txId is already pending", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await proveTx(pixCashier.connect(cashier).requestCashOutFrom(userAddresses[1], TOKEN_AMOUNT, TRANSACTION_ID2));
      await expect(
        pixCashier.connect(cashier).requestCashOutFromBatch(userAddresses, TOKEN_AMOUNTS, TRANSACTIONS_ARRAY)
      )
        .to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_STATUS)
        .withArgs(TRANSACTION_ID2, CashOutStatus.Pending);
    });

    it("Is reverted if the user has not enough tokens", async () => {
      const fixture: Fixture = await setUpFixture(deployAndConfigureContracts);
      const { pixCashier } = fixture;
      const cashOuts = defineTestCashOuts(3);
      const amounts: number[] = cashOuts.map(cashOut => cashOut.amount);
      amounts[2] = INITIAL_USER_BALANCE + 1;
      await expect(
        pixCashier.connect(cashier).requestCashOutFromBatch(userAddresses, amounts, TRANSACTIONS_ARRAY)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_TOKEN_TRANSFER_AMOUNT_EXCEEDS_BALANCE);
    });
  });

  describe("Function 'confirmCashOut()'", async () => {
    it("Executes as expected", async () => {
      const fixture = await setUpFixture(deployAndConfigureContracts);
      const { pixCashier, tokenMock } = fixture;
      const [cashOut] = defineTestCashOuts();
      await requestCashOuts(pixCashier, [cashOut]);
      await checkPixCashierState(fixture, [cashOut]);
      const tx = pixCashier.connect(cashier).confirmCashOut(cashOut.txId);

      await expect(tx).to.changeTokenBalances(
        tokenMock,
        [pixCashier, cashOut.account],
        [-cashOut.amount, 0]
      );
      await expect(tx).to.emit(pixCashier, EVENT_NAME_CASH_OUT_CONFIRMATION).withArgs(
        cashOut.account.address,
        cashOut.amount,
        BALANCE_ZERO,
        cashOut.txId
      );
      cashOut.status = CashOutStatus.Confirmed;
      await checkPixCashierState(fixture, [cashOut]);
    });

    it("Is reverted if the contract is paused", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await pauseContract(pixCashier);
      await expect(
        pixCashier.connect(cashier).confirmCashOut(TRANSACTION_ID1)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the cashier role", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        pixCashier.connect(deployer).confirmCashOut(TRANSACTION_ID1)
      ).to.be.revertedWith(createRevertMessageDueToMissingRole(deployer.address, cashierRole));
    });

    it("Is reverted if the off-chain transaction ID is zero", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        pixCashier.connect(cashier).confirmCashOut(TRANSACTION_ID_ZERO)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_TRANSACTION_ID_IS_ZERO);
    });

    it("Is reverted if the cash-out with the provided txId was not requested previously", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await expect(pixCashier.connect(cashier).confirmCashOut(TRANSACTION_ID1))
        .to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_STATUS)
        .withArgs(TRANSACTION_ID1, CashOutStatus.Nonexistent);
    });
  });

  describe("Function 'confirmCashOutBatch()'", async () => {
    it("Executes as expected", async () => {
      const fixture: Fixture = await setUpFixture(deployAndConfigureContracts);
      const { pixCashier, tokenMock } = fixture;
      const cashOuts: TestCashOut[] = defineTestCashOuts(2);
      const txIds: string[] = cashOuts.map(cashOut => cashOut.txId);
      await requestCashOuts(pixCashier, cashOuts);
      await checkPixCashierState(fixture, cashOuts);
      const sumAmount = cashOuts
        .map(cashOut => cashOut.amount)
        .reduce((sum, amount) => sum + amount);

      const tx = pixCashier.connect(cashier).confirmCashOutBatch(txIds);
      await expect(tx).to.changeTokenBalances(
        tokenMock,
        [pixCashier, ...cashOuts.map(cashOut => cashOut.account)],
        [-sumAmount, ...cashOuts.map(() => 0)]
      );
      await expect(tx).to.emit(pixCashier, EVENT_NAME_CASH_OUT_CONFIRMATION).withArgs(
        cashOuts[0].account.address,
        cashOuts[0].amount,
        BALANCE_ZERO,
        cashOuts[0].txId
      );
      await expect(tx).to.emit(pixCashier, EVENT_NAME_CASH_OUT_CONFIRMATION).withArgs(
        cashOuts[1].account.address,
        cashOuts[1].amount,
        BALANCE_ZERO,
        cashOuts[1].txId
      );
      cashOuts.forEach(cashOut => (cashOut.status = CashOutStatus.Confirmed));
      await checkPixCashierState(fixture, cashOuts);
    });

    it("Is reverted if the contract is paused", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await pauseContract(pixCashier);
      await expect(
        pixCashier.connect(cashier).confirmCashOutBatch(TRANSACTIONS_ARRAY)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the cashier role", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        pixCashier.connect(deployer).confirmCashOutBatch(TRANSACTIONS_ARRAY)
      ).to.be.revertedWith(createRevertMessageDueToMissingRole(deployer.address, cashierRole));
    });

    it("Is reverted if the off-chain transaction IDs array is empty", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        pixCashier.connect(cashier).confirmCashOutBatch([])
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_EMPTY_TRANSACTION_IDS_ARRAY);
    });

    it("Is reverted if one of the off-chain transaction IDs is zero", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      const cashOuts: TestCashOut[] = defineTestCashOuts(2);
      const txIds: string[] = cashOuts.map(cashOut => cashOut.txId);
      await requestCashOuts(pixCashier, cashOuts);
      txIds[txIds.length - 1] = TRANSACTION_ID_ZERO;
      await expect(
        pixCashier.connect(cashier).confirmCashOutBatch(txIds)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_TRANSACTION_ID_IS_ZERO);
    });

    it("Is reverted if one of the cash-outs was not requested previously", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      const cashOuts: TestCashOut[] = defineTestCashOuts(2);
      const txIds: string[] = cashOuts.map(cashOut => cashOut.txId);
      await requestCashOuts(pixCashier, cashOuts);
      txIds[txIds.length - 1] = ethers.utils.formatBytes32String("UNUSED_TRANSACTION_ID");
      await expect(pixCashier.connect(cashier).confirmCashOutBatch(txIds))
        .to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_STATUS)
        .withArgs(txIds[txIds.length - 1], CashOutStatus.Nonexistent);
    });
  });

  describe("Function 'reverseCashOut()'", async () => {
    it("Executes as expected", async () => {
      const fixture = await setUpFixture(deployAndConfigureContracts);
      const { pixCashier, tokenMock } = fixture;
      const [cashOut] = defineTestCashOuts();
      await requestCashOuts(pixCashier, [cashOut]);
      await checkPixCashierState(fixture, [cashOut]);
      const tx = pixCashier.connect(cashier).reverseCashOut(cashOut.txId);
      await expect(tx).to.changeTokenBalances(
        tokenMock,
        [cashOut.account, pixCashier, cashier],
        [+cashOut.amount, -cashOut.amount, 0]
      );
      await expect(tx).to.emit(pixCashier, EVENT_NAME_CASH_OUT_REVERSING).withArgs(
        cashOut.account.address,
        cashOut.amount,
        BALANCE_ZERO,
        cashOut.txId
      );
      cashOut.status = CashOutStatus.Reversed;
      await checkPixCashierState(fixture, [cashOut]);
    });

    it("Is reverted if the contract is paused", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await pauseContract(pixCashier);
      await expect(
        pixCashier.connect(cashier).reverseCashOut(TRANSACTION_ID1)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the cashier role", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        pixCashier.connect(deployer).reverseCashOut(TRANSACTION_ID1)
      ).to.be.revertedWith(createRevertMessageDueToMissingRole(deployer.address, cashierRole));
    });

    it("Is reverted if the off-chain transaction ID is zero", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        pixCashier.connect(cashier).reverseCashOut(TRANSACTION_ID_ZERO)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_TRANSACTION_ID_IS_ZERO);
    });

    it("Is reverted if the cash-out with the provided txId was not requested previously", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await expect(pixCashier.connect(cashier).reverseCashOut(TRANSACTION_ID1))
        .to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_STATUS)
        .withArgs(TRANSACTION_ID1, CashOutStatus.Nonexistent);
    });
  });

  describe("Function 'reverseCashOutBatch()'", async () => {
    it("Executes as expected", async () => {
      const fixture = await setUpFixture(deployAndConfigureContracts);
      const { pixCashier, tokenMock } = fixture;
      const cashOuts = defineTestCashOuts(2);
      const txIds = cashOuts.map(cashOut => cashOut.txId);
      await requestCashOuts(pixCashier, cashOuts);
      await checkPixCashierState(fixture, cashOuts);
      const sumAmount = cashOuts
        .map(cashOut => cashOut.amount)
        .reduce((sum: number, amount: number) => sum + amount);
      const tx = pixCashier.connect(cashier).reverseCashOutBatch(txIds);
      await expect(tx).to.changeTokenBalances(
        tokenMock,
        [pixCashier, cashier, ...cashOuts.map(cashOut => cashOut.account)],
        [-sumAmount, 0, ...cashOuts.map(cashOut => cashOut.amount)]
      );
      await expect(tx).to.emit(pixCashier, EVENT_NAME_CASH_OUT_REVERSING).withArgs(
        cashOuts[0].account.address,
        cashOuts[0].amount,
        BALANCE_ZERO,
        cashOuts[0].txId
      );
      await expect(tx).to.emit(pixCashier, EVENT_NAME_CASH_OUT_REVERSING).withArgs(
        cashOuts[1].account.address,
        cashOuts[1].amount,
        BALANCE_ZERO,
        cashOuts[1].txId
      );
      cashOuts.forEach(cashOut => (cashOut.status = CashOutStatus.Reversed));
      await checkPixCashierState(fixture, cashOuts);
    });

    it("Is reverted if the contract is paused", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await pauseContract(pixCashier);
      await expect(
        pixCashier.connect(cashier).reverseCashOutBatch(TRANSACTIONS_ARRAY)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the cashier role", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        pixCashier.connect(deployer).reverseCashOutBatch(TRANSACTIONS_ARRAY)
      ).to.be.revertedWith(createRevertMessageDueToMissingRole(deployer.address, cashierRole));
    });

    it("Is reverted if the off-chain transaction IDs array is empty", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        pixCashier.connect(cashier).reverseCashOutBatch([])
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_EMPTY_TRANSACTION_IDS_ARRAY);
    });

    it("Is reverted if one of the off-chain transaction IDs is zero", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      const cashOuts = defineTestCashOuts(2);
      const txIds = cashOuts.map(cashOut => cashOut.txId);
      await requestCashOuts(pixCashier, cashOuts);
      txIds[txIds.length - 1] = TRANSACTION_ID_ZERO;
      await expect(
        pixCashier.connect(cashier).reverseCashOutBatch(txIds)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_TRANSACTION_ID_IS_ZERO);
    });

    it("Is reverted if one of the cash-outs was not requested previously", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      const cashOuts = defineTestCashOuts(2);
      const txIds = cashOuts.map(cashOut => cashOut.txId);
      await requestCashOuts(pixCashier, cashOuts);
      txIds[txIds.length - 1] = ethers.utils.formatBytes32String("UNUSED_TRANSACTION_ID");
      await expect(pixCashier.connect(cashier).reverseCashOutBatch(txIds))
        .to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_STATUS)
        .withArgs(txIds[txIds.length - 1], CashOutStatus.Nonexistent);
    });
  });

  describe("Function 'getPendingCashOutTxIds()'", async () => {
    it("Returns expected values in different cases", async () => {
      const { pixCashier } = await setUpFixture(deployAndConfigureContracts);
      const cashOuts = defineTestCashOuts(3);
      const txIds = cashOuts.map(cashOut => cashOut.txId);
      await requestCashOuts(pixCashier, cashOuts);
      let actualTxIds: string[];

      actualTxIds = await pixCashier.getPendingCashOutTxIds(0, 50);
      expect(actualTxIds).to.be.deep.equal(txIds);

      actualTxIds = await pixCashier.getPendingCashOutTxIds(0, 2);
      expect(actualTxIds).to.be.deep.equal([txIds[0], txIds[1]]);

      actualTxIds = await pixCashier.getPendingCashOutTxIds(1, 2);
      expect(actualTxIds).to.be.deep.equal([txIds[1], txIds[2]]);

      actualTxIds = await pixCashier.getPendingCashOutTxIds(1, 1);
      expect(actualTxIds).to.be.deep.equal([txIds[1]]);

      actualTxIds = await pixCashier.getPendingCashOutTxIds(1, 50);
      expect(actualTxIds).to.be.deep.equal([txIds[1], txIds[2]]);

      actualTxIds = await pixCashier.getPendingCashOutTxIds(3, 50);
      expect(actualTxIds).to.be.deep.equal([]);

      actualTxIds = await pixCashier.getPendingCashOutTxIds(1, 0);
      expect(actualTxIds).to.be.deep.equal([]);
    });
  });

  describe("Complex scenarios", async () => {
    it("Scenario 1 with cash-out reversing executes successfully", async () => {
      const fixture = await setUpFixture(deployAndConfigureContracts);
      const { pixCashier, tokenMock } = fixture;
      const [cashOut] = defineTestCashOuts();
      await requestCashOuts(pixCashier, [cashOut]);
      await proveTx(pixCashier.connect(cashier).reverseCashOut(cashOut.txId));
      cashOut.status = CashOutStatus.Reversed;
      await checkPixCashierState(fixture, [cashOut]);

      // After reversing a cash-out with the same txId can't be reversed again.
      await expect(pixCashier.connect(cashier).reverseCashOut(cashOut.txId))
        .to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_STATUS)
        .withArgs(cashOut.txId, CashOutStatus.Reversed);
      await expect(pixCashier.connect(cashier).reverseCashOutBatch([cashOut.txId]))
        .to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_STATUS)
        .withArgs(cashOut.txId, CashOutStatus.Reversed);

      // After reversing a cash-out with the same txId can't be confirmed.
      await expect(pixCashier.connect(cashier).confirmCashOut(cashOut.txId))
        .to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_STATUS)
        .withArgs(cashOut.txId, CashOutStatus.Reversed);
      await expect(pixCashier.connect(cashier).confirmCashOutBatch([cashOut.txId]))
        .to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_STATUS)
        .withArgs(cashOut.txId, CashOutStatus.Reversed);

      expect(await tokenMock.balanceOf(cashOut.account.address)).to.equal(INITIAL_USER_BALANCE);

      // After reversing a cash-out with the same txId can be requested again.
      await requestCashOuts(pixCashier, [cashOut]);
      await checkPixCashierState(fixture, [cashOut], 1);
      expect(await tokenMock.balanceOf(cashOut.account.address)).to.equal(INITIAL_USER_BALANCE - cashOut.amount);
    });

    it("Scenario 2 with cash-out confirming executes successfully", async () => {
      const fixture = await setUpFixture(deployAndConfigureContracts);
      const { pixCashier, tokenMock } = fixture;
      const [cashOut] = defineTestCashOuts();
      await requestCashOuts(pixCashier, [cashOut]);
      await proveTx(pixCashier.connect(cashier).confirmCashOut(cashOut.txId));
      cashOut.status = CashOutStatus.Confirmed;
      await checkPixCashierState(fixture, [cashOut]);

      // After confirming a cash-out with the same txId can't be reversed again.
      await expect(pixCashier.connect(cashier).reverseCashOut(cashOut.txId))
        .to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_STATUS)
        .withArgs(cashOut.txId, CashOutStatus.Confirmed);
      await expect(pixCashier.connect(cashier).reverseCashOutBatch([cashOut.txId]))
        .to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_STATUS)
        .withArgs(cashOut.txId, CashOutStatus.Confirmed);

      // After confirming a cash-out with the same txId can't be confirmed.
      await expect(pixCashier.connect(cashier).confirmCashOut(cashOut.txId))
        .to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_STATUS)
        .withArgs(cashOut.txId, CashOutStatus.Confirmed);
      await expect(pixCashier.connect(cashier).confirmCashOutBatch([cashOut.txId]))
        .to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_STATUS)
        .withArgs(cashOut.txId, CashOutStatus.Confirmed);

      expect(await tokenMock.balanceOf(cashOut.account.address)).to.equal(INITIAL_USER_BALANCE - cashOut.amount);
    });
  });
});
