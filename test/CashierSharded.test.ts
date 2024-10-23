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
  Confirmed = 3,
  Internal = 4,
  Forced = 5
}

enum HookIndex {
  UnusedLower = 5,
  CashOutRequestBefore = 6,
  CashOutRequestAfter = 7,
  CashOutConfirmationBefore = 8,
  CashOutConfirmationAfter = 9,
  CashOutReversalBefore = 10,
  CashOutReversalAfter = 11,
  UnusedHigher = 12
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

interface CashierState {
  tokenBalance: number;
  pendingCashOutCounter: number;
  pendingCashOutTxIds: string[];
  cashOutBalancePerAccount: Map<string, number>;
}

interface Fixture {
  cashierRoot: Contract;
  cashierAdmin: Contract;
  cashierShards: Contract[];
  tokenMock: Contract;
  cashierHookMock: Contract;
}

interface HookConfig {
  callableContract: string;
  hookFlags: number;

  [key: string]: number | string; // Indexing signature to ensure that fields are iterated over in a key-value style
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

function checkEquality<T extends Record<string, unknown>>(actualObject: T, expectedObject: T) {
  Object.keys(expectedObject).forEach(property => {
    const value = actualObject[property];
    if (typeof value === "undefined" || typeof value === "function" || typeof value === "object") {
      throw Error(`Property "${property}" is not found`);
    }
    expect(value).to.eq(
      expectedObject[property],
      `Mismatch in the "${property}" property`
    );
  });
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

describe("Contracts 'Cashier' and `CashierShard`", async () => {
  const TRANSACTION_ID1 = ethers.encodeBytes32String("MOCK_TRANSACTION_ID1");
  const TRANSACTION_ID2 = ethers.encodeBytes32String("MOCK_TRANSACTION_ID2");
  const TRANSACTION_ID3 = ethers.encodeBytes32String("MOCK_TRANSACTION_ID3");
  const TRANSACTIONS_ARRAY: string[] = [TRANSACTION_ID1, TRANSACTION_ID2, TRANSACTION_ID3];
  const MAX_SHARD_COUNT = 1100;
  const INITIAL_USER_BALANCE = 1_000_000;
  const TOKEN_AMOUNT = 100;
  const TOKEN_AMOUNTS: number[] = [TOKEN_AMOUNT, 200, 300];
  const TOKEN_AMOUNT_ZERO = 0;
  const BALANCE_ZERO = 0;
  const RELEASE_TIMESTAMP = 123456;
  const RELEASE_TIMESTAMP_ZERO = 0;
  const TRANSACTION_ID_ZERO = ethers.ZeroHash;
  const ALL_CASH_OUT_HOOK_FLAGS: number =
    (1 << HookIndex.CashOutRequestBefore) +
    (1 << HookIndex.CashOutRequestAfter) +
    (1 << HookIndex.CashOutConfirmationBefore) +
    (1 << HookIndex.CashOutConfirmationAfter) +
    (1 << HookIndex.CashOutReversalBefore) +
    (1 << HookIndex.CashOutReversalAfter);

  // Errors of the lib contracts
  const REVERT_ERROR_IF_CONTRACT_INITIALIZATION_IS_INVALID = "InvalidInitialization";
  const REVERT_ERROR_IF_CONTRACT_IS_PAUSED = "EnforcedPause";
  const REVERT_ERROR_IF_ERC20_TOKEN_TRANSFER_AMOUNT_EXCEEDS_BALANCE = "ERC20InsufficientBalance";
  const REVERT_ERROR_IF_OWNABLE_INVALID_OWNER = "OwnableInvalidOwner";
  const REVERT_ERROR_IF_UNAUTHORIZED = "CashierShard_Unauthorized";
  const REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT = "AccessControlUnauthorizedAccount";

  // Errors of the contracts under test
  const REVERT_ERROR_IF_ACCOUNT_ADDRESS_IS_ZERO = "Cashier_AccountAddressZero";
  const REVERT_ERROR_IF_AMOUNT_EXCESS = "Cashier_AmountExcess";
  const REVERT_ERROR_IF_AMOUNT_IS_ZERO = "Cashier_AmountZero";
  const REVERT_ERROR_IF_CASH_IN_ALREADY_EXECUTED = "Cashier_CashInAlreadyExecuted";
  const REVERT_ERROR_IF_CASH_IN_STATUS_INAPPROPRIATE = "Cashier_CashInStatusInappropriate";
  const REVERT_ERROR_IF_CASH_OUT_ACCOUNT_INAPPROPRIATE = "Cashier_CashOutAccountInappropriate";
  const REVERT_ERROR_IF_CASH_OUT_STATUS_INAPPROPRIATE = "Cashier_CashOutStatusInappropriate";
  const REVERT_ERROR_IF_HOOK_CALLABLE_CONTRACT_ADDRESS_ZERO = "Cashier_HookCallableContractAddressZero";
  const REVERT_ERROR_IF_HOOK_CALLABLE_CONTRACT_ADDRESS_NON_ZERO = "Cashier_HookCallableContractAddressNonZero";
  const REVERT_ERROR_IF_HOOK_FLAGS_ALREADY_REGISTERED = "Cashier_HookFlagsAlreadyRegistered";
  const REVERT_ERROR_IF_HOOK_FLAGS_INVALID = "Cashier_HookFlagsInvalid";
  const REVERT_ERROR_IF_PREMINT_RELEASE_TIME_INAPPROPRIATE = "Cashier_PremintReleaseTimeInappropriate";
  const REVERT_ERROR_IF_ROOT_ADDRESS_IS_ZERO = "Cashier_RootAddressZero";
  const REVERT_ERROR_IF_SHARD_ADDRESS_IS_ZERO = "Cashier_ShardAddressZero";
  const REVERT_ERROR_IF_SHARD_COUNT_EXCESS = "Cashier_ShardCountExcess";
  const REVERT_ERROR_IF_SHARD_REPLACEMENT_COUNT_EXCESS = "Cashier_ShardReplacementCountExcess";
  const REVERT_ERROR_IF_TOKEN_ADDRESS_IS_ZERO = "Cashier_TokenAddressZero";
  const REVERT_ERROR_IF_TOKEN_MINTING_FAILURE = "Cashier_TokenMintingFailure";
  const REVERT_ERROR_IF_TRANSACTION_ID_IS_ZERO = "Cashier_TxIdZero";
  const REVERT_ERROR_IF_SHARD_ERROR_UNEXPECTED = "Cashier_ShardErrorUnexpected";

  // Events of the contracts under test
  const EVENT_NAME_CASH_IN = "CashIn";
  const EVENT_NAME_CASH_IN_PREMINT = "CashInPremint";
  const EVENT_NAME_CASH_OUT_CONFIRMATION = "ConfirmCashOut";
  const EVENT_NAME_CASH_OUT_HOOKS_CONFIGURED = "CashOutHooksConfigured";
  const EVENT_NAME_CASH_OUT_REQUESTING = "RequestCashOut";
  const EVENT_NAME_CASH_OUT_REVERSING = "ReverseCashOut";
  const EVENT_NAME_HOOK_INVOKED = "HookInvoked";
  const EVENT_NAME_INTERNAL_CASH_OUT = "InternalCashOut";
  const EVENT_NAME_FORCED_CASH_OUT = "ForcedCashOut";
  const EVENT_NAME_MOCK_CASHIER_HOOK_CALLED = "MockCashierHookCalled";
  const EVENT_NAME_MOCK_PREMINT_INCREASING = "MockPremintIncreasing";
  const EVENT_NAME_MOCK_PREMINT_DECREASING = "MockPremintDecreasing";
  const EVENT_NAME_MOCK_PREMINT_PREMINT_RESCHEDULING = "MockPremintReleaseRescheduling";
  const EVENT_NAME_SHARD_ADDED = "ShardAdded";
  const EVENT_NAME_SHARD_ADMIN_CONFIGURED = "ShardAdminConfigured";
  const EVENT_NAME_SHARD_REPLACED = "ShardReplaced";
  const EVENT_NAME_ROLE_ADMIN_CHANGED = "RoleAdminChanged";

  let cashierFactory: ContractFactory;
  let cashierShardFactory: ContractFactory;
  let tokenMockFactory: ContractFactory;
  let cashierHookMockFactory: ContractFactory;
  let cashierShardMockFactory: ContractFactory;
  let deployer: HardhatEthersSigner;
  let cashier: HardhatEthersSigner;
  let hookAdmin: HardhatEthersSigner;
  let receiver: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let users: HardhatEthersSigner[];

  const ownerRole: string = ethers.id("OWNER_ROLE");
  const pauserRole: string = ethers.id("PAUSER_ROLE");
  const rescuerRole: string = ethers.id("RESCUER_ROLE");
  const cashierRole: string = ethers.id("CASHIER_ROLE");
  const hookAdminRole: string = ethers.id("HOOK_ADMIN_ROLE");

  before(async () => {
    let secondUser: HardhatEthersSigner;
    let thirdUser: HardhatEthersSigner;
    [deployer, cashier, hookAdmin, receiver, user, secondUser, thirdUser] = await ethers.getSigners();
    users = [user, secondUser, thirdUser];

    // Contract factories with the explicitly specified deployer account
    cashierFactory = await ethers.getContractFactory("Cashier");
    cashierFactory = cashierFactory.connect(deployer);
    cashierShardFactory = await ethers.getContractFactory("CashierShard");
    cashierShardFactory = cashierShardFactory.connect(deployer);
    tokenMockFactory = await ethers.getContractFactory("ERC20TokenMock");
    tokenMockFactory = tokenMockFactory.connect(deployer);
    cashierHookMockFactory = await ethers.getContractFactory("CashierHookMock");
    cashierHookMockFactory = cashierHookMockFactory.connect(deployer);
    cashierShardMockFactory = await ethers.getContractFactory("CashierShardMock");
    cashierShardMockFactory = cashierShardMockFactory.connect(deployer);
  });

  async function deployTokenMock(): Promise<Contract> {
    const name = "ERC20 Test";
    const symbol = "TEST";

    let tokenMock: Contract = await tokenMockFactory.deploy(name, symbol) as Contract;
    await tokenMock.waitForDeployment();
    tokenMock = connect(tokenMock, deployer); // Explicitly specifying the initial account

    return tokenMock;
  }

  async function deployCashierHookMock(): Promise<Contract> {
    const cashierHookMock: Contract = await cashierHookMockFactory.deploy() as Contract;
    await cashierHookMock.waitForDeployment();

    return cashierHookMock;
  }

  async function deployContracts(): Promise<Fixture> {
    const tokenMock = await deployTokenMock();
    const cashierHookMock = await deployCashierHookMock();
    let cashierRoot: Contract = await upgrades.deployProxy(cashierFactory, [getAddress(tokenMock)]);
    await cashierRoot.waitForDeployment();
    cashierRoot = connect(cashierRoot, deployer); // Explicitly specifying the initial account

    let cashierAdmin: Contract = await upgrades.deployProxy(cashierFactory, [getAddress(tokenMock)]);
    await cashierAdmin.waitForDeployment();
    cashierAdmin = connect(cashierAdmin, deployer); // Explicitly specifying the initial account

    const cashierShards: Contract[] = [];
    const shardCount = 3;
    for (let i = 0; i < shardCount; ++i) {
      let cashierShard: Contract = await upgrades.deployProxy(cashierShardFactory, [getAddress(cashierRoot)]);
      await cashierShard.waitForDeployment();
      cashierShard = connect(cashierShard, deployer); // Explicitly specifying the initial account
      cashierShards.push(cashierShard);
    }

    return {
      cashierRoot,
      cashierAdmin,
      cashierShards,
      tokenMock,
      cashierHookMock
    };
  }

  async function deployAndConfigureContracts(): Promise<Fixture> {
    const fixture = await deployContracts();
    const { tokenMock, cashierRoot, cashierAdmin, cashierShards } = fixture;

    await proveTx(cashierRoot.grantRole(cashierRole, cashier.address));
    await proveTx(cashierRoot.grantRole(hookAdminRole, hookAdmin.address));
    await proveTx(cashierAdmin.grantRole(cashierRole, cashier.address));
    await proveTx(cashierAdmin.grantRole(hookAdminRole, hookAdmin.address));
    for (const user of users) {
      await proveTx(tokenMock.mint(user.address, INITIAL_USER_BALANCE));
      await proveTx(connect(tokenMock, user).approve(getAddress(cashierRoot), ethers.MaxUint256));
      await proveTx(connect(tokenMock, user).approve(getAddress(cashierAdmin), ethers.MaxUint256));
    }

    const cashierShardAddresses: string[] = cashierShards.map(shard => getAddress(shard));
    await proveTx(cashierRoot.addShards(cashierShardAddresses));
    await proveTx(cashierAdmin.addShards(cashierShardAddresses));

    await proveTx(cashierRoot.configureShardAdmin(getAddress(cashierAdmin), true));

    return fixture;
  }

  async function pauseContract(contract: Contract) {
    await proveTx(contract.grantRole(pauserRole, deployer.address));
    await proveTx(contract.pause());
  }

  async function requestCashOuts(cashierRoot: Contract, cashOuts: TestCashOut[]): Promise<TransactionResponse[]> {
    const txs: Promise<TransactionResponse>[] = [];
    for (const cashOut of cashOuts) {
      const tx =
        connect(cashierRoot, cashier).requestCashOutFrom(cashOut.account.address, cashOut.amount, cashOut.txId);
      await proveTx(tx); // To be sure the requested transactions are executed in the same order
      txs.push(tx);
      cashOut.status = CashOutStatus.Pending;
    }
    return Promise.all(txs);
  }

  async function makeInternalCashOuts(cashierRoot: Contract, cashOuts: TestCashOut[]): Promise<TransactionResponse[]> {
    const txs: Promise<TransactionResponse>[] = [];
    for (const cashOut of cashOuts) {
      const tx = connect(cashierRoot, cashier).makeInternalCashOut(
        cashOut.account.address, // from
        receiver.address, // to
        cashOut.amount,
        cashOut.txId
      );
      txs.push(tx);
      cashOut.status = CashOutStatus.Internal;
    }
    return Promise.all(txs);
  }

  async function forceCashOuts(cashierRoot: Contract, cashOuts: TestCashOut[]): Promise<TransactionResponse[]> {
    const txs: Promise<TransactionResponse>[] = [];
    for (const cashOut of cashOuts) {
      const tx = connect(cashierRoot, cashier).forceCashOut(
        cashOut.account.address,
        cashOut.amount,
        cashOut.txId
      );
      txs.push(tx);
      cashOut.status = CashOutStatus.Forced;
    }
    return Promise.all(txs);
  }

  function defineExpectedCashierState(cashOuts: TestCashOut[]): CashierState {
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

  async function checkCashInStructuresOnBlockchain(cashierRoot: Contract, cashIns: TestCashIn[]) {
    const txIds: string[] = cashIns.map(cashIn => cashIn.txId);
    const actualCashIns: Record<string, unknown>[] = await cashierRoot.getCashIns(txIds);
    for (let i = 0; i < cashIns.length; ++i) {
      const cashIn: TestCashIn = cashIns[i];
      const actualCashIn: Record<string, unknown> = await cashierRoot.getCashIn(cashIn.txId);
      checkCashInEquality(actualCashIn, cashIn, i);
      checkCashInEquality(actualCashIns[i], cashIn, i);
    }
  }

  async function checkCashOutStructuresOnBlockchain(cashierRoot: Contract, cashOuts: TestCashOut[]) {
    const txIds: string[] = cashOuts.map(cashOut => cashOut.txId);
    const actualCashOuts: Record<string, unknown>[] = await cashierRoot.getCashOuts(txIds);
    for (let i = 0; i < cashOuts.length; ++i) {
      const cashOut: TestCashOut = cashOuts[i];
      const actualCashOut: Record<string, unknown> = await cashierRoot.getCashOut(cashOut.txId);
      checkCashOutEquality(actualCashOut, cashOut, i);
      checkCashOutEquality(actualCashOuts[i], cashOut, i);
    }
  }

  async function checkCashierState(
    tokenMock: Contract,
    cashierRoot: Contract,
    cashOuts: TestCashOut[]
  ) {
    const expectedState: CashierState = defineExpectedCashierState(cashOuts);
    await checkCashOutStructuresOnBlockchain(cashierRoot, cashOuts);

    expect(await tokenMock.balanceOf(getAddress(cashierRoot))).to.equal(
      expectedState.tokenBalance,
      `The cashier total balance is wrong`
    );

    const actualPendingCashOutCounter = await cashierRoot.pendingCashOutCounter();
    expect(actualPendingCashOutCounter).to.equal(
      expectedState.pendingCashOutCounter,
      `The pending cash-out counter is wrong`
    );

    const actualPendingCashOutTxIds: string[] =
      await cashierRoot.getPendingCashOutTxIds(0, actualPendingCashOutCounter);
    expect(actualPendingCashOutTxIds).to.deep.equal(
      expectedState.pendingCashOutTxIds,
      `The pending cash-out tx ids are wrong`
    );

    for (const account of expectedState.cashOutBalancePerAccount.keys()) {
      const expectedCashOutBalance = expectedState.cashOutBalancePerAccount.get(account);
      if (!expectedCashOutBalance) {
        continue;
      }
      expect(await cashierRoot.cashOutBalanceOf(account)).to.equal(
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

  async function executeCashIn(cashierRoot: Contract, tokenMock: Contract, cashIn: TestCashIn) {
    const tx = connect(cashierRoot, cashier).cashIn(
      cashIn.account.address,
      cashIn.amount,
      cashIn.txId
    );
    await expect(tx).to.changeTokenBalances(
      tokenMock,
      [cashierRoot, cashIn.account],
      [0, +cashIn.amount]
    );
    await expect(tx).to.emit(cashierRoot, EVENT_NAME_CASH_IN).withArgs(
      cashIn.account.address,
      cashIn.amount,
      cashIn.txId
    );
    cashIn.status = CashInStatus.Executed;
    await checkCashInStructuresOnBlockchain(cashierRoot, [cashIn]);
  }

  async function executeCashInPremint(cashierRoot: Contract, tokenMock: Contract, cashIn: TestCashIn) {
    const tx = connect(cashierRoot, cashier).cashInPremint(
      cashIn.account.address,
      cashIn.amount,
      cashIn.txId,
      cashIn.releaseTimestamp
    );
    await expect(tx).to.emit(cashierRoot, EVENT_NAME_CASH_IN_PREMINT).withArgs(
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
    await checkCashInStructuresOnBlockchain(cashierRoot, [cashIn]);
  }

  async function executeCashInPremintRevoke(cashierRoot: Contract, tokenMock: Contract, cashIn: TestCashIn) {
    await executeCashInPremint(cashierRoot, tokenMock, cashIn);

    const tx = connect(cashierRoot, cashier).cashInPremintRevoke(
      cashIn.txId,
      cashIn.releaseTimestamp
    );
    cashIn.oldAmount = cashIn.amount;
    cashIn.amount = 0;
    cashIn.status = CashInStatus.Nonexistent;

    await expect(tx).to.emit(cashierRoot, EVENT_NAME_CASH_IN_PREMINT).withArgs(
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
    await checkCashInStructuresOnBlockchain(cashierRoot, [cashIn]);
  }

  async function executeRequestCashOut(
    cashierRoot: Contract,
    tokenMock: Contract,
    cashOut: TestCashOut
  ): Promise<void> {
    await checkCashierState(tokenMock, cashierRoot, [cashOut]);
    const tx = connect(cashierRoot, cashier).requestCashOutFrom(
      cashOut.account.address,
      cashOut.amount,
      cashOut.txId
    );
    await expect(tx).to.changeTokenBalances(
      tokenMock,
      [cashierRoot, cashier, cashOut.account],
      [+cashOut.amount, 0, -cashOut.amount]
    );
    await expect(tx).to.emit(cashierRoot, EVENT_NAME_CASH_OUT_REQUESTING).withArgs(
      cashOut.account.address,
      cashOut.amount, // amount
      cashOut.amount, // balance
      cashOut.txId,
      cashier.address
    );
    cashOut.status = CashOutStatus.Pending;
    await checkCashierState(tokenMock, cashierRoot, [cashOut]);
  }

  async function executeCashOutConfirm(
    cashierRoot: Contract,
    tokenMock: Contract,
    cashOut: TestCashOut
  ): Promise<void> {
    await requestCashOuts(cashierRoot, [cashOut]);
    await checkCashierState(tokenMock, cashierRoot, [cashOut]);
    const tx = connect(cashierRoot, cashier).confirmCashOut(cashOut.txId);

    await expect(tx).to.changeTokenBalances(
      tokenMock,
      [cashierRoot, cashOut.account],
      [-cashOut.amount, 0]
    );
    await expect(tx).to.emit(cashierRoot, EVENT_NAME_CASH_OUT_CONFIRMATION).withArgs(
      cashOut.account.address,
      cashOut.amount,
      BALANCE_ZERO,
      cashOut.txId
    );
    cashOut.status = CashOutStatus.Confirmed;
    await checkCashierState(tokenMock, cashierRoot, [cashOut]);
  }

  async function executeReverseCashOut(
    cashierRoot: Contract,
    tokenMock: Contract,
    cashOut: TestCashOut
  ): Promise<void> {
    await requestCashOuts(cashierRoot, [cashOut]);
    await checkCashierState(tokenMock, cashierRoot, [cashOut]);
    const tx = connect(cashierRoot, cashier).reverseCashOut(cashOut.txId);
    await expect(tx).to.changeTokenBalances(
      tokenMock,
      [cashOut.account, cashierRoot, cashier],
      [+cashOut.amount, -cashOut.amount, 0]
    );
    await expect(tx).to.emit(cashierRoot, EVENT_NAME_CASH_OUT_REVERSING).withArgs(
      cashOut.account.address,
      cashOut.amount,
      BALANCE_ZERO,
      cashOut.txId
    );
    cashOut.status = CashOutStatus.Reversed;
    await checkCashierState(tokenMock, cashierRoot, [cashOut]);
  }

  async function executeUpgradeShardsTo(
    cashierRoot: Contract,
    cashierShards: Contract[],
    targetShardImplementationAddress: string
  ) {
    const oldImplementationAddresses: string[] = await getImplementationAddresses(cashierShards);
    oldImplementationAddresses.forEach((_, i) => {
      expect(oldImplementationAddresses[i]).to.not.eq(
        targetShardImplementationAddress,
        `oldImplementationAddresses[${i}] is wrong`
      );
    });

    await proveTx(cashierRoot.upgradeShardsTo(targetShardImplementationAddress));

    const newImplementationAddresses: string[] = await getImplementationAddresses(cashierShards);
    newImplementationAddresses.forEach((_, i) => {
      expect(newImplementationAddresses[i]).to.eq(
        targetShardImplementationAddress,
        `newImplementationAddresses[${i}] is wrong`
      );
    });
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the root contract as expected", async () => {
      const { cashierRoot, tokenMock } = await setUpFixture(deployContracts);

      // The underlying contract address
      expect(await cashierRoot.underlyingToken()).to.equal(getAddress(tokenMock));

      // Role hashes
      expect(await cashierRoot.OWNER_ROLE()).to.equal(ownerRole);
      expect(await cashierRoot.PAUSER_ROLE()).to.equal(pauserRole);
      expect(await cashierRoot.RESCUER_ROLE()).to.equal(rescuerRole);
      expect(await cashierRoot.CASHIER_ROLE()).to.equal(cashierRole);
      expect(await cashierRoot.HOOK_ADMIN_ROLE()).to.equal(hookAdminRole);

      // The role admins
      expect(await cashierRoot.getRoleAdmin(ownerRole)).to.equal(ownerRole);
      expect(await cashierRoot.getRoleAdmin(pauserRole)).to.equal(ownerRole);
      expect(await cashierRoot.getRoleAdmin(rescuerRole)).to.equal(ownerRole);
      expect(await cashierRoot.getRoleAdmin(cashierRole)).to.equal(ownerRole);
      expect(await cashierRoot.getRoleAdmin(hookAdminRole)).to.equal(ownerRole);

      // The deployer should have the owner role, but not the other roles
      expect(await cashierRoot.hasRole(ownerRole, deployer.address)).to.equal(true);
      expect(await cashierRoot.hasRole(pauserRole, deployer.address)).to.equal(false);
      expect(await cashierRoot.hasRole(rescuerRole, deployer.address)).to.equal(false);
      expect(await cashierRoot.hasRole(cashierRole, deployer.address)).to.equal(false);
      expect(await cashierRoot.hasRole(hookAdminRole, deployer.address)).to.equal(false);

      // The initial contract state is unpaused
      expect(await cashierRoot.paused()).to.equal(false);

      // The initial values of counters and pending cash-outs
      expect(await cashierRoot.pendingCashOutCounter()).to.equal(0);
      expect(await cashierRoot.getPendingCashOutTxIds(0, 1)).to.be.empty;

      // Other parameters and constants
      expect(await cashierRoot.MAX_SHARD_COUNT()).to.equal(MAX_SHARD_COUNT);
      expect(await cashierRoot.getShardCount()).to.equal(0);
    });

    it("Configures the shard contract as expected", async () => {
      const { cashierRoot, cashierShards } = await setUpFixture(deployContracts);

      // Owner
      for (const cashierShard of cashierShards) {
        expect(await cashierShard.owner()).to.equal(getAddress(cashierRoot));
      }
    });

    it("Is reverted if it is called a second time for the root contract", async () => {
      const { cashierRoot, tokenMock } = await setUpFixture(deployContracts);
      await expect(
        cashierRoot.initialize(getAddress(tokenMock))
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_CONTRACT_INITIALIZATION_IS_INVALID);
    });

    it("Is reverted if it is called a second time for the shard contract", async () => {
      const { cashierRoot, cashierShards: [cashierShard] } = await setUpFixture(deployContracts);
      await expect(
        cashierShard.initialize(getAddress(cashierRoot))
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_CONTRACT_INITIALIZATION_IS_INVALID);
    });

    it("Is reverted if the passed token address is zero for the root contract", async () => {
      const anotherCashierRoot: Contract = await upgrades.deployProxy(cashierFactory, [], {
        initializer: false
      });

      await expect(
        anotherCashierRoot.initialize(ADDRESS_ZERO)
      ).to.be.revertedWithCustomError(cashierFactory, REVERT_ERROR_IF_TOKEN_ADDRESS_IS_ZERO);
    });

    it("Is reverted if the passed owner address is zero for the shard contract", async () => {
      const anotherCashierShard: Contract = await upgrades.deployProxy(cashierShardFactory, [], {
        initializer: false
      });

      await expect(
        anotherCashierShard.initialize(ADDRESS_ZERO)
      ).to.be.revertedWithCustomError(cashierShardFactory, REVERT_ERROR_IF_OWNABLE_INVALID_OWNER);
    });
  });

  describe("Function 'upgradeToAndCall()'", async () => {
    it("Executes as expected for the root contract", async () => {
      const { cashierRoot } = await setUpFixture(deployContracts);
      await checkContractUupsUpgrading(cashierRoot, cashierFactory);
    });

    it("Executes as expected for the shard contract", async () => {
      const anotherCashierShard: Contract = await upgrades.deployProxy(cashierShardFactory, [deployer.address]);
      await checkContractUupsUpgrading(anotherCashierShard, cashierShardFactory);
    });

    it("Is reverted if the caller is not the owner for the root contract", async () => {
      const { cashierRoot } = await setUpFixture(deployContracts);

      await expect(connect(cashierRoot, user).upgradeToAndCall(user.address, "0x"))
        .to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT)
        .withArgs(user.address, ownerRole);
    });

    it("Is reverted if the caller is not the owner or admin for the shard contract", async () => {
      const anotherCashierShard: Contract = await upgrades.deployProxy(cashierShardFactory, [deployer.address]);

      await expect(connect(anotherCashierShard, user).upgradeToAndCall(user.address, "0x"))
        .to.be.revertedWithCustomError(anotherCashierShard, REVERT_ERROR_IF_UNAUTHORIZED);
    });
  });

  describe("Function 'upgradeTo()'", async () => {
    it("Executes as expected for the root contract", async () => {
      const { cashierRoot } = await setUpFixture(deployContracts);
      await checkContractUupsUpgrading(cashierRoot, cashierFactory, "upgradeTo(address)");
    });

    it("Executes as expected for the shard contract", async () => {
      const anotherCashierShard: Contract = await upgrades.deployProxy(cashierShardFactory, [deployer.address]);
      await checkContractUupsUpgrading(anotherCashierShard, cashierShardFactory, "upgradeTo(address)");
    });

    it("Is reverted if the caller is not the owner", async () => {
      const { cashierRoot } = await setUpFixture(deployContracts);

      await expect(connect(cashierRoot, user).upgradeTo(user.address))
        .to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT)
        .withArgs(user.address, ownerRole);
    });

    it("Is reverted if the caller is not the owner or admin", async () => {
      const anotherCashierShard: Contract = await upgrades.deployProxy(cashierShardFactory, [deployer.address]);

      await expect(connect(anotherCashierShard, user).upgradeTo(user.address))
        .to.be.revertedWithCustomError(anotherCashierShard, REVERT_ERROR_IF_UNAUTHORIZED);
    });
  });

  describe("Function 'initHookAdminRole()'", async () => {
    it("Executes as expected", async () => {
      const { cashierRoot } = await setUpFixture(deployContracts);
      const tx = cashierRoot.initHookAdminRole();
      await expect(tx).to.emit(cashierRoot, EVENT_NAME_ROLE_ADMIN_CHANGED).withArgs(
        hookAdminRole,
        ownerRole,
        ownerRole
      );
    });

    it("Is reverted if the caller is not the owner", async () => {
      const { cashierRoot } = await setUpFixture(deployContracts);
      await expect(
        connect(cashierRoot, cashier).initHookAdminRole()
      ).to.be.revertedWithCustomError(
        cashierRoot,
        REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT
      ).withArgs(cashier.address, ownerRole);
    });
  });

  describe("Function 'addShards()'", async () => {
    it("Executes as expected", async () => {
      const { cashierRoot } = await setUpFixture(deployContracts);
      const shardAddresses = users.map(user => user.address);

      const tx1 = cashierRoot.addShards([shardAddresses[0]]);
      await expect(tx1).to.emit(cashierRoot, EVENT_NAME_SHARD_ADDED).withArgs(shardAddresses[0]);
      expect(await cashierRoot.getShardCount()).to.eq(1);

      const tx2 = cashierRoot.addShards(shardAddresses);
      for (const shardAddress of shardAddresses) {
        await expect(tx2).to.emit(cashierRoot, EVENT_NAME_SHARD_ADDED).withArgs(shardAddress);
      }
      expect(await cashierRoot.getShardCount()).to.eq(1 + shardAddresses.length);
    });

    it("Is reverted if the caller is not the owner", async () => {
      const { cashierRoot } = await setUpFixture(deployContracts);
      const fakeShardAddress = user.address;
      await expect(
        connect(cashierRoot, cashier).addShards([fakeShardAddress])
      ).to.be.revertedWithCustomError(
        cashierRoot,
        REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT
      ).withArgs(cashier.address, ownerRole);
    });

    it("Is reverted if the number of shard exceeds the allowed maximum", async () => {
      const { cashierRoot } = await setUpFixture(deployContracts);
      const fakeShardAddress: string[] = Array.from(
        { length: MAX_SHARD_COUNT },
        (_v, i) => "0x" + ((i + 1).toString().padStart(40, "0"))
      );
      const additionalFakeShardAddress = user.address;
      await proveTx(cashierRoot.addShards(fakeShardAddress));

      await expect(
        cashierRoot.addShards([additionalFakeShardAddress])
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_SHARD_COUNT_EXCESS);
    });
  });

  describe("Function 'replaceShards()'", async () => {
    it("Executes as expected", async () => {
      const { cashierRoot } = await setUpFixture(deployContracts);
      const shardCount = 5;
      const oldShardAddresses = Array.from(
        { length: shardCount },
        (_v, i) => "0x" + (i + 1).toString(16).padStart(40, "0")
      );
      const newShardAddresses = Array.from(
        { length: shardCount },
        (_v, i) => "0x" + (i + 16).toString(16).padStart(40, "0")
      );

      await proveTx(cashierRoot.addShards(oldShardAddresses));

      // The empty array of addresses to replace
      const tx1 = cashierRoot.replaceShards(0, []);
      await expect(tx1).not.to.emit(cashierRoot, EVENT_NAME_SHARD_REPLACED);

      // The start index is outside the array of existing shards
      const tx2 = cashierRoot.replaceShards(oldShardAddresses.length, newShardAddresses);
      await expect(tx2).not.to.emit(cashierRoot, EVENT_NAME_SHARD_REPLACED);

      // Replacing the first shard address
      const tx3 = cashierRoot.replaceShards(0, [newShardAddresses[0]]);
      await expect(tx3).to.emit(cashierRoot, EVENT_NAME_SHARD_REPLACED).withArgs(
        newShardAddresses[0],
        oldShardAddresses[0]
      );
      oldShardAddresses[0] = newShardAddresses[0];
      expect(await cashierRoot.getShardRange(0, oldShardAddresses.length)).to.deep.eq(oldShardAddresses);

      // Replacing two shards in the middle
      const tx4 = cashierRoot.replaceShards(1, [newShardAddresses[1], newShardAddresses[2]]);
      await expect(tx4).to.emit(cashierRoot, EVENT_NAME_SHARD_REPLACED).withArgs(
        newShardAddresses[1],
        oldShardAddresses[1]
      );
      await expect(tx4).to.emit(cashierRoot, EVENT_NAME_SHARD_REPLACED).withArgs(
        newShardAddresses[2],
        oldShardAddresses[2]
      );
      oldShardAddresses[1] = newShardAddresses[1];
      oldShardAddresses[2] = newShardAddresses[2];
      expect(await cashierRoot.getShardRange(0, oldShardAddresses.length)).to.deep.eq(oldShardAddresses);

      // Replacing all shards except the first one.
      // One address is duplicated in the result shard array.
      newShardAddresses.pop();
      const tx5 = cashierRoot.replaceShards(1, newShardAddresses);
      for (let i = 1; i < oldShardAddresses.length; ++i) {
        await expect(tx5).to.emit(cashierRoot, EVENT_NAME_SHARD_REPLACED).withArgs(
          newShardAddresses[i - 1],
          oldShardAddresses[i]
        );
        oldShardAddresses[i] = newShardAddresses[i - 1];
      }
      expect(await cashierRoot.getShardRange(0, oldShardAddresses.length)).to.deep.eq(oldShardAddresses);
    });

    it("Is reverted if the caller is not the owner", async () => {
      const { cashierRoot } = await setUpFixture(deployContracts);
      const fakeShardAddress = user.address;
      await expect(
        connect(cashierRoot, user).replaceShards(0, [fakeShardAddress])
      ).to.be.revertedWithCustomError(
        cashierRoot,
        REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT
      ).withArgs(user.address, ownerRole);
    });

    it("Is reverted if the number of shards to replacement is greater than expected", async () => {
      const { cashierRoot } = await setUpFixture(deployContracts);
      const fakeShardAddresses = Array.from(
        { length: 3 },
        (_v, i) => "0x" + (i + 1).toString(16).padStart(40, "0")
      );
      await proveTx(cashierRoot.addShards(fakeShardAddresses));

      await expect(
        cashierRoot.replaceShards(1, fakeShardAddresses)
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_SHARD_REPLACEMENT_COUNT_EXCESS);
    });
  });

  describe("Function 'upgradeShardsTo()'", async () => {
    it("Executes as expected", async () => {
      const { cashierRoot, cashierAdmin, cashierShards } = await setUpFixture(deployAndConfigureContracts);

      const targetShardImplementation1: Contract = await cashierShardFactory.deploy() as Contract;
      await targetShardImplementation1.waitForDeployment();
      const targetShardImplementationAddress1 = getAddress(targetShardImplementation1);
      await executeUpgradeShardsTo(cashierRoot, cashierShards, targetShardImplementationAddress1);

      const targetShardImplementation2: Contract = await cashierShardFactory.deploy() as Contract;
      await targetShardImplementation2.waitForDeployment();
      const targetShardImplementationAddress2 = getAddress(targetShardImplementation2);
      await executeUpgradeShardsTo(cashierAdmin, cashierShards, targetShardImplementationAddress2);
    });

    it("Is reverted if the caller is not the owner", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(cashierRoot, user).upgradeShardsTo(user.address)
      ).to.be.revertedWithCustomError(
        cashierRoot,
        REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT
      ).withArgs(user.address, ownerRole);
    });

    it("Is reverted if the shard implementation address is zero", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        cashierRoot.upgradeShardsTo(ADDRESS_ZERO)
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_SHARD_ADDRESS_IS_ZERO);
    });
  });

  describe("Function 'upgradeRootAndShardsTo()'", async () => {
    it("Executes as expected", async () => {
      const { cashierRoot, cashierShards } = await setUpFixture(deployAndConfigureContracts);

      const targetRootImplementation: Contract = await cashierFactory.deploy() as Contract;
      await targetRootImplementation.waitForDeployment();
      const targetRootImplementationAddress = getAddress(targetRootImplementation);

      const targetShardImplementation: Contract = await cashierShardFactory.deploy() as Contract;
      await targetShardImplementation.waitForDeployment();
      const targetShardImplementationAddress = getAddress(targetShardImplementation);

      const oldRootImplementationAddress = await upgrades.erc1967.getImplementationAddress(getAddress(cashierRoot));
      expect(oldRootImplementationAddress).to.not.eq(targetRootImplementationAddress);

      const oldShardImplementationAddresses: string[] = await getImplementationAddresses(cashierShards);
      oldShardImplementationAddresses.forEach((_, i) => {
        expect(oldShardImplementationAddresses[i]).to.not.eq(
          targetShardImplementationAddress,
          `oldShardImplementationAddresses[${i}] is wrong`
        );
      });

      await proveTx(cashierRoot.upgradeRootAndShardsTo(
        targetRootImplementationAddress,
        targetShardImplementationAddress
      ));

      const newRootImplementationAddress = await upgrades.erc1967.getImplementationAddress(getAddress(cashierRoot));
      expect(newRootImplementationAddress).to.eq(targetRootImplementationAddress);

      const newShardImplementationAddresses: string[] = await getImplementationAddresses(cashierShards);
      newShardImplementationAddresses.forEach((_, i) => {
        expect(newShardImplementationAddresses[i]).to.eq(
          targetShardImplementationAddress,
          `newShardImplementationAddresses[${i}] is wrong`
        );
      });
    });

    it("Is reverted if the caller is not the owner or admin", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);

      const targetRootImplementation: Contract = await cashierFactory.deploy() as Contract;
      await targetRootImplementation.waitForDeployment();
      const targetRootImplementationAddress = getAddress(targetRootImplementation);

      const targetShardImplementation: Contract = await cashierShardFactory.deploy() as Contract;
      await targetShardImplementation.waitForDeployment();
      const targetShardImplementationAddress = getAddress(targetShardImplementation);

      await expect(
        connect(cashierRoot, user).upgradeRootAndShardsTo(
          targetRootImplementationAddress,
          targetShardImplementationAddress
        )
      ).to.be.revertedWithCustomError(
        cashierRoot,
        REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT
      ).withArgs(user.address, ownerRole);
    });

    it("Is reverted if the root implementation address is zero", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);

      const targetShardImplementation: Contract = await cashierShardFactory.deploy() as Contract;
      await targetShardImplementation.waitForDeployment();
      const targetShardImplementationAddress = getAddress(targetShardImplementation);

      await expect(
        cashierRoot.upgradeRootAndShardsTo(
          ADDRESS_ZERO,
          targetShardImplementationAddress
        )
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_ROOT_ADDRESS_IS_ZERO);
    });

    it("Is reverted if the shard implementation address is zero", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);

      const targetRootImplementation: Contract = await cashierFactory.deploy() as Contract;
      await targetRootImplementation.waitForDeployment();
      const targetRootImplementationAddress = getAddress(targetRootImplementation);

      await expect(
        cashierRoot.upgradeRootAndShardsTo(
          targetRootImplementationAddress,
          ADDRESS_ZERO
        )
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_SHARD_ADDRESS_IS_ZERO);
    });
  });

  describe("Function 'configureShardAdmin()' accompanied by the 'setAdmin()' one", async () => {
    it("Executes as expected", async () => {
      const { cashierRoot, cashierAdmin, cashierShards } = await setUpFixture(deployAndConfigureContracts);

      for (const cashierShard of cashierShards) {
        expect(await cashierShard.isAdmin(user.address)).to.eq(false);
      }

      const tx1 = await proveTx(cashierRoot.configureShardAdmin(user.address, true));
      await expect(tx1)
        .to.emit(cashierRoot, EVENT_NAME_SHARD_ADMIN_CONFIGURED)
        .withArgs(
          user.address,
          true
        );

      for (const cashierShard of cashierShards) {
        expect(await cashierShard.isAdmin(user.address)).to.eq(true);
      }

      const tx2 = await proveTx(cashierAdmin.configureShardAdmin(user.address, false));
      await expect(tx2)
        .to.emit(cashierAdmin, EVENT_NAME_SHARD_ADMIN_CONFIGURED)
        .withArgs(
          user.address,
          false
        );

      for (const cashierShard of cashierShards) {
        expect(await cashierShard.isAdmin(user.address)).to.eq(false);
      }
    });

    it("Is reverted if the caller is not the owner or admin", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(cashierRoot, user).configureShardAdmin(user.address, true)
      ).to.be.revertedWithCustomError(
        cashierRoot,
        REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT
      ).withArgs(user.address, ownerRole);
    });

    it("Is reverted if the provide account address is zero", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        cashierRoot.configureShardAdmin(ADDRESS_ZERO, true)
      ).to.be.revertedWithCustomError(
        cashierRoot,
        REVERT_ERROR_IF_ACCOUNT_ADDRESS_IS_ZERO
      );
    });
  });

  describe("Function 'cashIn()' accompanied by the 'registerCashIn()' one", async () => {
    it("Executes as expected", async () => {
      const { cashierRoot, cashierAdmin, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      const [cashIn, cashIn2] = defineTestCashIns(2);
      await executeCashIn(cashierRoot, tokenMock, cashIn);
      await executeCashIn(cashierAdmin, tokenMock, cashIn2);
    });

    it("Is reverted if the contract is paused", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await pauseContract(cashierRoot);
      await expect(
        connect(cashierRoot, cashier).cashIn(user.address, TOKEN_AMOUNT, TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the cashier role", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(cashierRoot, deployer).cashIn(user.address, TOKEN_AMOUNT, TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(
        cashierRoot,
        REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT
      ).withArgs(deployer.address, cashierRole);
    });

    it("Is reverted if the account address is zero", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(cashierRoot, cashier).cashIn(ADDRESS_ZERO, TOKEN_AMOUNT, TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_ACCOUNT_ADDRESS_IS_ZERO);
    });

    it("Is reverted if the token amount is zero", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(cashierRoot, cashier).cashIn(user.address, TOKEN_AMOUNT_ZERO, TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_AMOUNT_IS_ZERO);
    });

    it("Is reverted if the token amount is greater than 64-bit unsigned integer", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      const amount = BigInt("0x10000000000000000");
      await expect(
        connect(cashierRoot, cashier).cashIn(user.address, amount, TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_AMOUNT_EXCESS);
    });

    it("Is reverted if the off-chain transaction ID is zero", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(cashierRoot, cashier).cashIn(user.address, TOKEN_AMOUNT, TRANSACTION_ID_ZERO)
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_TRANSACTION_ID_IS_ZERO);
    });

    it("Is reverted if minting function returns 'false'", async () => {
      const { cashierRoot, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      await proveTx(tokenMock.setMintResult(false));
      await expect(
        connect(cashierRoot, cashier).cashIn(user.address, TOKEN_AMOUNT, TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_TOKEN_MINTING_FAILURE);
    });

    it("Is reverted if the cash-in with the provided txId is already executed", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await proveTx(connect(cashierRoot, cashier).cashIn(user.address, TOKEN_AMOUNT, TRANSACTION_ID1));
      await expect(connect(cashierRoot, cashier).cashIn(deployer.address, TOKEN_AMOUNT + 1, TRANSACTION_ID1))
        .to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_CASH_IN_ALREADY_EXECUTED);
    });
  });

  describe("Functions 'cashInPremint()' accompanied by the 'registerCashIn()' one", async () => {
    it("Executes as expected", async () => {
      const { cashierRoot, cashierAdmin, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      const [cashIn, cashIn2] = defineTestCashIns(2, RELEASE_TIMESTAMP);
      await executeCashInPremint(cashierRoot, tokenMock, cashIn);
      await executeCashInPremint(cashierAdmin, tokenMock, cashIn2);
    });

    it("Is reverted if the contract is paused", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await pauseContract(cashierRoot);
      await expect(
        connect(cashierRoot, cashier).cashInPremint(user.address, TOKEN_AMOUNT, TRANSACTION_ID1, RELEASE_TIMESTAMP)
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the cashier role", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(cashierRoot, deployer).cashInPremint(user.address, TOKEN_AMOUNT, TRANSACTION_ID1, RELEASE_TIMESTAMP)
      ).to.be.revertedWithCustomError(
        cashierRoot,
        REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT
      ).withArgs(deployer.address, cashierRole);
    });

    it("Is reverted if the premint release time is zero", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(cashierRoot, cashier).cashInPremint(
          user.address,
          TOKEN_AMOUNT,
          TRANSACTION_ID1,
          RELEASE_TIMESTAMP_ZERO
        )
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_PREMINT_RELEASE_TIME_INAPPROPRIATE);
    });

    it("Is reverted if the account address is zero", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(cashierRoot, cashier).cashInPremint(
          ADDRESS_ZERO,
          TOKEN_AMOUNT,
          TRANSACTION_ID1,
          RELEASE_TIMESTAMP
        )
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_ACCOUNT_ADDRESS_IS_ZERO);
    });

    it("Is reverted if the token amount is zero", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(cashierRoot, cashier).cashInPremint(
          user.address,
          TOKEN_AMOUNT_ZERO,
          TRANSACTION_ID1,
          RELEASE_TIMESTAMP
        )
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_AMOUNT_IS_ZERO);
    });

    it("Is reverted if the token amount is greater than 64-bit unsigned integer", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      const amount = BigInt("0x10000000000000000");
      await expect(
        connect(cashierRoot, cashier).cashInPremint(user.address, amount, TRANSACTION_ID1, RELEASE_TIMESTAMP)
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_AMOUNT_EXCESS);
    });

    it("Is reverted if the off-chain transaction ID is zero", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(cashierRoot, cashier).cashInPremint(
          user.address,
          TOKEN_AMOUNT,
          TRANSACTION_ID_ZERO,
          RELEASE_TIMESTAMP
        )
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_TRANSACTION_ID_IS_ZERO);
    });

    it("Is reverted if the cash-in with the provided txId is already executed", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await proveTx(connect(cashierRoot, cashier).cashIn(user.address, TOKEN_AMOUNT, TRANSACTION_ID1));
      await expect(
        connect(cashierRoot, cashier).cashInPremint(user.address, TOKEN_AMOUNT, TRANSACTION_ID1, RELEASE_TIMESTAMP)
      ).to.be.revertedWithCustomError(
        cashierRoot,
        REVERT_ERROR_IF_CASH_IN_ALREADY_EXECUTED
      );
    });
  });

  describe("Functions 'cashInPremintRevoke()' accompanied by the 'revokeCashIn()' one", async () => {
    it("Executes as expected", async () => {
      const { cashierRoot, cashierAdmin, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      const [cashIn, cashIn2] = defineTestCashIns(2, RELEASE_TIMESTAMP);
      await executeCashInPremintRevoke(cashierRoot, tokenMock, cashIn);
      await executeCashInPremintRevoke(cashierAdmin, tokenMock, cashIn2);
    });

    it("Is reverted if the contract is paused", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await pauseContract(cashierRoot);
      await expect(
        connect(cashierRoot, cashier).cashInPremintRevoke(TRANSACTION_ID1, RELEASE_TIMESTAMP)
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the cashier role", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(cashierRoot, deployer).cashInPremintRevoke(TRANSACTION_ID1, RELEASE_TIMESTAMP)
      ).to.be.revertedWithCustomError(
        cashierRoot,
        REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT
      ).withArgs(deployer.address, cashierRole);
    });

    it("Is reverted if the premint release time is zero", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(cashierRoot, cashier).cashInPremintRevoke(TRANSACTION_ID1, RELEASE_TIMESTAMP_ZERO)
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_PREMINT_RELEASE_TIME_INAPPROPRIATE);
    });

    it("Is reverted if the off-chain transaction ID is zero", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(cashierRoot, cashier).cashInPremintRevoke(
          TRANSACTION_ID_ZERO,
          RELEASE_TIMESTAMP
        )
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_TRANSACTION_ID_IS_ZERO);
    });

    it("Is reverted if the cash-in with the provided txId does not exist", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(connect(cashierRoot, cashier).cashInPremintRevoke(TRANSACTION_ID1, RELEASE_TIMESTAMP))
        .to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_CASH_IN_STATUS_INAPPROPRIATE);
    });
  });

  describe("Function 'reschedulePremintRelease()'", async () => {
    const originalReleaseTimestamp = 123;
    const targetReleaseTimestamp = 321;

    it("Executes as expected", async () => {
      const { cashierRoot, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      const tx: TransactionResponse = await connect(cashierRoot, cashier).reschedulePremintRelease(
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
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await pauseContract(cashierRoot);
      await expect(
        connect(cashierRoot, cashier).reschedulePremintRelease(
          originalReleaseTimestamp,
          targetReleaseTimestamp
        )
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the cashier role", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(cashierRoot, deployer).reschedulePremintRelease(
          originalReleaseTimestamp,
          targetReleaseTimestamp
        )
      ).to.be.revertedWithCustomError(
        cashierRoot,
        REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT
      ).withArgs(deployer.address, cashierRole);
    });
  });

  describe("Function 'requestCashOutFrom()' accompanied by the 'registerCashOut()' one", async () => {
    it("Executes as expected", async () => {
      const { cashierRoot, cashierAdmin, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      const [cashOut, cashOut2] = defineTestCashOuts(2);
      await executeRequestCashOut(cashierRoot, tokenMock, cashOut);
      await executeRequestCashOut(cashierAdmin, tokenMock, cashOut2);
    });

    it("Is reverted if the contract is paused", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await pauseContract(cashierRoot);
      await expect(
        connect(cashierRoot, cashier).requestCashOutFrom(user.address, TOKEN_AMOUNT, TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the cashier role", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(cashierRoot, deployer).requestCashOutFrom(user.address, TOKEN_AMOUNT, TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(
        cashierRoot,
        REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT
      ).withArgs(deployer.address, cashierRole);
    });

    it("Is reverted if the account address is zero", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(cashierRoot, cashier).requestCashOutFrom(ADDRESS_ZERO, TOKEN_AMOUNT, TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_ACCOUNT_ADDRESS_IS_ZERO);
    });

    it("Is reverted if the token amount is zero", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(cashierRoot, cashier).requestCashOutFrom(user.address, TOKEN_AMOUNT_ZERO, TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_AMOUNT_IS_ZERO);
    });

    it("Is reverted if the token amount is greater than 64-bit unsigned integer", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      const amount: bigint = BigInt("0x10000000000000000");
      await expect(
        connect(cashierRoot, cashier).requestCashOutFrom(user.address, amount, TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_AMOUNT_EXCESS);
    });

    it("Is reverted if the off-chain transaction ID is zero", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(cashierRoot, cashier).requestCashOutFrom(user.address, TOKEN_AMOUNT, TRANSACTION_ID_ZERO)
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_TRANSACTION_ID_IS_ZERO);
    });

    it("Is reverted if the cash-out with the provided txId is already pending", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await connect(cashierRoot, cashier).requestCashOutFrom(user.address, TOKEN_AMOUNT, TRANSACTION_ID1);
      await expect(connect(cashierRoot, cashier).requestCashOutFrom(user.address, TOKEN_AMOUNT, TRANSACTION_ID1))
        .to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_CASH_OUT_STATUS_INAPPROPRIATE);
    });

    it("Is reverted if the cash-out with the provided txId is already confirmed", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await connect(cashierRoot, cashier).requestCashOutFrom(user.address, TOKEN_AMOUNT, TRANSACTION_ID1);
      await connect(cashierRoot, cashier).confirmCashOut(TRANSACTION_ID1);
      await expect(connect(cashierRoot, cashier).requestCashOutFrom(user.address, TOKEN_AMOUNT, TRANSACTION_ID1))
        .to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_CASH_OUT_STATUS_INAPPROPRIATE);
    });

    it("Is reverted if the cash-out with the provided txId has status 'Internal'", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      const tx = connect(cashierRoot, cashier).makeInternalCashOut(
        user.address,
        receiver.address,
        TOKEN_AMOUNT,
        TRANSACTION_ID1
      );
      await proveTx(tx);
      await expect(connect(cashierRoot, cashier).requestCashOutFrom(user.address, TOKEN_AMOUNT, TRANSACTION_ID1))
        .to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_CASH_OUT_STATUS_INAPPROPRIATE);
    });

    it("Is reverted if the cash-out with the provided txId has status 'Forced'", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      const tx = connect(cashierRoot, cashier).forceCashOut(
        user.address,
        TOKEN_AMOUNT,
        TRANSACTION_ID1
      );
      await proveTx(tx);
      await expect(connect(cashierRoot, cashier).requestCashOutFrom(user.address, TOKEN_AMOUNT, TRANSACTION_ID1))
        .to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_CASH_OUT_STATUS_INAPPROPRIATE);
    });

    it("Is reverted if txId of a reversed cash-out operation is reused for another account", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await connect(cashierRoot, cashier).requestCashOutFrom(user.address, TOKEN_AMOUNT, TRANSACTION_ID1);
      await connect(cashierRoot, cashier).reverseCashOut(TRANSACTION_ID1);
      await expect(connect(cashierRoot, cashier).requestCashOutFrom(deployer.address, TOKEN_AMOUNT, TRANSACTION_ID1))
        .to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_CASH_OUT_ACCOUNT_INAPPROPRIATE);
    });

    it("Is reverted if the user has not enough tokens", async () => {
      const { cashierRoot, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      const tokenAmount = INITIAL_USER_BALANCE + 1;
      await expect(
        connect(cashierRoot, cashier).requestCashOutFrom(user.address, tokenAmount, TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(
        tokenMock,
        REVERT_ERROR_IF_ERC20_TOKEN_TRANSFER_AMOUNT_EXCEEDS_BALANCE
      ).withArgs(user.address, INITIAL_USER_BALANCE, tokenAmount);
    });
  });

  describe("Function 'confirmCashOut()' accompanied by the 'processCashOut()' one", async () => {
    it("Executes as expected", async () => {
      const { cashierRoot, cashierAdmin, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      const [cashOut, cashOut2] = defineTestCashOuts(2);
      await executeCashOutConfirm(cashierRoot, tokenMock, cashOut);
      await executeCashOutConfirm(cashierAdmin, tokenMock, cashOut2);
    });

    it("Is reverted if the contract is paused", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await pauseContract(cashierRoot);
      await expect(
        connect(cashierRoot, cashier).confirmCashOut(TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the cashier role", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(cashierRoot, deployer).confirmCashOut(TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(
        cashierRoot,
        REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT
      ).withArgs(deployer.address, cashierRole);
    });

    it("Is reverted if the off-chain transaction ID is zero", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(cashierRoot, cashier).confirmCashOut(TRANSACTION_ID_ZERO)
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_TRANSACTION_ID_IS_ZERO);
    });

    it("Is reverted if the cash-out with the provided txId was not requested previously", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(connect(cashierRoot, cashier).confirmCashOut(TRANSACTION_ID1))
        .to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_CASH_OUT_STATUS_INAPPROPRIATE);
    });
  });

  describe("Function 'reverseCashOut()' accompanied by the 'processCashOut()' one", async () => {
    it("Executes as expected", async () => {
      const { cashierRoot, cashierAdmin, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      const [cashOut, cashOut2] = defineTestCashOuts(2);
      await executeReverseCashOut(cashierRoot, tokenMock, cashOut);
      await executeReverseCashOut(cashierAdmin, tokenMock, cashOut2);
    });

    it("Is reverted if the contract is paused", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await pauseContract(cashierRoot);
      await expect(
        connect(cashierRoot, cashier).reverseCashOut(TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the cashier role", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(cashierRoot, deployer).reverseCashOut(TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(
        cashierRoot,
        REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT
      ).withArgs(deployer.address, cashierRole);
    });

    it("Is reverted if the off-chain transaction ID is zero", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(cashierRoot, cashier).reverseCashOut(TRANSACTION_ID_ZERO)
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_TRANSACTION_ID_IS_ZERO);
    });

    it("Is reverted if the cash-out with the provided txId was not requested previously", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(connect(cashierRoot, cashier).reverseCashOut(TRANSACTION_ID1))
        .to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_CASH_OUT_STATUS_INAPPROPRIATE);
    });
  });

  describe("Function 'makeInternalCashOut()'", async () => {
    it("Executes as expected", async () => {
      const { cashierRoot, tokenMock } = await setUpFixture(deployAndConfigureContracts);

      const [cashOut] = defineTestCashOuts();

      await checkCashierState(tokenMock, cashierRoot, [cashOut]);
      const tx = connect(cashierRoot, cashier).makeInternalCashOut(
        cashOut.account.address,
        receiver.address,
        cashOut.amount,
        cashOut.txId
      );
      await expect(tx).to.changeTokenBalances(
        tokenMock,
        [cashierRoot, cashier, cashOut.account, receiver.address],
        [0, 0, -cashOut.amount, +cashOut.amount]
      );
      await expect(tx).to.emit(cashierRoot, EVENT_NAME_INTERNAL_CASH_OUT).withArgs(
        cashOut.account.address, // from
        cashOut.txId,
        receiver.address, // to
        cashOut.amount
      );
      cashOut.status = CashOutStatus.Internal;
      await checkCashierState(tokenMock, cashierRoot, [cashOut]);
    });

    it("Is reverted if the contract is paused", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await pauseContract(cashierRoot);
      await expect(
        connect(cashierRoot, cashier).makeInternalCashOut(
          user.address,
          receiver.address,
          TOKEN_AMOUNT,
          TRANSACTION_ID1
        )
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the cashier role", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(cashierRoot, deployer).makeInternalCashOut(
          user.address,
          receiver.address,
          TOKEN_AMOUNT,
          TRANSACTION_ID1
        )
      ).to.be.revertedWithCustomError(
        cashierRoot,
        REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT
      ).withArgs(deployer.address, cashierRole);
    });

    it("Is reverted if the token receiver address is zero", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(cashierRoot, cashier).makeInternalCashOut(user.address, ADDRESS_ZERO, TOKEN_AMOUNT, TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_ACCOUNT_ADDRESS_IS_ZERO);
    });

    it("Is reverted if the token sender address is zero", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(cashierRoot, cashier).makeInternalCashOut(
          ADDRESS_ZERO,
          receiver.address,
          TOKEN_AMOUNT,
          TRANSACTION_ID1
        )
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_ACCOUNT_ADDRESS_IS_ZERO);
    });

    it("Is reverted if the token amount is zero", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(cashierRoot, cashier).makeInternalCashOut(
          user.address,
          receiver.address,
          TOKEN_AMOUNT_ZERO,
          TRANSACTION_ID1
        )
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_AMOUNT_IS_ZERO);
    });

    it("Is reverted if the token amount is greater than 64-bit unsigned integer", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      const amount: bigint = BigInt("0x10000000000000000");
      await expect(
        connect(cashierRoot, cashier).makeInternalCashOut(
          user.address,
          receiver.address,
          amount,
          TRANSACTION_ID1
        )
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_AMOUNT_EXCESS);
    });

    it("Is reverted if the off-chain transaction ID is zero", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(cashierRoot, cashier).makeInternalCashOut(
          user.address,
          receiver.address,
          TOKEN_AMOUNT,
          TRANSACTION_ID_ZERO
        )
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_TRANSACTION_ID_IS_ZERO);
    });

    it("Is reverted if the cash-out with the provided txId is already pending", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await connect(cashierRoot, cashier).requestCashOutFrom(user.address, TOKEN_AMOUNT, TRANSACTION_ID1);
      await expect(
        connect(cashierRoot, cashier).makeInternalCashOut(
          user.address,
          receiver.address,
          TOKEN_AMOUNT,
          TRANSACTION_ID1
        )
      ).to.be.revertedWithCustomError(
        cashierRoot,
        REVERT_ERROR_IF_CASH_OUT_STATUS_INAPPROPRIATE
      );
    });

    it("Is reverted if the cash-out with the provided txId is already confirmed", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await connect(cashierRoot, cashier).requestCashOutFrom(user.address, TOKEN_AMOUNT, TRANSACTION_ID1);
      await connect(cashierRoot, cashier).confirmCashOut(TRANSACTION_ID1);
      await expect(
        connect(cashierRoot, cashier).makeInternalCashOut(
          user.address,
          receiver.address,
          TOKEN_AMOUNT,
          TRANSACTION_ID1
        )
      ).to.be.revertedWithCustomError(
        cashierRoot,
        REVERT_ERROR_IF_CASH_OUT_STATUS_INAPPROPRIATE
      );
    });

    it("Is reverted if the cash-out with the provided txId has status 'Internal'", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      const tx = connect(cashierRoot, cashier).makeInternalCashOut(
        user.address,
        receiver.address,
        TOKEN_AMOUNT,
        TRANSACTION_ID1
      );
      await proveTx(tx);
      await expect(
        connect(cashierRoot, cashier).makeInternalCashOut(
          user.address,
          receiver.address,
          TOKEN_AMOUNT,
          TRANSACTION_ID1
        )
      ).to.be.revertedWithCustomError(
        cashierRoot,
        REVERT_ERROR_IF_CASH_OUT_STATUS_INAPPROPRIATE
      );
    });

    it("Is reverted if the cash-out with the provided txId has status 'Forced'", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      const tx = connect(cashierRoot, cashier).forceCashOut(
        user.address,
        TOKEN_AMOUNT,
        TRANSACTION_ID1
      );
      await proveTx(tx);
      await expect(
        connect(cashierRoot, cashier).makeInternalCashOut(
          user.address,
          receiver.address,
          TOKEN_AMOUNT,
          TRANSACTION_ID1
        )
      ).to.be.revertedWithCustomError(
        cashierRoot,
        REVERT_ERROR_IF_CASH_OUT_STATUS_INAPPROPRIATE
      );
    });

    it("Is reverted if txId of a reversed cash-out operation is reused for another account", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await connect(cashierRoot, cashier).requestCashOutFrom(user.address, TOKEN_AMOUNT, TRANSACTION_ID1);
      await connect(cashierRoot, cashier).reverseCashOut(TRANSACTION_ID1);
      await expect(
        connect(cashierRoot, cashier).makeInternalCashOut(
          deployer.address,
          receiver.address,
          TOKEN_AMOUNT,
          TRANSACTION_ID1
        )
      ).to.be.revertedWithCustomError(
        cashierRoot,
        REVERT_ERROR_IF_CASH_OUT_ACCOUNT_INAPPROPRIATE
      );
    });

    it("Is reverted if the user has not enough tokens", async () => {
      const { cashierRoot, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      const tokenAmount = INITIAL_USER_BALANCE + 1;
      await expect(
        connect(cashierRoot, cashier).makeInternalCashOut(
          user.address,
          receiver.address,
          tokenAmount,
          TRANSACTION_ID1
        )
      ).to.be.revertedWithCustomError(
        tokenMock,
        REVERT_ERROR_IF_ERC20_TOKEN_TRANSFER_AMOUNT_EXCEEDS_BALANCE
      ).withArgs(user.address, INITIAL_USER_BALANCE, tokenAmount);
    });
  });

  describe("Function 'forceCashOut()'", async () => {
    it("Executes as expected", async () => {
      const { cashierRoot, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      const [cashOut] = defineTestCashOuts();
      await checkCashierState(tokenMock, cashierRoot, [cashOut]);
      const tx = connect(cashierRoot, cashier).forceCashOut(
        cashOut.account.address,
        cashOut.amount,
        cashOut.txId
      );
      await expect(tx).to.changeTokenBalances(
        tokenMock,
        [cashierRoot, cashier, cashOut.account],
        [0, 0, -cashOut.amount]
      );
      await expect(tx).to.emit(cashierRoot, EVENT_NAME_FORCED_CASH_OUT).withArgs(
        cashOut.account.address, // from
        cashOut.txId,
        cashOut.amount
      );
      cashOut.status = CashOutStatus.Forced;
      await checkCashierState(tokenMock, cashierRoot, [cashOut]);
    });

    it("Is reverted if the contract is paused", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await pauseContract(cashierRoot);
      await expect(
        connect(cashierRoot, cashier).forceCashOut(
          user.address,
          TOKEN_AMOUNT,
          TRANSACTION_ID1
        )
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the cashier role", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(cashierRoot, deployer).forceCashOut(
          user.address,
          TOKEN_AMOUNT,
          TRANSACTION_ID1
        )
      ).to.be.revertedWithCustomError(
        cashierRoot,
        REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT
      ).withArgs(deployer.address, cashierRole);
    });

    it("Is reverted if the token sender address is zero", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(cashierRoot, cashier).forceCashOut(
          ADDRESS_ZERO,
          TOKEN_AMOUNT,
          TRANSACTION_ID1
        )
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_ACCOUNT_ADDRESS_IS_ZERO);
    });

    it("Is reverted if the token amount is zero", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(cashierRoot, cashier).forceCashOut(
          user.address,
          TOKEN_AMOUNT_ZERO,
          TRANSACTION_ID1
        )
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_AMOUNT_IS_ZERO);
    });

    it("Is reverted if the token amount is greater than 64-bit unsigned integer", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      const amount: bigint = BigInt("0x10000000000000000");
      await expect(
        connect(cashierRoot, cashier).forceCashOut(
          user.address,
          amount,
          TRANSACTION_ID1
        )
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_AMOUNT_EXCESS);
    });

    it("Is reverted if the off-chain transaction ID is zero", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(cashierRoot, cashier).forceCashOut(
          user.address,
          TOKEN_AMOUNT,
          TRANSACTION_ID_ZERO
        )
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_TRANSACTION_ID_IS_ZERO);
    });

    it("Is reverted if the cash-out with the provided txId is already pending", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await connect(cashierRoot, cashier).requestCashOutFrom(user.address, TOKEN_AMOUNT, TRANSACTION_ID1);
      await expect(
        connect(cashierRoot, cashier).forceCashOut(
          user.address,
          TOKEN_AMOUNT,
          TRANSACTION_ID1
        )
      ).to.be.revertedWithCustomError(
        cashierRoot,
        REVERT_ERROR_IF_CASH_OUT_STATUS_INAPPROPRIATE
      );
    });

    it("Is reverted if the cash-out with the provided txId is already confirmed", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await connect(cashierRoot, cashier).requestCashOutFrom(user.address, TOKEN_AMOUNT, TRANSACTION_ID1);
      await connect(cashierRoot, cashier).confirmCashOut(TRANSACTION_ID1);
      await expect(
        connect(cashierRoot, cashier).forceCashOut(
          user.address,
          TOKEN_AMOUNT,
          TRANSACTION_ID1
        )
      ).to.be.revertedWithCustomError(
        cashierRoot,
        REVERT_ERROR_IF_CASH_OUT_STATUS_INAPPROPRIATE
      );
    });

    it("Is reverted if the cash-out with the provided txId has status 'Internal'", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      const tx = connect(cashierRoot, cashier).makeInternalCashOut(
        user.address,
        receiver.address,
        TOKEN_AMOUNT,
        TRANSACTION_ID1
      );
      await proveTx(tx);
      await expect(
        connect(cashierRoot, cashier).forceCashOut(
          user.address,
          TOKEN_AMOUNT,
          TRANSACTION_ID1
        )
      ).to.be.revertedWithCustomError(
        cashierRoot,
        REVERT_ERROR_IF_CASH_OUT_STATUS_INAPPROPRIATE
      );
    });

    it("Is reverted if the cash-out with the provided txId has status 'Forced'", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      const tx = connect(cashierRoot, cashier).forceCashOut(
        user.address,
        TOKEN_AMOUNT,
        TRANSACTION_ID1
      );
      await proveTx(tx);
      await expect(
        connect(cashierRoot, cashier).forceCashOut(
          user.address,
          TOKEN_AMOUNT,
          TRANSACTION_ID1
        )
      ).to.be.revertedWithCustomError(
        cashierRoot,
        REVERT_ERROR_IF_CASH_OUT_STATUS_INAPPROPRIATE
      );
    });

    it("Is reverted if txId of a reversed cash-out operation is reused for another account", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await connect(cashierRoot, cashier).requestCashOutFrom(user.address, TOKEN_AMOUNT, TRANSACTION_ID1);
      await connect(cashierRoot, cashier).reverseCashOut(TRANSACTION_ID1);
      await expect(
        connect(cashierRoot, cashier).forceCashOut(
          deployer.address,
          TOKEN_AMOUNT,
          TRANSACTION_ID1
        )
      ).to.be.revertedWithCustomError(
        cashierRoot,
        REVERT_ERROR_IF_CASH_OUT_ACCOUNT_INAPPROPRIATE
      );
    });

    it("Is reverted if the user has not enough tokens", async () => {
      const { cashierRoot, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      const tokenAmount = INITIAL_USER_BALANCE + 1;
      await expect(
        connect(cashierRoot, cashier).forceCashOut(
          user.address,
          tokenAmount,
          TRANSACTION_ID1
        )
      ).to.be.revertedWithCustomError(
        tokenMock,
        REVERT_ERROR_IF_ERC20_TOKEN_TRANSFER_AMOUNT_EXCEEDS_BALANCE
      ).withArgs(user.address, INITIAL_USER_BALANCE, tokenAmount);
    });
  });

  describe("Function configureCashOutHooks()", async () => {
    async function checkCashOutHookConfiguring(cashierRoot: Contract, props: {
      newCallableContract: string;
      newHookFlags: number;
      oldCallableContract?: string;
      oldHookFlags?: number;
      txId?: string;
    }) {
      const newCallableContract = props.newCallableContract;
      const newHookFlags = props.newHookFlags;
      const oldCallableContract = props.oldCallableContract ?? ADDRESS_ZERO;
      const oldHookFlags = props.oldHookFlags ?? 0;
      const txId = props.txId ?? TRANSACTION_ID1;
      const tx = await connect(cashierRoot, hookAdmin).configureCashOutHooks(
        txId,
        newCallableContract,
        newHookFlags
      );
      await expect(tx).to.emit(cashierRoot, EVENT_NAME_CASH_OUT_HOOKS_CONFIGURED).withArgs(
        txId,
        newCallableContract,
        oldCallableContract,
        newHookFlags,
        oldHookFlags
      );
      const expectedHookConfig: HookConfig = {
        callableContract: newCallableContract,
        hookFlags: newHookFlags
      };
      const actualHookConfig = await cashierRoot.getCashOutHookConfig(TRANSACTION_ID1);
      checkEquality(actualHookConfig, expectedHookConfig);

      const cashOutOperation = await cashierRoot.getCashOut(txId);
      if (newHookFlags != 0) {
        expect(cashOutOperation.flags).to.eq(1);
      } else {
        expect(cashOutOperation.flags).to.eq(0);
      }
    }

    it("Executes as expected", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);

      // Configure hooks
      await checkCashOutHookConfiguring(cashierRoot, {
        newCallableContract: user.address,
        newHookFlags: ALL_CASH_OUT_HOOK_FLAGS
      });

      // Change the hook flags only
      const hookFlags = (1 << HookIndex.CashOutRequestBefore);
      await checkCashOutHookConfiguring(cashierRoot, {
        newCallableContract: user.address,
        newHookFlags: hookFlags,
        oldCallableContract: user.address,
        oldHookFlags: ALL_CASH_OUT_HOOK_FLAGS
      });

      // Change the contract address only
      await checkCashOutHookConfiguring(cashierRoot, {
        newCallableContract: deployer.address,
        newHookFlags: hookFlags,
        oldCallableContract: user.address,
        oldHookFlags: hookFlags
      });

      // Remove hooks
      await checkCashOutHookConfiguring(cashierRoot, {
        newCallableContract: ADDRESS_ZERO,
        newHookFlags: 0,
        oldCallableContract: deployer.address,
        oldHookFlags: hookFlags
      });
    });

    it("Is reverted if the contract is paused", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await pauseContract(cashierRoot);
      await expect(
        connect(cashierRoot, hookAdmin).configureCashOutHooks(
          TRANSACTION_ID1,
          user.address, // newCallableContract
          ALL_CASH_OUT_HOOK_FLAGS // newHookFlags
        )
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the hook admin role", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(cashierRoot, deployer).configureCashOutHooks(
          TRANSACTION_ID1,
          user.address, // newCallableContract
          ALL_CASH_OUT_HOOK_FLAGS // newHookFlags
        )
      ).to.be.revertedWithCustomError(
        cashierRoot,
        REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT
      ).withArgs(deployer.address, hookAdminRole);

      await expect(
        connect(cashierRoot, cashier).configureCashOutHooks(
          TRANSACTION_ID1,
          user.address, // newCallableContract
          ALL_CASH_OUT_HOOK_FLAGS // newHookFlags
        )
      ).to.be.revertedWithCustomError(
        cashierRoot,
        REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT
      ).withArgs(cashier.address, hookAdminRole);
    });

    it("Is reverted if the off-chain transaction ID is zero", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(cashierRoot, hookAdmin).configureCashOutHooks(
          TRANSACTION_ID_ZERO,
          user.address, // newCallableContract
          ALL_CASH_OUT_HOOK_FLAGS // newHookFlags
        )
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_TRANSACTION_ID_IS_ZERO);
    });

    it("Is reverted if the provided hook flags are invalid", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);

      // Try a hook flag with the index lower than the valid range of indexes
      await expect(
        connect(cashierRoot, hookAdmin).configureCashOutHooks(
          TRANSACTION_ID1,
          user.address, // newCallableContract
          ALL_CASH_OUT_HOOK_FLAGS + (1 << HookIndex.UnusedLower) // newHookFlags
        )
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_HOOK_FLAGS_INVALID);

      // Try a hook flag with the index higher than the valid range of indexes
      await expect(
        connect(cashierRoot, hookAdmin).configureCashOutHooks(
          TRANSACTION_ID1,
          user.address, // newCallableContract
          ALL_CASH_OUT_HOOK_FLAGS + (1 << HookIndex.UnusedHigher) // newHookFlags
        )
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_HOOK_FLAGS_INVALID);
    });

    it("Is reverted if the same hooks for the same callable contract are already configured", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);

      // Try the default callable contract address and hook flags
      await expect(
        connect(cashierRoot, hookAdmin).configureCashOutHooks(
          TRANSACTION_ID1,
          ADDRESS_ZERO, // newCallableContract
          0 // newHookFlags
        )
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_HOOK_FLAGS_ALREADY_REGISTERED);

      // Try previously configured callable contract address and flags
      await proveTx(connect(cashierRoot, hookAdmin).configureCashOutHooks(
        TRANSACTION_ID1,
        user.address, // newCallableContract
        ALL_CASH_OUT_HOOK_FLAGS // newHookFlags
      ));
      await expect(
        connect(cashierRoot, hookAdmin).configureCashOutHooks(
          TRANSACTION_ID1,
          user.address, // newCallableContract
          ALL_CASH_OUT_HOOK_FLAGS // newHookFlags
        )
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_HOOK_FLAGS_ALREADY_REGISTERED);
    });

    it("Is reverted if non-zero hook flags are configured for the zero callable contract address", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);

      // Try the default callable contract address and hook flags
      await expect(
        connect(cashierRoot, hookAdmin).configureCashOutHooks(
          TRANSACTION_ID1,
          ADDRESS_ZERO, // newCallableContract
          ALL_CASH_OUT_HOOK_FLAGS // newHookFlags
        )
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_HOOK_CALLABLE_CONTRACT_ADDRESS_ZERO);
    });

    it("Is reverted if zero hook flags are configured for a not-zero callable contract address", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      await proveTx(connect(cashierRoot, hookAdmin).configureCashOutHooks(
        TRANSACTION_ID1,
        user.address, // newCallableContract
        ALL_CASH_OUT_HOOK_FLAGS // newHookFlags
      ));

      // Try the default callable contract address and hook flags
      await expect(
        connect(cashierRoot, hookAdmin).configureCashOutHooks(
          TRANSACTION_ID1,
          user.address, // newCallableContract
          0 // newHookFlags
        )
      ).to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_HOOK_CALLABLE_CONTRACT_ADDRESS_NON_ZERO);
    });
  });

  describe("Function 'getPendingCashOutTxIds()'", async () => {
    it("Returns expected values in different cases", async () => {
      const { cashierRoot } = await setUpFixture(deployAndConfigureContracts);
      const cashOuts = defineTestCashOuts(3);
      const txIds = cashOuts.map(cashOut => cashOut.txId);
      await requestCashOuts(cashierRoot, cashOuts);
      let actualTxIds: string[];

      actualTxIds = await cashierRoot.getPendingCashOutTxIds(0, 50);
      expect(actualTxIds).to.be.deep.equal(txIds);

      actualTxIds = await cashierRoot.getPendingCashOutTxIds(0, 2);
      expect(actualTxIds).to.be.deep.equal([txIds[0], txIds[1]]);

      actualTxIds = await cashierRoot.getPendingCashOutTxIds(1, 2);
      expect(actualTxIds).to.be.deep.equal([txIds[1], txIds[2]]);

      actualTxIds = await cashierRoot.getPendingCashOutTxIds(1, 1);
      expect(actualTxIds).to.be.deep.equal([txIds[1]]);

      actualTxIds = await cashierRoot.getPendingCashOutTxIds(1, 50);
      expect(actualTxIds).to.be.deep.equal([txIds[1], txIds[2]]);

      actualTxIds = await cashierRoot.getPendingCashOutTxIds(3, 50);
      expect(actualTxIds).to.be.deep.equal([]);

      actualTxIds = await cashierRoot.getPendingCashOutTxIds(1, 0);
      expect(actualTxIds).to.be.deep.equal([]);
    });
  });

  describe("Function 'getShardByTxId()'", async () => {
    it("Returns expected values for different transaction IDs", async () => {
      const { cashierRoot, cashierShards } = await setUpFixture(deployAndConfigureContracts);
      const shardCount = cashierShards.length;
      const expectedShardIndexes: number[] = TRANSACTIONS_ARRAY.map(txId => defineShardIndexByTxId(txId, shardCount));
      const expectedShardAddresses: string[] = expectedShardIndexes.map(i => getAddress(cashierShards[i]));

      for (let i = 0; i < TRANSACTIONS_ARRAY.length; ++i) {
        const txId = TRANSACTIONS_ARRAY[i];
        const expectedShardAddress = expectedShardAddresses[i];
        expect(await cashierRoot.getShardByTxId(txId)).to.eq(
          expectedShardAddress,
          `Shard address for transaction ID ${txId}`
        );
      }
    });
  });

  describe("Function 'getShardRange()'", async () => {
    it("Returns expected values in different cases", async () => {
      const { cashierRoot, cashierShards } = await setUpFixture(deployAndConfigureContracts);
      const shardAddresses = cashierShards.map(shard => getAddress(shard));
      const shardCount = cashierShards.length;
      let actualShardAddresses: string[];

      expect(cashierShards.length).greaterThanOrEqual(3);
      expect(cashierShards.length).lessThan(50);

      actualShardAddresses = await cashierRoot.getShardRange(0, 50);
      expect(actualShardAddresses).to.be.deep.equal(shardAddresses);

      actualShardAddresses = await cashierRoot.getShardRange(0, 2);
      expect(actualShardAddresses).to.be.deep.equal([shardAddresses[0], shardAddresses[1]]);

      actualShardAddresses = await cashierRoot.getShardRange(1, 2);
      expect(actualShardAddresses).to.be.deep.equal([shardAddresses[1], shardAddresses[2]]);

      actualShardAddresses = await cashierRoot.getShardRange(1, 1);
      expect(actualShardAddresses).to.be.deep.equal([shardAddresses[1]]);

      actualShardAddresses = await cashierRoot.getShardRange(1, 50);
      expect(actualShardAddresses).to.be.deep.equal(shardAddresses.slice(1));

      actualShardAddresses = await cashierRoot.getShardRange(shardCount, 50);
      expect(actualShardAddresses).to.be.deep.equal(shardAddresses.slice(shardCount));

      actualShardAddresses = await cashierRoot.getShardRange(1, 0);
      expect(actualShardAddresses).to.be.deep.equal([]);
    });
  });

  describe("Scenarios with configured hooks", async () => {
    async function checkHookEvents(fixture: Fixture, props: {
      tx: TransactionResponse;
      hookIndex: HookIndex;
      hookCallCounter: number;
      txId?: string;
    }) {
      const { cashierRoot, cashierHookMock } = fixture;
      const { tx, hookIndex, hookCallCounter } = props;
      const txId = props.txId ?? TRANSACTION_ID1;

      await expect(tx).to.emit(cashierRoot, EVENT_NAME_HOOK_INVOKED).withArgs(
        txId,
        hookIndex,
        getAddress(cashierHookMock) // callableContract
      );
      await expect(tx).to.emit(cashierHookMock, EVENT_NAME_MOCK_CASHIER_HOOK_CALLED).withArgs(
        txId,
        hookIndex,
        hookCallCounter
      );
    }

    async function checkHookTotalCalls(fixture: Fixture, expectedCallCounter: number) {
      expect(await fixture.cashierHookMock.hookCallCounter()).to.eq(expectedCallCounter);
    }

    it("All hooks are invoked for common cash-out operations", async () => {
      const fixture = await setUpFixture(deployAndConfigureContracts);
      const { cashierRoot, cashierHookMock } = fixture;
      const [cashOut] = defineTestCashOuts();
      cashOut.txId = TRANSACTION_ID1;

      await proveTx(connect(cashierRoot, hookAdmin).configureCashOutHooks(
        cashOut.txId,
        getAddress(cashierHookMock), // newCallableContract,
        ALL_CASH_OUT_HOOK_FLAGS // newHookFlags
      ));
      await checkHookTotalCalls(fixture, 0);

      const [tx1] = await requestCashOuts(cashierRoot, [cashOut]);
      await checkHookEvents(fixture, { tx: tx1, hookIndex: HookIndex.CashOutRequestBefore, hookCallCounter: 1 });
      await checkHookEvents(fixture, { tx: tx1, hookIndex: HookIndex.CashOutRequestAfter, hookCallCounter: 2 });
      await checkHookTotalCalls(fixture, 2);

      const tx2: TransactionResponse = await connect(cashierRoot, cashier).reverseCashOut(cashOut.txId);
      await checkHookEvents(fixture, { tx: tx2, hookIndex: HookIndex.CashOutReversalBefore, hookCallCounter: 3 });
      await checkHookEvents(fixture, { tx: tx2, hookIndex: HookIndex.CashOutReversalAfter, hookCallCounter: 4 });
      await checkHookTotalCalls(fixture, 4);

      const [tx3] = await requestCashOuts(cashierRoot, [cashOut]);
      await checkHookEvents(fixture, { tx: tx3, hookIndex: HookIndex.CashOutRequestBefore, hookCallCounter: 5 });
      await checkHookEvents(fixture, { tx: tx3, hookIndex: HookIndex.CashOutRequestAfter, hookCallCounter: 6 });
      await checkHookTotalCalls(fixture, 6);

      const tx4: TransactionResponse = await connect(cashierRoot, cashier).confirmCashOut(cashOut.txId);
      await checkHookEvents(fixture, { tx: tx4, hookIndex: HookIndex.CashOutConfirmationBefore, hookCallCounter: 7 });
      await checkHookEvents(fixture, { tx: tx4, hookIndex: HookIndex.CashOutConfirmationAfter, hookCallCounter: 8 });
      await checkHookTotalCalls(fixture, 8);
    });

    it("Only 'before' hooks are invoked for common cash-out operations", async () => {
      const fixture = await setUpFixture(deployAndConfigureContracts);
      const { cashierRoot, cashierHookMock } = fixture;
      const [cashOut] = defineTestCashOuts();
      cashOut.txId = TRANSACTION_ID1;
      const hookFlags =
        (1 << HookIndex.CashOutRequestBefore) +
        (1 << HookIndex.CashOutConfirmationBefore) +
        (1 << HookIndex.CashOutReversalBefore);

      await proveTx(connect(cashierRoot, hookAdmin).configureCashOutHooks(
        cashOut.txId,
        getAddress(cashierHookMock), // newCallableContract,
        hookFlags // newHookFlags
      ));
      await checkHookTotalCalls(fixture, 0);

      const [tx1] = await requestCashOuts(cashierRoot, [cashOut]);
      await checkHookEvents(fixture, { tx: tx1, hookIndex: HookIndex.CashOutRequestBefore, hookCallCounter: 1 });
      await checkHookTotalCalls(fixture, 1);

      const tx2: TransactionResponse = await connect(cashierRoot, cashier).reverseCashOut(cashOut.txId);
      await checkHookEvents(fixture, { tx: tx2, hookIndex: HookIndex.CashOutReversalBefore, hookCallCounter: 2 });
      await checkHookTotalCalls(fixture, 2);

      const [tx3] = await requestCashOuts(cashierRoot, [cashOut]);
      await checkHookEvents(fixture, { tx: tx3, hookIndex: HookIndex.CashOutRequestBefore, hookCallCounter: 3 });
      await checkHookTotalCalls(fixture, 3);

      const tx4: TransactionResponse = await connect(cashierRoot, cashier).confirmCashOut(cashOut.txId);
      await checkHookEvents(fixture, { tx: tx4, hookIndex: HookIndex.CashOutConfirmationBefore, hookCallCounter: 4 });
      await checkHookTotalCalls(fixture, 4);
    });

    it("Only 'after' hooks are invoked for common cash-out operations", async () => {
      const fixture = await setUpFixture(deployAndConfigureContracts);
      const { cashierRoot, cashierHookMock } = fixture;
      const [cashOut] = defineTestCashOuts();
      cashOut.txId = TRANSACTION_ID1;
      const hookFlags =
        (1 << HookIndex.CashOutRequestAfter) +
        (1 << HookIndex.CashOutConfirmationAfter) +
        (1 << HookIndex.CashOutReversalAfter);

      await proveTx(connect(cashierRoot, hookAdmin).configureCashOutHooks(
        cashOut.txId,
        getAddress(cashierHookMock), // newCallableContract,
        hookFlags // newHookFlags
      ));
      expect(await cashierHookMock.hookCallCounter()).to.eq(0);

      const [tx1] = await requestCashOuts(cashierRoot, [cashOut]);
      await checkHookEvents(fixture, { tx: tx1, hookIndex: HookIndex.CashOutRequestAfter, hookCallCounter: 1 });
      await checkHookTotalCalls(fixture, 1);

      const tx2: TransactionResponse = await connect(cashierRoot, cashier).reverseCashOut(cashOut.txId);
      await checkHookEvents(fixture, { tx: tx2, hookIndex: HookIndex.CashOutReversalAfter, hookCallCounter: 2 });
      await checkHookTotalCalls(fixture, 2);

      const [tx3] = await requestCashOuts(cashierRoot, [cashOut]);
      await checkHookEvents(fixture, { tx: tx3, hookIndex: HookIndex.CashOutRequestAfter, hookCallCounter: 3 });
      await checkHookTotalCalls(fixture, 3);

      const tx4: TransactionResponse = await connect(cashierRoot, cashier).confirmCashOut(cashOut.txId);
      await checkHookEvents(fixture, { tx: tx4, hookIndex: HookIndex.CashOutConfirmationAfter, hookCallCounter: 4 });
      await checkHookTotalCalls(fixture, 4);
    });

    it("All hooks are invoked for an internal cash-out operation", async () => {
      const fixture = await setUpFixture(deployAndConfigureContracts);
      const { cashierRoot, cashierHookMock } = fixture;
      const [cashOut] = defineTestCashOuts();
      cashOut.txId = TRANSACTION_ID1;

      await proveTx(connect(cashierRoot, hookAdmin).configureCashOutHooks(
        cashOut.txId,
        getAddress(cashierHookMock), // newCallableContract,
        ALL_CASH_OUT_HOOK_FLAGS // newHookFlags
      ));
      expect(await cashierHookMock.hookCallCounter()).to.eq(0);

      const [tx] = await makeInternalCashOuts(cashierRoot, [cashOut]);
      await checkHookEvents(fixture, { tx, hookIndex: HookIndex.CashOutRequestBefore, hookCallCounter: 1 });
      await checkHookEvents(fixture, { tx, hookIndex: HookIndex.CashOutConfirmationBefore, hookCallCounter: 2 });
      await checkHookEvents(fixture, { tx, hookIndex: HookIndex.CashOutConfirmationAfter, hookCallCounter: 3 });
      await checkHookTotalCalls(fixture, 3);
    });

    it("Only 'before' hooks are invoked for an internal cash-out operation", async () => {
      const fixture = await setUpFixture(deployAndConfigureContracts);
      const { cashierRoot, cashierHookMock } = fixture;
      const [cashOut] = defineTestCashOuts();
      cashOut.txId = TRANSACTION_ID1;
      const hookFlags =
        (1 << HookIndex.CashOutRequestBefore) +
        (1 << HookIndex.CashOutConfirmationBefore);

      await proveTx(connect(cashierRoot, hookAdmin).configureCashOutHooks(
        cashOut.txId,
        getAddress(cashierHookMock), // newCallableContract,
        hookFlags // newHookFlags
      ));
      expect(await cashierHookMock.hookCallCounter()).to.eq(0);

      const [tx] = await makeInternalCashOuts(cashierRoot, [cashOut]);
      await checkHookEvents(fixture, { tx, hookIndex: HookIndex.CashOutRequestBefore, hookCallCounter: 1 });
      await checkHookEvents(fixture, { tx, hookIndex: HookIndex.CashOutConfirmationBefore, hookCallCounter: 2 });
      await checkHookTotalCalls(fixture, 2);
    });

    it("Only 'after' hooks are invoked for an internal cash-out operation", async () => {
      const fixture = await setUpFixture(deployAndConfigureContracts);
      const { cashierRoot, cashierHookMock } = fixture;
      const [cashOut] = defineTestCashOuts();
      cashOut.txId = TRANSACTION_ID1;
      const hookFlags =
        (1 << HookIndex.CashOutRequestAfter) + // Is not called for internal cash-outs but still configured
        (1 << HookIndex.CashOutConfirmationAfter);

      await proveTx(connect(cashierRoot, hookAdmin).configureCashOutHooks(
        cashOut.txId,
        getAddress(cashierHookMock), // newCallableContract,
        hookFlags // newHookFlags
      ));
      expect(await cashierHookMock.hookCallCounter()).to.eq(0);

      const [tx] = await makeInternalCashOuts(cashierRoot, [cashOut]);
      await checkHookEvents(fixture, { tx, hookIndex: HookIndex.CashOutConfirmationAfter, hookCallCounter: 1 });
      await checkHookTotalCalls(fixture, 1);
    });

    it("All hooks are invoked for a forced cash-out operation", async () => {
      const fixture = await setUpFixture(deployAndConfigureContracts);
      const { cashierRoot, cashierHookMock } = fixture;
      const [cashOut] = defineTestCashOuts();
      cashOut.txId = TRANSACTION_ID1;

      await proveTx(connect(cashierRoot, hookAdmin).configureCashOutHooks(
        cashOut.txId,
        getAddress(cashierHookMock), // newCallableContract,
        ALL_CASH_OUT_HOOK_FLAGS // newHookFlags
      ));
      expect(await cashierHookMock.hookCallCounter()).to.eq(0);

      const [tx] = await forceCashOuts(cashierRoot, [cashOut]);
      await checkHookEvents(fixture, { tx, hookIndex: HookIndex.CashOutRequestBefore, hookCallCounter: 1 });
      await checkHookEvents(fixture, { tx, hookIndex: HookIndex.CashOutRequestAfter, hookCallCounter: 2 });
      await checkHookEvents(fixture, { tx, hookIndex: HookIndex.CashOutConfirmationBefore, hookCallCounter: 3 });
      await checkHookEvents(fixture, { tx, hookIndex: HookIndex.CashOutConfirmationAfter, hookCallCounter: 4 });
      await checkHookTotalCalls(fixture, 4);
    });

    it("Only 'before' hooks are invoked for a forced cash-out operation", async () => {
      const fixture = await setUpFixture(deployAndConfigureContracts);
      const { cashierRoot, cashierHookMock } = fixture;
      const [cashOut] = defineTestCashOuts();
      cashOut.txId = TRANSACTION_ID1;
      const hookFlags =
        (1 << HookIndex.CashOutRequestBefore) +
        (1 << HookIndex.CashOutConfirmationBefore);

      await proveTx(connect(cashierRoot, hookAdmin).configureCashOutHooks(
        cashOut.txId,
        getAddress(cashierHookMock), // newCallableContract,
        hookFlags // newHookFlags
      ));
      expect(await cashierHookMock.hookCallCounter()).to.eq(0);

      const [tx] = await forceCashOuts(cashierRoot, [cashOut]);
      await checkHookEvents(fixture, { tx, hookIndex: HookIndex.CashOutRequestBefore, hookCallCounter: 1 });
      await checkHookEvents(fixture, { tx, hookIndex: HookIndex.CashOutConfirmationBefore, hookCallCounter: 2 });
      await checkHookTotalCalls(fixture, 2);
    });

    it("Only 'after' hooks are invoked for a forced cash-out operation", async () => {
      const fixture = await setUpFixture(deployAndConfigureContracts);
      const { cashierRoot, cashierHookMock } = fixture;
      const [cashOut] = defineTestCashOuts();
      cashOut.txId = TRANSACTION_ID1;
      const hookFlags =
        (1 << HookIndex.CashOutRequestAfter) + // Is not called for internal cash-outs but still configured
        (1 << HookIndex.CashOutConfirmationAfter);

      await proveTx(connect(cashierRoot, hookAdmin).configureCashOutHooks(
        cashOut.txId,
        getAddress(cashierHookMock), // newCallableContract,
        hookFlags // newHookFlags
      ));
      expect(await cashierHookMock.hookCallCounter()).to.eq(0);

      const [tx] = await forceCashOuts(cashierRoot, [cashOut]);
      await checkHookEvents(fixture, { tx, hookIndex: HookIndex.CashOutRequestAfter, hookCallCounter: 1 });
      await checkHookEvents(fixture, { tx, hookIndex: HookIndex.CashOutConfirmationAfter, hookCallCounter: 2 });
      await checkHookTotalCalls(fixture, 2);
    });
  });

  describe("Complex scenarios without hooks", async () => {
    it("Scenario 1 with cash-out reversing executes successfully", async () => {
      const { cashierRoot, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      const [cashOut] = defineTestCashOuts();
      await requestCashOuts(cashierRoot, [cashOut]);
      await proveTx(connect(cashierRoot, cashier).reverseCashOut(cashOut.txId));
      cashOut.status = CashOutStatus.Reversed;
      await checkCashierState(tokenMock, cashierRoot, [cashOut]);

      // After reversing a cash-out with the same txId can't be reversed again.
      await expect(connect(cashierRoot, cashier).reverseCashOut(cashOut.txId))
        .to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_CASH_OUT_STATUS_INAPPROPRIATE);

      // After reversing a cash-out with the same txId can't be confirmed.
      await expect(connect(cashierRoot, cashier).confirmCashOut(cashOut.txId))
        .to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_CASH_OUT_STATUS_INAPPROPRIATE);

      expect(await tokenMock.balanceOf(cashOut.account.address)).to.equal(INITIAL_USER_BALANCE);

      // After reversing a cash-out with the same txId can be requested again.
      await requestCashOuts(cashierRoot, [cashOut]);
      await checkCashierState(tokenMock, cashierRoot, [cashOut]);
      expect(await tokenMock.balanceOf(cashOut.account.address)).to.equal(INITIAL_USER_BALANCE - cashOut.amount);
    });

    it("Scenario 2 with cash-out confirming executes successfully", async () => {
      const { cashierRoot, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      const [cashOut] = defineTestCashOuts();
      await requestCashOuts(cashierRoot, [cashOut]);
      await proveTx(connect(cashierRoot, cashier).confirmCashOut(cashOut.txId));
      cashOut.status = CashOutStatus.Confirmed;
      await checkCashierState(tokenMock, cashierRoot, [cashOut]);

      // After confirming a cash-out with the same txId can't be reversed again.
      await expect(connect(cashierRoot, cashier).reverseCashOut(cashOut.txId))
        .to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_CASH_OUT_STATUS_INAPPROPRIATE);

      // After confirming a cash-out with the same txId can't be confirmed.
      await expect(connect(cashierRoot, cashier).confirmCashOut(cashOut.txId))
        .to.be.revertedWithCustomError(cashierRoot, REVERT_ERROR_IF_CASH_OUT_STATUS_INAPPROPRIATE);

      expect(await tokenMock.balanceOf(cashOut.account.address)).to.equal(INITIAL_USER_BALANCE - cashOut.amount);
    });

    it("Scenario 3 with internal cash-out after reversing the previous one with the same ID", async () => {
      const { cashierRoot, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      const [cashOut] = defineTestCashOuts();
      await requestCashOuts(cashierRoot, [cashOut]);
      await proveTx(connect(cashierRoot, cashier).reverseCashOut(cashOut.txId));
      cashOut.status = CashOutStatus.Reversed;
      await checkCashierState(tokenMock, cashierRoot, [cashOut]);

      // After reversing a cash-out with the same txId can be requested again for an internal cash-out.
      await proveTx(connect(cashierRoot, cashier).makeInternalCashOut(
        cashOut.account.address,
        receiver.address,
        cashOut.amount,
        cashOut.txId
      ));
      cashOut.status = CashOutStatus.Internal;
      await checkCashierState(tokenMock, cashierRoot, [cashOut]);
      expect(await tokenMock.balanceOf(cashOut.account.address)).to.equal(INITIAL_USER_BALANCE - cashOut.amount);
    });

    it("Scenario 4 with forced cash-out after reversing the previous one with the same ID", async () => {
      const { cashierRoot, tokenMock } = await setUpFixture(deployAndConfigureContracts);
      const [cashOut] = defineTestCashOuts();
      await requestCashOuts(cashierRoot, [cashOut]);
      await proveTx(connect(cashierRoot, cashier).reverseCashOut(cashOut.txId));
      cashOut.status = CashOutStatus.Reversed;
      await checkCashierState(tokenMock, cashierRoot, [cashOut]);

      // After reversing a cash-out with the same txId can be requested again for an internal cash-out.
      await proveTx(connect(cashierRoot, cashier).forceCashOut(
        cashOut.account.address,
        cashOut.amount,
        cashOut.txId
      ));
      cashOut.status = CashOutStatus.Forced;
      await checkCashierState(tokenMock, cashierRoot, [cashOut]);
      expect(await tokenMock.balanceOf(cashOut.account.address)).to.equal(INITIAL_USER_BALANCE - cashOut.amount);
    });
  });

  describe("Scenarios for distributing data among shards", async () => {
    async function prepareTest(): Promise<{
      fixture: Fixture;
      txIds: string[];
      shardMatchIndexes: number[];
      txIdsByShardIndex: string[][];
    }> {
      const fixture = await setUpFixture(deployAndConfigureContracts);
      const shardCount = fixture.cashierShards.length;
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
      const { cashierRoot, cashierShards } = fixture;
      const cashIns: TestCashIn[] = txIds.map((txId, i) => ({
        account: user,
        amount: i + 1,
        txId,
        status: CashInStatus.Executed
      }));
      for (const cashIn of cashIns) {
        await proveTx(connect(cashierRoot, cashier).cashIn(
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
        const actualCashIn = await cashierShards[shardIndex].getCashIn(txId);
        checkCashInEquality(actualCashIn, expectedCashIn, i);
      }

      // Get and check structures by shards
      for (let i = 0; i < txIdsByShardIndex.length; ++i) {
        const txIds = txIdsByShardIndex[i];
        const expectedCashIns: TestCashIn[] = cashIns.filter(cashIn => txIds.includes(cashIn.txId));
        const actualCashIns = await cashierShards[i].getCashIns(txIds);
        for (let j = 0; j < txIds.length; ++j) {
          checkCashInEquality(actualCashIns[j], expectedCashIns[j], j);
        }
      }
    });

    it("Cash-out data distribution executes as expected", async () => {
      const { fixture, txIds, shardMatchIndexes, txIdsByShardIndex } = await prepareTest();
      const { cashierRoot, cashierShards } = fixture;
      const cashOuts: TestCashOut[] = txIds.map((txId, i) => ({
        account: user,
        amount: i + 1,
        txId,
        status: CashOutStatus.Pending
      }));
      await requestCashOuts(cashierRoot, cashOuts);

      // Get and check structures one by one
      for (let i = 0; i < txIds.length; ++i) {
        const txId = txIds[i];
        const shardIndex = shardMatchIndexes[i];
        const expectedCashOut = cashOuts[i];
        const actualCashOut = await cashierShards[shardIndex].getCashOut(txId);
        checkCashOutEquality(actualCashOut, expectedCashOut, i);
      }

      // Get and check structures by shards
      for (let i = 0; i < txIdsByShardIndex.length; ++i) {
        const txIds = txIdsByShardIndex[i];
        const expectedCashOuts: TestCashOut[] = cashOuts.filter(cashOut => txIds.includes(cashOut.txId));
        const actualCashOuts = await cashierShards[i].getCashOuts(txIds);
        for (let j = 0; j < txIds.length; ++j) {
          checkCashOutEquality(actualCashOuts[j], expectedCashOuts[j], j);
        }
      }
    });
  });

  describe("Special scenarios for shard functions", async () => {
    it("The 'setAdmin()' function is reverted if it is called not by the owner or admin", async () => {
      const { cashierShards } = await setUpFixture(deployAndConfigureContracts);
      await expect(connect(cashierShards[0], deployer).setAdmin(
        user.address, // account
        true // status
      )).to.be.revertedWithCustomError(cashierShards[0], REVERT_ERROR_IF_UNAUTHORIZED);
    });

    it("The 'registerCashIn()' function is reverted if it is called not by the owner or admin", async () => {
      const { cashierShards } = await setUpFixture(deployAndConfigureContracts);
      await expect(connect(cashierShards[0], deployer).registerCashIn(
        user.address, // account
        1, // amount
        TRANSACTION_ID1,
        CashInStatus.Executed
      )).to.be.revertedWithCustomError(cashierShards[0], REVERT_ERROR_IF_UNAUTHORIZED);
    });

    it("The 'revokeCashIn()' function is reverted if it is called not by the owner or admin", async () => {
      const { cashierShards } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(cashierShards[0], deployer).revokeCashIn(TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(cashierShards[0], REVERT_ERROR_IF_UNAUTHORIZED);
    });

    it("The 'registerCashOut()' function is reverted if it is called not by the owner or admin", async () => {
      const { cashierShards } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(cashierShards[0], deployer).registerCashOut(
          user.address, // account
          1, // amount
          TRANSACTION_ID1
        )
      ).to.be.revertedWithCustomError(cashierShards[0], REVERT_ERROR_IF_UNAUTHORIZED);
    });

    it("The 'registerInternalCashOut()' function is reverted if it is called not by the owner or admin", async () => {
      const { cashierShards } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(cashierShards[0], deployer).registerInternalCashOut(
          user.address, // account
          1, // amount
          TRANSACTION_ID1
        )
      ).to.be.revertedWithCustomError(cashierShards[0], REVERT_ERROR_IF_UNAUTHORIZED);
    });

    it("The 'registerForcedCashOut()' function is reverted if it is called not by the owner or admin", async () => {
      const { cashierShards } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(cashierShards[0], deployer).registerForcedCashOut(
          user.address, // account
          1, // amount
          TRANSACTION_ID1
        )
      ).to.be.revertedWithCustomError(cashierShards[0], REVERT_ERROR_IF_UNAUTHORIZED);
    });

    it("The 'processCashOut()' function is reverted if it is called not by the owner or admin", async () => {
      const { cashierShards } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(cashierShards[0], deployer).processCashOut(
          TRANSACTION_ID1,
          CashOutStatus.Confirmed
        )
      ).to.be.revertedWithCustomError(cashierShards[0], REVERT_ERROR_IF_UNAUTHORIZED);
    });

    it("The 'setBitInCashOutFlags()' function is reverted if it is called not by the owner or admin", async () => {
      const { cashierShards } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(cashierShards[0], deployer).setBitInCashOutFlags(
          TRANSACTION_ID1,
          0 // flags
        )
      ).to.be.revertedWithCustomError(cashierShards[0], REVERT_ERROR_IF_UNAUTHORIZED);
    });

    it("The 'resetBitInCashOutFlags()' function is reverted if it is called not by the owner or admin", async () => {
      const { cashierShards } = await setUpFixture(deployAndConfigureContracts);
      await expect(
        connect(cashierShards[0], deployer).resetBitInCashOutFlags(
          TRANSACTION_ID1,
          0 // flags
        )
      ).to.be.revertedWithCustomError(cashierShards[0], REVERT_ERROR_IF_UNAUTHORIZED);
    });

    it("The root treats an unexpected error of the shard function properly", async () => {
      const { cashierRoot, cashierShards } = await setUpFixture(deployAndConfigureContracts);
      const [operation] = defineTestCashIns();
      const mockCashierShard = await cashierShardMockFactory.deploy() as Contract;
      await mockCashierShard.waitForDeployment();
      const unexpectedError = await mockCashierShard.REGISTER_OPERATION_UNEXPECTED_ERROR();
      const mockCashierShardAddresses = Array(cashierShards.length).fill(getAddress(mockCashierShard));
      await proveTx(cashierRoot.replaceShards(0, mockCashierShardAddresses));
      const cashierUnderCashier = connect(cashierRoot, cashier);

      await expect(cashierUnderCashier.cashIn(
        operation.account,
        operation.amount,
        operation.txId
      )).to.be.revertedWithCustomError(
        cashierRoot,
        REVERT_ERROR_IF_SHARD_ERROR_UNEXPECTED
      ).withArgs(
        unexpectedError
      );
    });


  });
});
