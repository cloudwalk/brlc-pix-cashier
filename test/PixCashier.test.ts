import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { TransactionResponse } from "@ethersproject/abstract-provider";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { proveTx } from "../test-utils/eth";
import { countNumberArrayTotal } from "../test-utils/misc";

enum CashInStatus {
  Nonexistent = 0,
  Executed = 1,
  PremintExecuted = 2
}

enum CashInBatchStatus {
  Nonexistent = 0,
  Executed = 1
}

enum CashInExecutionStatus {
  Success = 0,
  AlreadyExecuted = 1
}

enum CashOutStatus {
  Nonexistent = 0,
  Pending = 1,
  Reversed = 2,
  Confirmed = 3
}

enum PremintRestriction {
  None = 0,
  Create = 1,
  Update = 2
}

interface TestCashIn {
  account: HardhatEthersSigner;
  amount: number;
  oldAmount: number;
  txId: string;
  status: CashInStatus;
  releaseTimestamp?: number;
}

interface TestCashInBatch {
  batchId: string;
  status: CashInBatchStatus;
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
  processedCashOutCounter: number;
  pendingCashOutTxIds: string[];
  cashOutBalancePerAccount: Map<string, number>;
}

function checkCashOutEquality(
  actualOnChainCashOut: Record<string, unknown>,
  expectedCashOut: TestCashOut,
  cashOutIndex: number
) {
  if (expectedCashOut.status == CashOutStatus.Nonexistent) {
    expect(actualOnChainCashOut.account).to.equal(
      ethers.ZeroAddress,
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
      ethers.ZeroAddress,
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

describe("Contract 'PixCashier'", async () => {
  const TRANSACTION_ID1 = ethers.encodeBytes32String("MOCK_TRANSACTION_ID1");
  const TRANSACTION_ID2 = ethers.encodeBytes32String("MOCK_TRANSACTION_ID2");
  const TRANSACTION_ID3 = ethers.encodeBytes32String("MOCK_TRANSACTION_ID3");
  const TX_ID_ARRAY: string[] = [TRANSACTION_ID1, TRANSACTION_ID2, TRANSACTION_ID3];
  const TOKEN_AMOUNTS: number[] = [100, 200, 300];
  const BATCH_ID1 = ethers.encodeBytes32String("MOCK_BATCH_ID1");
  const BATCH_ID2 = ethers.encodeBytes32String("MOCK_BATCH_ID2");
  const BATCH_ID_ZERO = ethers.ZeroHash;

  const REVERT_ERROR_IF_CONTRACT_INITIALIZATION_IS_INVALID = "InvalidInitialization";
  const REVERT_ERROR_IF_CONTRACT_IS_PAUSED = "EnforcedPause";
  const REVERT_ERROR_IF_ERC20_TOKEN_TRANSFER_AMOUNT_EXCEEDS_BALANCE = "ERC20InsufficientBalance";
  const REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT = "AccessControlUnauthorizedAccount";

  const REVERT_ERROR_IF_TOKEN_ADDRESS_IZ_ZERO = "ZeroTokenAddress";
  const REVERT_ERROR_IF_ACCOUNT_IS_BLOCKLISTED = "BlocklistedAccount";
  const REVERT_ERROR_IF_ACCOUNT_IS_ZERO = "ZeroAccount";
  const REVERT_ERROR_IF_AMOUNT_IS_ZERO = "ZeroAmount";
  const REVERT_ERROR_IF_AMOUNT_EXCESS = "AmountExcess";
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

  let PixCashier: ContractFactory;
  let TokenMock: ContractFactory;
  let tokenMockAddress: string;
  let pixCashier: Contract;
  let pixCashierAddress: string;
  let tokenMock: Contract;
  let deployer: HardhatEthersSigner;
  let cashier: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let secondUser: HardhatEthersSigner;
  let thirdUser: HardhatEthersSigner;
  let ownerRole: string;
  let blocklisterRole: string;
  let pauserRole: string;
  let rescuerRole: string;
  let cashierRole: string;

  beforeEach(async () => {
    // Deploy the token mock contract
    TokenMock = await ethers.getContractFactory("ERC20TokenMock");
    tokenMock = await upgrades.deployProxy(TokenMock, ["ERC20 Test", "TEST"]);
    await tokenMock.waitForDeployment();
    tokenMockAddress = await tokenMock.getAddress();

    // Deploy the being tested contract
    PixCashier = await ethers.getContractFactory("PixCashier");
    pixCashier = await upgrades.deployProxy(PixCashier, [tokenMockAddress]);
    await pixCashier.waitForDeployment();
    pixCashierAddress = await pixCashier.getAddress();

    // Accounts
    [deployer, cashier, user, secondUser, thirdUser] = await ethers.getSigners();

    // Roles
    ownerRole = (await pixCashier.OWNER_ROLE()).toLowerCase();
    blocklisterRole = (await pixCashier.BLOCKLISTER_ROLE()).toLowerCase();
    pauserRole = (await pixCashier.PAUSER_ROLE()).toLowerCase();
    rescuerRole = (await pixCashier.RESCUER_ROLE()).toLowerCase();
    cashierRole = (await pixCashier.CASHIER_ROLE()).toLowerCase();
  });

  async function setUpContractsForCashOuts(cashOuts: TestCashOut[]) {
    for (const cashOut of cashOuts) {
      await proveTx(tokenMock.mint(cashOut.account.address, cashOut.amount));
      const allowance: bigint = await tokenMock.allowance(cashOut.account.address, pixCashierAddress);
      if (allowance < ethers.MaxUint256) {
        await proveTx((tokenMock.connect(cashOut.account) as Contract).approve(pixCashierAddress, ethers.MaxUint256));
      }
    }
  }

  async function requestCashOuts(cashOuts: TestCashOut[]) {
    for (const cashOut of cashOuts) {
      await proveTx(
        (pixCashier.connect(cashier) as Contract).requestCashOutFrom(
          cashOut.account.address,
          cashOut.amount,
          cashOut.txId
        )
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

  async function checkCashInStructuresOnBlockchain(cashIns: TestCashIn[]) {
    const txIds: string[] = cashIns.map(cashIn => cashIn.txId);
    const actualCashIns: Record<string, unknown>[] = await pixCashier.getCashIns(txIds);
    for (let i = 0; i < cashIns.length; ++i) {
      const cashIn: TestCashIn = cashIns[i];
      const actualCashIn: Record<string, unknown> = await pixCashier.getCashIn(cashIn.txId);
      checkCashInEquality(actualCashIn, cashIn, i);
      checkCashInEquality(actualCashIns[i], cashIn, i);
    }
  }

  async function checkCashInBatchStructuresOnBlockchain(cashInBatches: TestCashInBatch[]) {
    const batchIds: string[] = cashInBatches.map(cashInBatch => cashInBatch.batchId);
    const actualCashInBatches: Record<string, unknown>[] = await pixCashier.getCashInBatches(batchIds);
    for (let i = 0; i < cashInBatches.length; ++i) {
      const cashInBatch: TestCashInBatch = cashInBatches[i];
      const actualCashInBatch: Record<string, unknown> = await pixCashier.getCashInBatch(cashInBatch.batchId);
      checkCashInBatchEquality(actualCashInBatch, cashInBatch, i);
      checkCashInBatchEquality(actualCashInBatches[i], cashInBatch, i);
    }
  }

  async function checkCashOutStructuresOnBlockchain(cashOuts: TestCashOut[]) {
    const txIds: string[] = cashOuts.map(cashOut => cashOut.txId);
    const actualCashOuts: Record<string, unknown>[] = await pixCashier.getCashOuts(txIds);
    for (let i = 0; i < cashOuts.length; ++i) {
      const cashOut: TestCashOut = cashOuts[i];
      const actualCashOut: Record<string, unknown> = await pixCashier.getCashOut(cashOut.txId);
      checkCashOutEquality(actualCashOut, cashOut, i);
      checkCashOutEquality(actualCashOuts[i], cashOut, i);
    }
  }

  async function checkPixCashierState(cashOuts: TestCashOut[]) {
    const expectedState: PixCashierState = defineExpectedPixCashierState(cashOuts);
    await checkCashOutStructuresOnBlockchain(cashOuts);

    expect(await tokenMock.balanceOf(pixCashierAddress)).to.equal(
      expectedState.tokenBalance,
      `The PIX cashier total balance is wrong`
    );

    const actualPendingCashOutCounter = await pixCashier.pendingCashOutCounter();
    expect(actualPendingCashOutCounter).to.equal(
      expectedState.pendingCashOutCounter,
      `The pending cash-out counter is wrong`
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

  it("The initial contract configuration should be as expected", async () => {
    // The underlying contract address
    expect(await pixCashier.underlyingToken()).to.equal(tokenMockAddress);

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
    expect(await pixCashier.getPendingCashOutTxIds(0, 1)).to.be.empty;
  });

  it("The initialize function can't be called more than once", async () => {
    await expect(
      pixCashier.initialize(tokenMockAddress)
    ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_CONTRACT_INITIALIZATION_IS_INVALID);
  });

  it("The initialize function is reverted if the passed token address is zero", async () => {
    const anotherPixCashier = await PixCashier.deploy() as Contract;
    await anotherPixCashier.waitForDeployment();
    await expect(
      anotherPixCashier.initialize(ethers.ZeroAddress)
    ).to.be.revertedWithCustomError(PixCashier, REVERT_ERROR_IF_TOKEN_ADDRESS_IZ_ZERO);
  });

  describe("Upgrading", async () => {
    it("Executes as expected if it is called by an owner", async () => {
      await upgrades.upgradeProxy(
        pixCashier,
        PixCashier.connect(deployer),
        { redeployImplementation: "always" }
      );

      // Use the 'upgradeTo()' function only to provide 100 % test coverage
      const newImplementation = await PixCashier.deploy();
      await newImplementation.waitForDeployment();
      const newImplementationAddress = await newImplementation.getAddress();
      await proveTx(pixCashier.upgradeTo(newImplementationAddress));
    });

    it("Is reverted if the caller does not have the owner role", async () => {
      await expect(
        upgrades.upgradeProxy(
          pixCashier,
          PixCashier.connect(user),
          { redeployImplementation: "always" }
        )
      ).to.be.revertedWithCustomError(
        pixCashier,
        REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT
      ).withArgs(user.address, ownerRole);
    });
  });

  describe("Function 'cashIn()'", async () => {
    const tokenAmount: number = 100;

    beforeEach(async () => {
      await proveTx(pixCashier.grantRole(cashierRole, cashier.address));
    });

    it("Executes as expected", async () => {
      const expectedCashIn: TestCashIn = {
        status: CashInStatus.Nonexistent,
        account: user,
        amount: tokenAmount,
        oldAmount: 0,
        txId: TRANSACTION_ID1
      };
      const tx = (pixCashier.connect(cashier) as Contract).cashIn(
        expectedCashIn.account.address,
        expectedCashIn.amount,
        expectedCashIn.txId
      );

      await expect(tx).to.changeTokenBalances(
        tokenMock,
        [user, pixCashier],
        [+expectedCashIn.amount, 0]
      );
      await expect(tx)
        .to.emit(pixCashier, "CashIn")
        .withArgs(expectedCashIn.account.address, expectedCashIn.amount, expectedCashIn.txId);

      expectedCashIn.status = CashInStatus.Executed;
      await checkCashInStructuresOnBlockchain([expectedCashIn]);
    });

    it("Is reverted if the contract is paused", async () => {
      await proveTx(pixCashier.grantRole(pauserRole, deployer.address));
      await proveTx(pixCashier.pause());
      await expect(
        (pixCashier.connect(cashier) as Contract).cashIn(user.address, tokenAmount, TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the cashier role", async () => {
      await expect(
        (pixCashier.connect(deployer) as Contract).cashIn(user.address, tokenAmount, TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(
        pixCashier,
        REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT
      ).withArgs(deployer.address, cashierRole);
    });

    it("Is reverted if the account address is zero", async () => {
      await expect(
        (pixCashier.connect(cashier) as Contract).cashIn(ethers.ZeroAddress, tokenAmount, TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_ACCOUNT_IS_ZERO);
    });

    it("Is reverted if the token amount is zero", async () => {
      await expect(
        (pixCashier.connect(cashier) as Contract).cashIn(user.address, 0, TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_AMOUNT_IS_ZERO);
    });

    it("Is reverted if the off-chain transaction ID is zero", async () => {
      await expect(
        (pixCashier.connect(cashier) as Contract).cashIn(user.address, tokenAmount, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_TRANSACTION_ID_IS_ZERO);
    });

    it("Is reverted if the token amount is greater than 64-bit unsigned integer", async () => {
      const amount = BigInt("0x10000000000000000");
      await expect(
        (pixCashier.connect(cashier) as Contract).cashIn(user.address, amount, TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_AMOUNT_EXCESS);
    });

    it("Is reverted if the cash-in with the provided txId is already executed", async () => {
      const txId = TRANSACTION_ID1;
      await proveTx((pixCashier.connect(cashier) as Contract).cashIn(user.address, tokenAmount, txId));
      expect((pixCashier.connect(cashier) as Contract).cashIn(deployer.address, tokenAmount + 1, txId))
        .to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_CASH_IN_ALREADY_EXECUTED)
        .withArgs(txId);
    });

    it("Is reverted if the account is blocklisted", async () => {
      await proveTx(pixCashier.grantRole(blocklisterRole, deployer.address));
      await proveTx(pixCashier.blocklist(user.address));
      await expect(
        (pixCashier.connect(cashier) as Contract).cashIn(user.address, tokenAmount, TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_ACCOUNT_IS_BLOCKLISTED);
    });

    it("Is reverted if minting function returns 'false'", async () => {
      await proveTx(tokenMock.setMintResult(false));
      await expect(
        (pixCashier.connect(cashier) as Contract).cashIn(user.address, tokenAmount, TRANSACTION_ID1)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_TOKEN_MINTING_FAILURE);
    });
  });

  describe("Function 'cashInPremint()'", async () => {
    const tokenAmount: number = 100;
    const releaseTimestamp: number = 123456;

    beforeEach(async () => {
      await proveTx(pixCashier.grantRole(cashierRole, cashier.address));
    });

    it("Executes as expected", async () => {
      const expectedCashIn: TestCashIn = {
        status: CashInStatus.Nonexistent,
        account: user,
        amount: tokenAmount,
        oldAmount: 0,
        txId: TRANSACTION_ID1,
        releaseTimestamp
      };
      const tx = (pixCashier.connect(cashier) as Contract).cashInPremint(
        expectedCashIn.account.address,
        expectedCashIn.amount,
        expectedCashIn.txId,
        expectedCashIn.releaseTimestamp
      );
      await expect(tx)
        .to.emit(pixCashier, "CashInPremint")
        .withArgs(
          expectedCashIn.account.address,
          expectedCashIn.amount,
          0,
          expectedCashIn.txId,
          expectedCashIn.releaseTimestamp
        );
      expectedCashIn.status = CashInStatus.PremintExecuted;

      await expect(tx)
        .to.emit(tokenMock, "MockPremint")
        .withArgs(
          expectedCashIn.account.address,
          expectedCashIn.amount,
          expectedCashIn.releaseTimestamp,
          PremintRestriction.Update
        );

      await checkCashInStructuresOnBlockchain([expectedCashIn]);
    });

    it("Is reverted if the contract is paused", async () => {
      await proveTx(pixCashier.grantRole(pauserRole, deployer.address));
      await proveTx(pixCashier.pause());
      await expect(
        (pixCashier.connect(cashier) as Contract).cashInPremint(
          user.address,
          tokenAmount,
          TRANSACTION_ID1,
          releaseTimestamp
        )
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the cashier role", async () => {
      await expect(
        (pixCashier.connect(deployer) as Contract).cashInPremint(
          user.address,
          tokenAmount,
          TRANSACTION_ID1,
          releaseTimestamp
        )
      ).to.be.revertedWithCustomError(
        pixCashier,
        REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT
      ).withArgs(deployer.address, cashierRole);
    });

    it("Is reverted if the account address is zero", async () => {
      await expect(
        (pixCashier.connect(cashier) as Contract).cashInPremint(
          ethers.ZeroAddress,
          tokenAmount,
          TRANSACTION_ID1,
          releaseTimestamp
        )
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_ACCOUNT_IS_ZERO);
    });

    it("Is reverted if the premint amount is zero", async () => {
      await expect(
        (pixCashier.connect(cashier) as Contract).cashInPremint(user.address, 0, TRANSACTION_ID1, releaseTimestamp)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_AMOUNT_IS_ZERO);
    });

    it("Is reverted if the off-chain transaction ID is zero", async () => {
      await expect(
        (pixCashier.connect(cashier) as Contract).cashInPremint(
          user.address,
          tokenAmount,
          ethers.ZeroHash,
          releaseTimestamp
        )
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_TRANSACTION_ID_IS_ZERO);
    });

    it("Is reverted if the token amount is greater than 64-bit unsigned integer", async () => {
      const amount = BigInt("0x10000000000000000");
      await expect(
        (pixCashier.connect(cashier) as Contract).cashInPremint(user.address, amount, TRANSACTION_ID1, releaseTimestamp)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_AMOUNT_EXCESS);
    });

    it("Is reverted if the premint release time is zero", async () => {
      const zeroReleaseTimestamp = 0;
      await expect(
        (pixCashier.connect(cashier) as Contract).cashInPremint(
          user.address,
          tokenAmount,
          TRANSACTION_ID1,
          zeroReleaseTimestamp
        )
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INAPPROPRIATE_PREMINT_RELEASE_TIME);
    });

    it("Is reverted if the cash-in with the provided txId is already executed", async () => {
      const pixCashierConnected = pixCashier.connect(cashier) as Contract;
      await proveTx(pixCashierConnected.cashIn(user.address, tokenAmount, TRANSACTION_ID1));
      await expect(
        pixCashierConnected.cashInPremint(user.address, tokenAmount, TRANSACTION_ID1, releaseTimestamp)
      ).to.be.revertedWithCustomError(
        pixCashier,
        REVERT_ERROR_IF_CASH_IN_ALREADY_EXECUTED
      ).withArgs(TRANSACTION_ID1);
    });

    it("Is reverted if the account is blocklisted", async () => {
      await proveTx(pixCashier.grantRole(blocklisterRole, deployer.address));
      await proveTx(pixCashier.blocklist(user.address));
      await expect(
        (pixCashier.connect(cashier) as Contract).cashInPremint(
          user.address,
          tokenAmount,
          TRANSACTION_ID1,
          releaseTimestamp
        )
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_ACCOUNT_IS_BLOCKLISTED);
    });
  });

  describe("Function 'cashInPremintRevoke()'", async () => {
    const releaseTimestamp: number = 123456;
    const tokenAmount: number = 100;

    beforeEach(async () => {
      await proveTx(pixCashier.grantRole(cashierRole, cashier.address));
    });

    it("Executes as expected", async () => {
      const expectedCashIn: TestCashIn = {
        status: CashInStatus.Nonexistent,
        account: user,
        amount: tokenAmount,
        oldAmount: 0,
        txId: TRANSACTION_ID1,
        releaseTimestamp
      };

      const pixCashierConnected = pixCashier.connect(cashier) as Contract;

      await proveTx(
        pixCashierConnected.cashInPremint(
          expectedCashIn.account.address,
          expectedCashIn.amount,
          expectedCashIn.txId,
          expectedCashIn.releaseTimestamp
        )
      );
      expectedCashIn.status = CashInStatus.PremintExecuted;
      await checkCashInStructuresOnBlockchain([expectedCashIn]);

      expectedCashIn.oldAmount = expectedCashIn.amount;
      expectedCashIn.amount = 0;
      expectedCashIn.status = CashInStatus.Nonexistent;
      const tx = pixCashierConnected.cashInPremintRevoke(
        expectedCashIn.txId,
        expectedCashIn.releaseTimestamp
      );

      await expect(tx).to.emit(
        pixCashier,
        "CashInPremint"
      ).withArgs(
        expectedCashIn.account.address,
        expectedCashIn.amount,
        expectedCashIn.oldAmount ?? 0,
        expectedCashIn.txId,
        expectedCashIn.releaseTimestamp
      );
      await expect(tx).to.emit(
        tokenMock,
        "MockPremint"
      ).withArgs(
        expectedCashIn.account.address,
        expectedCashIn.amount,
        expectedCashIn.releaseTimestamp,
        PremintRestriction.Create
      );
      await checkCashInStructuresOnBlockchain([expectedCashIn]);
    });

    it("Is reverted if the contract is paused", async () => {
      await proveTx(pixCashier.grantRole(pauserRole, deployer.address));
      await proveTx(pixCashier.pause());
      await expect(
        pixCashier.cashInPremintRevoke(TRANSACTION_ID1, releaseTimestamp)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the cashier role", async () => {
      await expect(
        pixCashier.cashInPremintRevoke(TRANSACTION_ID1, releaseTimestamp)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT);
    });

    it("Is reverted if the off-chain transaction ID is zero", async () => {
      await expect(
        (pixCashier.connect(cashier) as Contract).cashInPremintRevoke(
          ethers.ZeroHash,
          releaseTimestamp
        )
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_TRANSACTION_ID_IS_ZERO);
    });

    it("Is reverted if the premint release time is zero", async () => {
      const zeroReleaseTimestamp = 0;
      await expect(
        (pixCashier.connect(cashier) as Contract).cashInPremintRevoke(TRANSACTION_ID1, zeroReleaseTimestamp)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INAPPROPRIATE_PREMINT_RELEASE_TIME);
    });

    it("Is reverted if the account is blocklisted", async () => {
      await (pixCashier.connect(cashier) as Contract).cashInPremint(
        user.address,
        tokenAmount,
        TRANSACTION_ID1,
        releaseTimestamp
      );
      await proveTx(pixCashier.grantRole(blocklisterRole, deployer.address));
      await proveTx(pixCashier.blocklist(user.address));
      await expect(
        (pixCashier.connect(cashier) as Contract).cashInPremintRevoke(TRANSACTION_ID1, releaseTimestamp)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_ACCOUNT_IS_BLOCKLISTED);
    });

    it("Is reverted if the cash-in with the provided txId does not exist", async () => {
      await expect((pixCashier.connect(cashier) as Contract).cashInPremintRevoke(TRANSACTION_ID1, releaseTimestamp))
        .to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INAPPROPRIATE_CASH_IN_STATUS)
        .withArgs(TRANSACTION_ID1, CashInStatus.Nonexistent);
    });
  });

  describe("Function 'cashInPremintUpdate()'", async () => {
    const tokenAmount: number = 100;
    const releaseTimestamp: number = 123456;

    beforeEach(async () => {
      await proveTx(pixCashier.grantRole(cashierRole, cashier.address));
    });

    async function executeAndCheckCashInPremintUpdate(expectedCashIn: TestCashIn) {
      const tx = (pixCashier.connect(cashier) as Contract).cashInPremintUpdate(
        expectedCashIn.amount,
        expectedCashIn.txId,
        expectedCashIn.releaseTimestamp
      );

      await expect(tx).to.emit(
        pixCashier,
        "CashInPremint"
      ).withArgs(
        expectedCashIn.account.address,
        expectedCashIn.amount,
        expectedCashIn.oldAmount ?? 0,
        expectedCashIn.txId,
        expectedCashIn.releaseTimestamp
      );
      await expect(tx).to.emit(
        tokenMock,
        "MockPremint"
      ).withArgs(
        expectedCashIn.account.address,
        expectedCashIn.amount,
        expectedCashIn.releaseTimestamp,
        PremintRestriction.Create
      );
      await checkCashInStructuresOnBlockchain([expectedCashIn]);
    }

    it("Executes as expected", async () => {
      const expectedCashIn: TestCashIn = {
        status: CashInStatus.Nonexistent,
        account: user,
        amount: tokenAmount,
        oldAmount: 0,
        txId: TRANSACTION_ID1,
        releaseTimestamp
      };

      await proveTx(
        (pixCashier.connect(cashier) as Contract).cashInPremint(
          expectedCashIn.account.address,
          expectedCashIn.amount,
          expectedCashIn.txId,
          expectedCashIn.releaseTimestamp
        )
      );
      expectedCashIn.status = CashInStatus.PremintExecuted;
      await checkCashInStructuresOnBlockchain([expectedCashIn]);

      expectedCashIn.oldAmount = expectedCashIn.amount;
      expectedCashIn.amount += 1;
      await executeAndCheckCashInPremintUpdate(expectedCashIn);

      expectedCashIn.oldAmount = expectedCashIn.amount;
      expectedCashIn.amount -= 2;
      await executeAndCheckCashInPremintUpdate(expectedCashIn);
    });

    it("Is reverted if the contract is paused", async () => {
      await proveTx(pixCashier.grantRole(pauserRole, deployer.address));
      await proveTx(pixCashier.pause());
      await expect(
        (pixCashier.connect(cashier) as Contract).cashInPremintUpdate(tokenAmount, TRANSACTION_ID1, releaseTimestamp)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the cashier role", async () => {
      await expect(
        (pixCashier.connect(deployer) as Contract).cashInPremintUpdate(tokenAmount, TRANSACTION_ID1, releaseTimestamp)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT);
    });

    it("Is reverted if the premint amount is zero", async () => {
      await expect(
        (pixCashier.connect(cashier) as Contract).cashInPremintUpdate(0, TRANSACTION_ID1, releaseTimestamp)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_AMOUNT_IS_ZERO);
    });

    it("Is reverted if the off-chain transaction ID is zero", async () => {
      await expect(
        (pixCashier.connect(cashier) as Contract).cashInPremintUpdate(
          tokenAmount,
          ethers.ZeroHash,
          releaseTimestamp
        )
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_TRANSACTION_ID_IS_ZERO);
    });

    it("Is reverted if the token amount is greater than 64-bit unsigned integer", async () => {
      const amount = BigInt("0x10000000000000000");
      await expect(
        (pixCashier.connect(cashier) as Contract).cashInPremintUpdate(
          amount,
          TRANSACTION_ID1,
          releaseTimestamp
        )
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_AMOUNT_EXCESS);
    });

    it("Is reverted if the premint release time is zero", async () => {
      const zeroReleaseTimestamp = 0;
      await expect(
        (pixCashier.connect(cashier) as Contract)
          .cashInPremintUpdate(tokenAmount, TRANSACTION_ID1, zeroReleaseTimestamp)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INAPPROPRIATE_PREMINT_RELEASE_TIME);
    });

    it("Is reverted if the cash-in with the provided txId does not exist", async () => {
      await expect(
        (pixCashier.connect(cashier) as Contract).cashInPremintUpdate(tokenAmount, TRANSACTION_ID1, releaseTimestamp)
      ).to.be.revertedWithCustomError(
        pixCashier,
        REVERT_ERROR_IF_INAPPROPRIATE_CASH_IN_STATUS
      ).withArgs(TRANSACTION_ID1, CashInStatus.Nonexistent);
    });

    it("Is reverted if the account is blocklisted", async () => {
      await (pixCashier.connect(cashier) as Contract).cashInPremint(
        user.address,
        tokenAmount,
        TRANSACTION_ID1,
        releaseTimestamp
      );
      await proveTx(pixCashier.grantRole(blocklisterRole, deployer.address));
      await proveTx(pixCashier.blocklist(user.address));
      await expect(
        (pixCashier.connect(cashier) as Contract).cashInPremintUpdate(tokenAmount, TRANSACTION_ID1, releaseTimestamp)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_ACCOUNT_IS_BLOCKLISTED);
    });

    it("Is reverted if the cash-in with the provided txId is not a premint", async () => {
      await proveTx((pixCashier.connect(cashier) as Contract).cashIn(user.address, tokenAmount, TRANSACTION_ID1));
      await expect(
        (pixCashier.connect(cashier) as Contract).cashInPremintUpdate(tokenAmount, TRANSACTION_ID1, releaseTimestamp)
      ).to.be.revertedWithCustomError(
        pixCashier,
        REVERT_ERROR_IF_INAPPROPRIATE_CASH_IN_STATUS
      ).withArgs(TRANSACTION_ID1, CashInStatus.Executed);
    });
  });

  describe("Function 'cashInBatch()'", async () => {
    let users: HardhatEthersSigner[];
    let userAddresses: string[];
    let expectedCashIns: TestCashIn[];

    beforeEach(async () => {
      users = [user, secondUser, thirdUser];
      userAddresses = users.map(user => user.address);
      expectedCashIns = users.map((user: HardhatEthersSigner, index: number): TestCashIn => {
        return {
          account: user,
          amount: TOKEN_AMOUNTS[index],
          oldAmount: 0,
          txId: TX_ID_ARRAY[index],
          status: CashInStatus.Executed
        };
      });

      await proveTx(pixCashier.grantRole(cashierRole, cashier.address));
    });

    it("Executes as expected even if one of the cash-in operations is already executed", async () => {
      await proveTx(
        (pixCashier.connect(cashier) as Contract).cashIn(userAddresses[1], TOKEN_AMOUNTS[1], TX_ID_ARRAY[1])
      );
      const expectedExecutionResults: CashInExecutionStatus[] = [
        CashInExecutionStatus.Success,
        CashInExecutionStatus.AlreadyExecuted,
        CashInExecutionStatus.Success
      ];

      const tx: TransactionResponse = await (pixCashier.connect(cashier) as Contract).cashInBatch(
        userAddresses,
        TOKEN_AMOUNTS,
        TX_ID_ARRAY,
        BATCH_ID1
      );

      await expect(tx).to.changeTokenBalances(
        tokenMock,
        [user, secondUser, thirdUser, pixCashier],
        [+TOKEN_AMOUNTS[0], 0, +TOKEN_AMOUNTS[2], 0]
      );
      await expect(tx)
        .to.emit(pixCashier, "CashInBatch")
        .withArgs(BATCH_ID1, TX_ID_ARRAY, expectedExecutionResults);
      await expect(tx)
        .to.emit(pixCashier, "CashIn")
        .withArgs(expectedCashIns[0].account.address, expectedCashIns[0].amount, expectedCashIns[0].txId);
      await expect(tx)
        .to.emit(pixCashier, "CashIn")
        .withArgs(expectedCashIns[2].account.address, expectedCashIns[2].amount, expectedCashIns[2].txId);

      const expectedCashInBatches: TestCashInBatch[] = [
        { batchId: BATCH_ID1, status: CashInBatchStatus.Executed },
        { batchId: BATCH_ID2, status: CashInBatchStatus.Nonexistent }
      ];

      await checkCashInStructuresOnBlockchain(expectedCashIns);
      await checkCashInBatchStructuresOnBlockchain(expectedCashInBatches);
    });

    it("Is reverted if the contract is paused", async () => {
      await proveTx(pixCashier.grantRole(pauserRole, deployer.address));
      await proveTx(pixCashier.pause());
      const users = [user.address, secondUser.address, thirdUser.address];
      await expect(
        (pixCashier.connect(cashier) as Contract).cashInBatch(users, TOKEN_AMOUNTS, TX_ID_ARRAY, BATCH_ID1)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the cashier role", async () => {
      await expect(
        (pixCashier.connect(deployer) as Contract).cashInBatch(userAddresses, TOKEN_AMOUNTS, TX_ID_ARRAY, BATCH_ID1)
      ).to.be.revertedWithCustomError(
        pixCashier,
        REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT
      ).withArgs(deployer.address, cashierRole);
    });

    it("Is reverted if one of the account addresses is zero", async () => {
      const zeroAccountArray = [user.address, ethers.ZeroAddress, user.address];
      await expect(
        (pixCashier.connect(cashier) as Contract).cashInBatch(zeroAccountArray, TOKEN_AMOUNTS, TX_ID_ARRAY, BATCH_ID1)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_ACCOUNT_IS_ZERO);
    });

    it("Is reverted if one of the accounts is blocklisted", async () => {
      await proveTx(pixCashier.grantRole(blocklisterRole, deployer.address));
      await proveTx(pixCashier.blocklist(secondUser.address));
      await expect(
        (pixCashier.connect(cashier) as Contract).cashInBatch(userAddresses, TOKEN_AMOUNTS, TX_ID_ARRAY, BATCH_ID1)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_ACCOUNT_IS_BLOCKLISTED);
    });

    it("Is reverted if one of the token amounts is zero", async () => {
      const zeroAmountArray = [100, 200, 0];
      await expect(
        (pixCashier.connect(cashier) as Contract).cashInBatch(userAddresses, zeroAmountArray, TX_ID_ARRAY, BATCH_ID1)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_AMOUNT_IS_ZERO);
    });

    it("Is reverted if one of the off-chain transaction IDs is zero", async () => {
      const zeroTxIdArray = [TRANSACTION_ID1, ethers.ZeroHash, TRANSACTION_ID3];
      await expect(
        (pixCashier.connect(cashier) as Contract).cashInBatch(userAddresses, TOKEN_AMOUNTS, zeroTxIdArray, BATCH_ID1)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_TRANSACTION_ID_IS_ZERO);
    });

    it("Is reverted if the account array is empty", async () => {
      const noUsers: string[] = [];

      await expect(
        (pixCashier.connect(cashier) as Contract).cashInBatch(noUsers, TOKEN_AMOUNTS, TX_ID_ARRAY, BATCH_ID1)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INVALID_BATCH_ARRAYS);
    });

    it("Is reverted if the length of any passed arrays is different to others", async () => {
      const moreUsers = [user.address, secondUser.address, thirdUser.address, user.address];
      const moreAmounts = [100, 200, 300, 400];
      const moreTxIds = [TRANSACTION_ID1, TRANSACTION_ID2, TRANSACTION_ID3, TRANSACTION_ID1];

      await expect(
        (pixCashier.connect(cashier) as Contract).cashInBatch(moreUsers, TOKEN_AMOUNTS, TX_ID_ARRAY, BATCH_ID1)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INVALID_BATCH_ARRAYS);

      await expect(
        (pixCashier.connect(cashier) as Contract).cashInBatch(userAddresses, moreAmounts, TX_ID_ARRAY, BATCH_ID1)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INVALID_BATCH_ARRAYS);

      await expect(
        (pixCashier.connect(cashier) as Contract).cashInBatch(userAddresses, TOKEN_AMOUNTS, moreTxIds, BATCH_ID1)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INVALID_BATCH_ARRAYS);
    });

    it("Is reverted if minting function returns 'false'", async () => {
      await proveTx(tokenMock.setMintResult(false));
      await expect(
        (pixCashier.connect(cashier) as Contract).cashInBatch(userAddresses, TOKEN_AMOUNTS, TX_ID_ARRAY, BATCH_ID1)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_TOKEN_MINTING_FAILURE);
    });

    it("Is reverted if the provided batch ID is zero", async () => {
      await expect(
        (pixCashier.connect(cashier) as Contract).cashInBatch(
          userAddresses,
          TOKEN_AMOUNTS,
          TX_ID_ARRAY,
          BATCH_ID_ZERO
        )
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_BATCH_ID_IS_ZERO);
    });

    it("Is reverted if a cash-in batch with the provided ID is already executed", async () => {
      await proveTx(
        (pixCashier.connect(cashier) as Contract).cashInBatch(userAddresses, TOKEN_AMOUNTS, TX_ID_ARRAY, BATCH_ID1)
      );
      await expect(
        (pixCashier.connect(cashier) as Contract).cashInBatch(
          userAddresses,
          TOKEN_AMOUNTS,
          TX_ID_ARRAY,
          BATCH_ID1
        )
      ).to.be.revertedWithCustomError(
        pixCashier,
        REVERT_ERROR_IF_CASH_IN_BATCH_ALREADY_EXECUTED
      ).withArgs(BATCH_ID1);
    });
  });

  describe("Function 'requestCashOutFrom()'", async () => {
    let cashOut: TestCashOut;

    beforeEach(async () => {
      cashOut = {
        account: user,
        amount: 200,
        txId: TRANSACTION_ID1,
        status: CashOutStatus.Nonexistent
      };
      await proveTx((tokenMock.connect(cashOut.account) as Contract).approve(pixCashierAddress, ethers.MaxUint256));
      await proveTx(pixCashier.grantRole(cashierRole, cashier.address));
    });

    it("Transfers tokens as expected, emits the correct event, changes cash-out balances accordingly", async () => {
      await proveTx(tokenMock.mint(cashOut.account.address, cashOut.amount));
      await checkPixCashierState([cashOut]);
      const tx = (pixCashier.connect(cashier) as Contract).requestCashOutFrom(
        cashOut.account.address,
        cashOut.amount,
        cashOut.txId
      );
      await expect(tx).to.changeTokenBalances(
        tokenMock,
        [cashOut.account, pixCashier, cashier],
        [-cashOut.amount, +cashOut.amount, 0]
      );
      await expect(tx)
        .to.emit(pixCashier, "RequestCashOut")
        .withArgs(cashOut.account.address, cashOut.amount, cashOut.amount, cashOut.txId, cashier.address);
      cashOut.status = CashOutStatus.Pending;
      await checkPixCashierState([cashOut]);
    });

    it("Is reverted if the contract is paused", async () => {
      await proveTx(pixCashier.grantRole(pauserRole, deployer.address));
      await proveTx(pixCashier.pause());
      const pixCashierConnected = pixCashier.connect(cashier) as Contract;
      await expect(
        pixCashierConnected.requestCashOutFrom(cashOut.account.address, cashOut.amount, cashOut.txId)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the cashier role", async () => {
      const pixCashierConnected = pixCashier.connect(deployer) as Contract;
      await expect(
        pixCashierConnected.requestCashOutFrom(cashOut.account.address, cashOut.amount, cashOut.txId)
      ).to.be.revertedWithCustomError(
        pixCashier,
        REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT
      ).withArgs(
        deployer.address,
        cashierRole
      );
    });

    it("Is reverted if the account is blocklisted", async () => {
      await proveTx(pixCashier.grantRole(blocklisterRole, deployer.address));
      await proveTx(pixCashier.blocklist(cashOut.account.address));
      const pixCashierConnected = pixCashier.connect(cashier) as Contract;
      await expect(
        pixCashierConnected.requestCashOutFrom(cashOut.account.address, cashOut.amount, cashOut.txId)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_ACCOUNT_IS_BLOCKLISTED);
    });

    it("Is reverted if the account address is zero", async () => {
      const pixCashierConnected = pixCashier.connect(cashier) as Contract;
      await expect(
        pixCashierConnected.requestCashOutFrom(ethers.ZeroAddress, cashOut.amount, cashOut.txId)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_ACCOUNT_IS_ZERO);
    });

    it("Is reverted if the token amount is zero", async () => {
      const pixCashierConnected = pixCashier.connect(cashier) as Contract;
      await expect(
        pixCashierConnected.requestCashOutFrom(cashOut.account.address, 0, cashOut.txId)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_AMOUNT_IS_ZERO);
    });

    it("Is reverted if the token amount is greater than 64-bit unsigned integer", async () => {
      const amount: bigint = BigInt("0x10000000000000000");
      const pixCashierConnected = pixCashier.connect(cashier) as Contract;
      await expect(
        pixCashierConnected.requestCashOutFrom(cashOut.account.address, amount, cashOut.txId)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_AMOUNT_EXCESS);
    });

    it("Is reverted if the off-chain transaction ID is zero", async () => {
      const pixCashierConnected = pixCashier.connect(cashier) as Contract;
      await expect(
        pixCashierConnected.requestCashOutFrom(cashOut.account.address, cashOut.amount, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_TRANSACTION_ID_IS_ZERO);
    });

    it("Is reverted if the cash-out with the provided txId is already pending", async () => {
      await proveTx(tokenMock.mint(cashOut.account.address, cashOut.amount));
      const pixCashierConnected = pixCashier.connect(cashier) as Contract;
      await proveTx(pixCashierConnected.requestCashOutFrom(cashOut.account.address, cashOut.amount, cashOut.txId));
      await expect(pixCashierConnected.requestCashOutFrom(cashOut.account.address, cashOut.amount, cashOut.txId))
        .to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_STATUS)
        .withArgs(cashOut.txId, CashOutStatus.Pending);
    });

    it("Is reverted if the cash-out with the provided txId is already confirmed", async () => {
      await proveTx(tokenMock.mint(cashOut.account.address, cashOut.amount));
      const pixCashierConnected = pixCashier.connect(cashier) as Contract;
      await proveTx(pixCashierConnected.requestCashOutFrom(cashOut.account.address, cashOut.amount, cashOut.txId));
      await proveTx(pixCashierConnected.confirmCashOut(cashOut.txId));
      await expect(pixCashierConnected.requestCashOutFrom(cashOut.account.address, cashOut.amount, cashOut.txId))
        .to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_STATUS)
        .withArgs(cashOut.txId, CashOutStatus.Confirmed);
    });

    it("Is reverted if txId of a reversed cash-out operation is reused for another account", async () => {
      await proveTx(tokenMock.mint(cashOut.account.address, cashOut.amount));
      const pixCashierConnected = pixCashier.connect(cashier) as Contract;
      await proveTx(pixCashierConnected.requestCashOutFrom(cashOut.account.address, cashOut.amount, cashOut.txId));
      await proveTx(pixCashierConnected.reverseCashOut(cashOut.txId));
      await expect(pixCashierConnected.requestCashOutFrom(deployer.address, cashOut.amount, cashOut.txId))
        .to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_ACCOUNT)
        .withArgs(cashOut.txId, cashOut.account.address);
    });

    it("Is reverted if the user has not enough tokens", async () => {
      await proveTx(tokenMock.mint(cashOut.account.address, cashOut.amount - 1));
      const pixCashierConnected = pixCashier.connect(cashier) as Contract;
      await expect(
        pixCashierConnected.requestCashOutFrom(cashOut.account.address, cashOut.amount, cashOut.txId)
      ).to.be.revertedWithCustomError(
        tokenMock,
        REVERT_ERROR_IF_ERC20_TOKEN_TRANSFER_AMOUNT_EXCEEDS_BALANCE
      ).withArgs(cashOut.account.address, anyValue, anyValue);
    });
  });

  describe("Function 'requestCashOutFromBatch()'", async () => {
    let cashOuts: TestCashOut[];
    let accounts: string[];
    let amounts: number[];

    beforeEach(async () => {
      cashOuts = [
        {
          account: user,
          amount: 200,
          txId: TRANSACTION_ID1,
          status: CashOutStatus.Nonexistent
        },
        {
          account: secondUser,
          amount: 300,
          txId: TRANSACTION_ID2,
          status: CashOutStatus.Nonexistent
        },
        {
          account: thirdUser,
          amount: 400,
          txId: TRANSACTION_ID3,
          status: CashOutStatus.Nonexistent
        }
      ];
      accounts = cashOuts.map(cashOut => cashOut.account.address);
      amounts = cashOuts.map(cashOut => cashOut.amount);
      for (const cashOut of cashOuts) {
        await proveTx((tokenMock.connect(cashOut.account) as Contract).approve(pixCashierAddress, ethers.MaxUint256));
        await proveTx(tokenMock.mint(cashOut.account.address, cashOut.amount));
      }

      await proveTx(pixCashier.grantRole(cashierRole, cashier.address));
    });

    it("Transfers tokens as expected, emits the correct event, changes cash-out balances accordingly", async () => {
      const amountSum: number = amounts.reduce((sum: number, amount: number) => sum + amount);
      await checkPixCashierState(cashOuts);
      const tx = (pixCashier.connect(cashier) as Contract).requestCashOutFromBatch(accounts, amounts, TX_ID_ARRAY);
      await expect(tx).to.changeTokenBalances(
        tokenMock,
        [pixCashier, cashier, ...(cashOuts.map(cashOut => cashOut.account))],
        [+amountSum, 0, ...(cashOuts.map(cashOut => -cashOut.amount))]
      );
      for (const cashOut of cashOuts) {
        await expect(tx)
          .to.emit(pixCashier, "RequestCashOut")
          .withArgs(
            cashOut.account.address,
            cashOut.amount,
            cashOut.amount,
            cashOut.txId,
            cashier.address
          );
      }
      cashOuts.forEach(cashOut => cashOut.status = CashOutStatus.Pending);
      await checkPixCashierState(cashOuts);
    });

    it("Is reverted if the contract is paused", async () => {
      await proveTx(pixCashier.grantRole(pauserRole, deployer.address));
      await proveTx(pixCashier.pause());
      await expect(
        (pixCashier.connect(cashier) as Contract).requestCashOutFromBatch(accounts, amounts, TX_ID_ARRAY)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the cashier role", async () => {
      await expect(
        (pixCashier.connect(deployer) as Contract).requestCashOutFromBatch(accounts, amounts, TX_ID_ARRAY)
      ).to.be.revertedWithCustomError(
        pixCashier,
        REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT
      ).withArgs(
        deployer.address,
        cashierRole
      );
    });

    it("Is reverted if the length of any passed arrays is different to others", async () => {
      const users = [user.address, secondUser.address, thirdUser.address];
      const moreUsers = [user.address, secondUser.address, thirdUser.address, user.address];
      const moreAmounts = [100, 200, 300, 400];
      const moreTransactions = [TRANSACTION_ID1, TRANSACTION_ID2, TRANSACTION_ID3, TRANSACTION_ID1];

      await expect(
        (pixCashier.connect(cashier) as Contract).requestCashOutFromBatch(moreUsers, TOKEN_AMOUNTS, TX_ID_ARRAY)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INVALID_BATCH_ARRAYS);

      await expect(
        (pixCashier.connect(cashier) as Contract).requestCashOutFromBatch(users, moreAmounts, TX_ID_ARRAY)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INVALID_BATCH_ARRAYS);

      await expect(
        (pixCashier.connect(cashier) as Contract).requestCashOutFromBatch(users, TOKEN_AMOUNTS, moreTransactions)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INVALID_BATCH_ARRAYS);
    });

    it("Is reverted if the account is blocklisted", async () => {
      await proveTx(pixCashier.grantRole(blocklisterRole, deployer.address));
      await proveTx(pixCashier.blocklist(cashOuts[1].account.address));
      await expect(
        (pixCashier.connect(cashier) as Contract).requestCashOutFromBatch(accounts, amounts, TX_ID_ARRAY)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_ACCOUNT_IS_BLOCKLISTED);
    });

    it("Is reverted if the account address is zero", async () => {
      accounts[1] = ethers.ZeroAddress;
      await expect(
        (pixCashier.connect(cashier) as Contract).requestCashOutFromBatch(accounts, amounts, TX_ID_ARRAY)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_ACCOUNT_IS_ZERO);
    });

    it("Is reverted if the token amount is zero", async () => {
      amounts[2] = 0;
      await expect(
        (pixCashier.connect(cashier) as Contract).requestCashOutFromBatch(accounts, amounts, TX_ID_ARRAY)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_AMOUNT_IS_ZERO);
    });

    it("Is reverted if the off-chain transaction ID is zero", async () => {
      const transactions = [TRANSACTION_ID1, ethers.ZeroHash, TRANSACTION_ID3];
      await expect(
        (pixCashier.connect(cashier) as Contract).requestCashOutFromBatch(accounts, amounts, transactions)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_TRANSACTION_ID_IS_ZERO);
    });

    it("Is reverted if the cash-out with the provided txId is already pending", async () => {
      const pixCashierConnected = pixCashier.connect(cashier) as Contract;
      const cashOutPending = cashOuts[cashOuts.length - 1];
      await proveTx(pixCashierConnected.requestCashOutFrom(
        cashOutPending.account.address,
        cashOutPending.amount,
        cashOutPending.txId
      ));
      expect((pixCashier.connect(cashier) as Contract).requestCashOutFromBatch(accounts, amounts, TX_ID_ARRAY))
        .to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_STATUS)
        .withArgs(cashOutPending.txId, CashOutStatus.Pending);
    });

    it("Is reverted if the user has not enough tokens", async () => {
      amounts[2] += 1;
      await expect(
        (pixCashier.connect(cashier) as Contract).requestCashOutFromBatch(accounts, amounts, TX_ID_ARRAY)
      ).to.be.revertedWithCustomError(
        tokenMock,
        REVERT_ERROR_IF_ERC20_TOKEN_TRANSFER_AMOUNT_EXCEEDS_BALANCE
      ).withArgs(cashOuts[2].account.address, anyValue, anyValue);
    });
  });

  describe("Function 'confirmCashOut()'", async () => {
    let cashOut: TestCashOut;

    beforeEach(async () => {
      cashOut = {
        account: user,
        amount: 100,
        txId: TRANSACTION_ID1,
        status: CashOutStatus.Nonexistent
      };
      await proveTx(pixCashier.grantRole(cashierRole, cashier.address));
      await setUpContractsForCashOuts([cashOut]);
    });

    it("Burns tokens as expected, emits the correct event, changes the contract state accordingly", async () => {
      await requestCashOuts([cashOut]);
      cashOut.status = CashOutStatus.Pending;
      await checkPixCashierState([cashOut]);
      const tx = (pixCashier.connect(cashier) as Contract).confirmCashOut(cashOut.txId);
      await expect(tx).to.changeTokenBalances(tokenMock, [pixCashier, cashOut.account], [-cashOut.amount, 0]);
      await expect(tx)
        .to.emit(pixCashier, "ConfirmCashOut")
        .withArgs(cashOut.account.address, cashOut.amount, 0, cashOut.txId);
      cashOut.status = CashOutStatus.Confirmed;
      await checkPixCashierState([cashOut]);
    });

    it("Is reverted if the contract is paused", async () => {
      await proveTx(pixCashier.grantRole(pauserRole, deployer.address));
      await proveTx(pixCashier.pause());
      await expect(
        (pixCashier.connect(cashier) as Contract).confirmCashOut(cashOut.txId)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the cashier role", async () => {
      await expect(
        (pixCashier.connect(deployer) as Contract).confirmCashOut(cashOut.txId)
      ).to.be.revertedWithCustomError(
        pixCashier,
        REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT
      ).withArgs(deployer.address, cashierRole);
    });

    it("Is reverted if the off-chain transaction ID is zero", async () => {
      await expect(
        (pixCashier.connect(cashier) as Contract).confirmCashOut(ethers.ZeroHash)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_TRANSACTION_ID_IS_ZERO);
    });

    it("Is reverted if the cash-out with the provided txId was not requested previously", async () => {
      await expect((pixCashier.connect(cashier) as Contract).confirmCashOut(cashOut.txId))
        .to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_STATUS)
        .withArgs(cashOut.txId, CashOutStatus.Nonexistent);
    });
  });

  describe("Function 'confirmCashOutBatch()'", async () => {
    let cashOuts: TestCashOut[];
    let txIds: string[];

    beforeEach(async () => {
      cashOuts = [
        {
          account: user,
          amount: 100,
          txId: TRANSACTION_ID1,
          status: CashOutStatus.Nonexistent
        },
        {
          account: deployer,
          amount: 200,
          txId: TRANSACTION_ID2,
          status: CashOutStatus.Nonexistent
        }
      ];
      txIds = cashOuts.map(cashOut => cashOut.txId);
      await proveTx(pixCashier.grantRole(cashierRole, cashier.address));
      await setUpContractsForCashOuts(cashOuts);
    });

    it("Burns tokens as expected, emits the correct event, changes the contract state accordingly", async () => {
      await requestCashOuts(cashOuts);
      await checkPixCashierState(cashOuts);
      const totalTokens = countNumberArrayTotal(cashOuts.map(cashOut => cashOut.amount));
      const tx = (pixCashier.connect(cashier) as Contract).confirmCashOutBatch(txIds);
      await expect(tx).to.changeTokenBalances(
        tokenMock,
        [pixCashier, ...cashOuts.map(cashOut => cashOut.account)],
        [-totalTokens, ...cashOuts.map(() => 0)]
      );
      await expect(tx)
        .to.emit(pixCashier, "ConfirmCashOut")
        .withArgs(
          cashOuts[0].account.address,
          cashOuts[0].amount,
          0,
          cashOuts[0].txId
        );
      await expect(tx)
        .to.emit(pixCashier, "ConfirmCashOut")
        .withArgs(cashOuts[1].account.address, cashOuts[1].amount, 0, cashOuts[1].txId);
      cashOuts.forEach(cashOut => (cashOut.status = CashOutStatus.Confirmed));
      await checkPixCashierState(cashOuts);
    });

    it("Is reverted if the contract is paused", async () => {
      await proveTx(pixCashier.grantRole(pauserRole, deployer.address));
      await proveTx(pixCashier.pause());
      await expect(
        (pixCashier.connect(cashier) as Contract).confirmCashOutBatch(txIds)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the cashier role", async () => {
      await expect(
        (pixCashier.connect(deployer) as Contract).confirmCashOutBatch(txIds)
      ).to.be.revertedWithCustomError(
        pixCashier,
        REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT
      ).withArgs(deployer.address, cashierRole);
    });

    it("Is reverted if the off-chain transaction IDs array is empty", async () => {
      await expect(
        (pixCashier.connect(cashier) as Contract).confirmCashOutBatch([])
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_EMPTY_TRANSACTION_IDS_ARRAY);
    });

    it("Is reverted if one of the off-chain transaction IDs is zero", async () => {
      await requestCashOuts(cashOuts);
      txIds[txIds.length - 1] = ethers.ZeroHash;
      await expect(
        (pixCashier.connect(cashier) as Contract).confirmCashOutBatch(txIds)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_TRANSACTION_ID_IS_ZERO);
    });

    it("Is reverted if one of the cash-outs was not requested previously", async () => {
      await requestCashOuts(cashOuts);
      txIds[txIds.length - 1] = TRANSACTION_ID3;
      await expect((pixCashier.connect(cashier) as Contract).confirmCashOutBatch(txIds))
        .to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_STATUS)
        .withArgs(TRANSACTION_ID3, CashOutStatus.Nonexistent);
    });
  });

  describe("Function 'reverseCashOut()'", async () => {
    let cashOut: TestCashOut;

    beforeEach(async () => {
      cashOut = {
        account: user,
        amount: 100,
        txId: TRANSACTION_ID1,
        status: CashOutStatus.Nonexistent
      };
      await proveTx(pixCashier.grantRole(cashierRole, cashier.address));
      await setUpContractsForCashOuts([cashOut]);
    });

    it("Transfers tokens as expected, emits the correct event, changes the contract state accordingly", async () => {
      await requestCashOuts([cashOut]);
      cashOut.status = CashOutStatus.Pending;
      await checkPixCashierState([cashOut]);
      const tx = (pixCashier.connect(cashier) as Contract).reverseCashOut(cashOut.txId);
      await expect(tx).to.changeTokenBalances(
        tokenMock,
        [cashOut.account, pixCashier, cashier],
        [+cashOut.amount, -cashOut.amount, 0]
      );
      await expect(tx)
        .to.emit(pixCashier, "ReverseCashOut")
        .withArgs(cashOut.account.address, cashOut.amount, 0, cashOut.txId);
      cashOut.status = CashOutStatus.Reversed;
      await checkPixCashierState([cashOut]);
    });

    it("Is reverted if the contract is paused", async () => {
      await proveTx(pixCashier.grantRole(pauserRole, deployer.address));
      await proveTx(pixCashier.pause());
      await expect(
        (pixCashier.connect(cashier) as Contract).reverseCashOut(cashOut.txId)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the cashier role", async () => {
      await expect(
        (pixCashier.connect(deployer) as Contract).reverseCashOut(cashOut.txId)
      ).to.be.revertedWithCustomError(
        pixCashier,
        REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT
      ).withArgs(deployer.address, cashierRole);
    });

    it("Is reverted if the off-chain transaction ID is zero", async () => {
      await expect(
        (pixCashier.connect(cashier) as Contract).reverseCashOut(ethers.ZeroHash)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_TRANSACTION_ID_IS_ZERO);
    });

    it("Is reverted if the cash-out with the provided txId was not requested previously", async () => {
      await expect((pixCashier.connect(cashier) as Contract).reverseCashOut(cashOut.txId))
        .to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_STATUS)
        .withArgs(cashOut.txId, CashOutStatus.Nonexistent);
    });
  });

  describe("Function 'reverseCashOutBatch()'", async () => {
    let cashOuts: TestCashOut[];
    let txIds: string[];

    beforeEach(async () => {
      cashOuts = [
        {
          account: user,
          amount: 123,
          txId: TRANSACTION_ID1,
          status: CashOutStatus.Nonexistent
        },
        {
          account: deployer,
          amount: 456,
          txId: TRANSACTION_ID2,
          status: CashOutStatus.Nonexistent
        }
      ];
      txIds = cashOuts.map(cashOut => cashOut.txId);
      await proveTx(pixCashier.grantRole(cashierRole, cashier.address));
      await setUpContractsForCashOuts(cashOuts);
    });

    it("Transfers tokens as expected, emits the correct event, changes the contract state accordingly", async () => {
      await requestCashOuts(cashOuts);
      await checkPixCashierState(cashOuts);
      const totalTokens = countNumberArrayTotal(cashOuts.map(cashOut => cashOut.amount));
      const tx = (pixCashier.connect(cashier) as Contract).reverseCashOutBatch(txIds);
      await expect(tx).to.changeTokenBalances(
        tokenMock,
        [pixCashier, cashier, ...cashOuts.map(cashOut => cashOut.account)],
        [-totalTokens, 0, ...cashOuts.map(cashOut => cashOut.amount)]
      );
      await expect(tx)
        .to.emit(pixCashier, "ReverseCashOut")
        .withArgs(
          cashOuts[0].account.address,
          cashOuts[0].amount,
          0,
          cashOuts[0].txId
        );
      await expect(tx)
        .to.emit(pixCashier, "ReverseCashOut")
        .withArgs(cashOuts[1].account.address, cashOuts[1].amount, 0, cashOuts[1].txId);
      cashOuts.forEach(cashOut => (cashOut.status = CashOutStatus.Reversed));
      await checkPixCashierState(cashOuts);
    });

    it("Is reverted if the contract is paused", async () => {
      await proveTx(pixCashier.grantRole(pauserRole, deployer.address));
      await proveTx(pixCashier.pause());
      await expect(
        (pixCashier.connect(cashier) as Contract).reverseCashOutBatch(txIds)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the cashier role", async () => {
      await expect(
        (pixCashier.connect(deployer) as Contract).reverseCashOutBatch(txIds)
      ).to.be.revertedWithCustomError(
        pixCashier,
        REVERT_ERROR_IF_UNAUTHORIZED_ACCOUNT
      ).withArgs(deployer.address, cashierRole);
    });

    it("Is reverted if the off-chain transaction IDs array is empty", async () => {
      await expect(
        (pixCashier.connect(cashier) as Contract).reverseCashOutBatch([])
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_EMPTY_TRANSACTION_IDS_ARRAY);
    });

    it("Is reverted if one of the off-chain transaction IDs is zero", async () => {
      await requestCashOuts(cashOuts);
      txIds[txIds.length - 1] = ethers.ZeroHash;
      await expect(
        (pixCashier.connect(cashier) as Contract).reverseCashOutBatch(txIds)
      ).to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_TRANSACTION_ID_IS_ZERO);
    });

    it("Is reverted if one of the cash-outs was not requested previously", async () => {
      await requestCashOuts(cashOuts);
      txIds[txIds.length - 1] = TRANSACTION_ID3;
      await expect((pixCashier.connect(cashier) as Contract).reverseCashOutBatch(txIds))
        .to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_STATUS)
        .withArgs(TRANSACTION_ID3, CashOutStatus.Nonexistent);
    });
  });

  describe("Function 'getPendingCashOutTxIds()'", async () => {
    let cashOuts: TestCashOut[];
    let txIds: string[];

    beforeEach(async () => {
      cashOuts = [
        {
          account: user,
          amount: 100,
          txId: TRANSACTION_ID1,
          status: CashOutStatus.Nonexistent
        },
        {
          account: deployer,
          amount: 200,
          txId: TRANSACTION_ID2,
          status: CashOutStatus.Nonexistent
        },
        {
          account: user,
          amount: 300,
          txId: TRANSACTION_ID3,
          status: CashOutStatus.Nonexistent
        }
      ];
      txIds = cashOuts.map(cashOut => cashOut.txId);
      await proveTx(pixCashier.grantRole(cashierRole, cashier.address));
      await setUpContractsForCashOuts(cashOuts);
    });

    it("Returns expected values in different cases", async () => {
      await requestCashOuts(cashOuts);
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
    const cashInTokenAmount: number = 100;
    let cashOut: TestCashOut;

    beforeEach(async () => {
      cashOut = {
        account: user,
        amount: 80,
        txId: TRANSACTION_ID1,
        status: CashOutStatus.Nonexistent
      };
      await proveTx(pixCashier.grantRole(cashierRole, cashier.address));
      await proveTx((tokenMock.connect(cashOut.account) as Contract).approve(pixCashierAddress, ethers.MaxUint256));
    });

    it("Scenario 1 with cash-out reversing executes successfully", async () => {
      const pixCashierConnected = pixCashier.connect(cashier) as Contract;
      await proveTx(pixCashierConnected.cashIn(cashOut.account.address, cashInTokenAmount, cashOut.txId));
      await requestCashOuts([cashOut]);
      await proveTx(pixCashierConnected.reverseCashOut(cashOut.txId));
      cashOut.status = CashOutStatus.Reversed;
      await checkPixCashierState([cashOut]);

      // After reversing a cash-out with the same txId can't be reversed again.
      await expect(pixCashierConnected.reverseCashOut(cashOut.txId))
        .to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_STATUS)
        .withArgs(cashOut.txId, CashOutStatus.Reversed);
      await expect(pixCashierConnected.reverseCashOutBatch([cashOut.txId]))
        .to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_STATUS)
        .withArgs(cashOut.txId, CashOutStatus.Reversed);

      // After reversing a cash-out with the same txId can't be confirmed.
      await expect(pixCashierConnected.confirmCashOut(cashOut.txId))
        .to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_STATUS)
        .withArgs(cashOut.txId, CashOutStatus.Reversed);
      await expect(pixCashierConnected.confirmCashOutBatch([cashOut.txId]))
        .to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_STATUS)
        .withArgs(cashOut.txId, CashOutStatus.Reversed);

      expect(await tokenMock.balanceOf(cashOut.account.address)).to.equal(cashInTokenAmount);

      // After reversing a cash-out with the same txId can be requested again.
      await requestCashOuts([cashOut]);
      await checkPixCashierState([cashOut]);
      expect(await tokenMock.balanceOf(cashOut.account.address)).to.equal(cashInTokenAmount - cashOut.amount);
    });

    it("Scenario 2 with cash-out confirming executes successfully", async () => {
      const pixCashierConnected = pixCashier.connect(cashier) as Contract;
      await proveTx(pixCashierConnected.cashIn(cashOut.account.address, cashInTokenAmount, cashOut.txId));
      await requestCashOuts([cashOut]);
      await proveTx(pixCashierConnected.confirmCashOut(cashOut.txId));
      cashOut.status = CashOutStatus.Confirmed;
      await checkPixCashierState([cashOut]);

      // After confirming a cash-out with the same txId can't be reversed again.
      await expect(pixCashierConnected.reverseCashOut(cashOut.txId))
        .to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_STATUS)
        .withArgs(cashOut.txId, CashOutStatus.Confirmed);
      await expect(pixCashierConnected.reverseCashOutBatch([cashOut.txId]))
        .to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_STATUS)
        .withArgs(cashOut.txId, CashOutStatus.Confirmed);

      // After confirming a cash-out with the same txId can't be confirmed.
      await expect(pixCashierConnected.confirmCashOut(cashOut.txId))
        .to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_STATUS)
        .withArgs(cashOut.txId, CashOutStatus.Confirmed);
      await expect(pixCashierConnected.confirmCashOutBatch([cashOut.txId]))
        .to.be.revertedWithCustomError(pixCashier, REVERT_ERROR_IF_INAPPROPRIATE_CASH_OUT_STATUS)
        .withArgs(cashOut.txId, CashOutStatus.Confirmed);

      expect(await tokenMock.balanceOf(cashOut.account.address)).to.equal(cashInTokenAmount - cashOut.amount);
    });
  });
});
