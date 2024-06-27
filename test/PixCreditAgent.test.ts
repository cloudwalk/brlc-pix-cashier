import { TransactionResponse } from "@ethersproject/abstract-provider";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { expect } from "chai";
import { BigNumber, Contract, ContractFactory } from "ethers";
import { ethers, network, upgrades } from "hardhat";
import { proveTx } from "../test-utils/eth";
import { createRevertMessageDueToMissingRole } from "../test-utils/misc";

const ADDRESS_ZERO = ethers.constants.AddressZero;
const BIG_NUMBER_ZERO = ethers.constants.Zero;
const BIG_NUMBER_ONE = BigNumber.from(1);

enum PixCreditStatus {
  Nonexistent = 0,
  Initiated = 1,
  Pending = 2,
  Confirmed = 3,
  Reversed = 4
}

enum HookIndex {
  Unused = 1,
  CashOutRequestBefore = 6,
  CashOutConfirmationAfter = 9,
  CashOutReversalAfter = 11,
}

interface PixCredit {
  borrower: string;
  programId: number;
  durationInPeriods: number;
  status: PixCreditStatus;
  loanAmount: BigNumber;
  loanAddon: BigNumber;
  loanId: BigNumber;

  // Indexing signature to ensure that fields are iterated over in a key-value style
  [key: string]: BigNumber | string | number;
}

interface Fixture {
  pixCreditAgent: Contract;
  pixCashierMock: Contract;
  lendingMarketMock: Contract;
  loanIdStub: BigNumber;
}

interface AgentState {
  initiatedCreditCounter: BigNumber;
  pendingCreditCounter: BigNumber;
  processedCreditCounter: BigNumber;
  configured: boolean;

  // Indexing signature to ensure that fields are iterated over in a key-value style
  [key: string]: BigNumber | boolean;
}

interface CashOut {
  account: string;
  amount: BigNumber;
  status: number;
  flags: number;
}

const initialAgentState: AgentState = {
  initiatedCreditCounter: BIG_NUMBER_ZERO,
  pendingCreditCounter: BIG_NUMBER_ZERO,
  processedCreditCounter: BIG_NUMBER_ZERO,
  configured: false
};

const initialPixCredit: PixCredit = {
  borrower: ADDRESS_ZERO,
  programId: 0,
  durationInPeriods: 0,
  status: PixCreditStatus.Nonexistent,
  loanAmount: BIG_NUMBER_ZERO,
  loanAddon: BIG_NUMBER_ZERO,
  loanId: BIG_NUMBER_ZERO,
};

const initialCashOut: CashOut = {
  account: ADDRESS_ZERO,
  amount: BIG_NUMBER_ZERO,
  status: 0,
  flags: 0
};

function checkEquality<T extends Record<string, any>>(actualObject: T, expectedObject: T) {
  Object.keys(expectedObject).forEach(property => {
    expect(actualObject).to.haveOwnProperty(property);
    expect(actualObject[property]).to.eq(
      expectedObject[property],
      `Mismatch in the "${property}" property`
    );
  });
}

async function setUpFixture<T>(func: () => Promise<T>): Promise<T> {
  if (network.name === "hardhat") {
    return loadFixture(func);
  } else {
    return func();
  }
}

describe("Contract 'PixCreditAgent'", async () => {
  const PIX_TX_ID_STUB1 = ethers.utils.formatBytes32String("STUB_TRANSACTION_ID1");
  const PIX_TX_ID_STUB2 = ethers.utils.formatBytes32String("STUB_TRANSACTION_ID2");
  const PIX_TX_ID_ZERO = ethers.constants.HashZero;
  const LOAN_PROGRAM_ID_STUB = 0xFFFF_ABCD;
  const LOAN_DURATION_IN_SECONDS_STUB = 0xFFFF_DCBA;
  const LOAN_AMOUNT_STUB: BigNumber = BigNumber.from("0xFFFFFFFFFFFF1234");
  const LOAN_ADDON_STUB: BigNumber = BigNumber.from("0xFFFFFFFFFFFF4321");
  const NEEDED_PIX_CASH_OUT_HOOK_FLAGS =
    (1 << HookIndex.CashOutRequestBefore) +
    (1 << HookIndex.CashOutConfirmationAfter) +
    (1 << HookIndex.CashOutReversalAfter);

  const REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED = "Initializable: contract is already initialized";
  const REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED = "Pausable: paused";

  const REVERT_ERROR_IF_BORROWER_ADDRESS_ZERO = "BorrowerAddressZero";
  const REVERT_ERROR_IF_CONFIGURATION_UNCHANGED = "ConfigurationUnchanged";
  const REVERT_ERROR_IF_CONFIGURING_PROHIBITED = "ConfiguringProhibited";
  const REVERT_ERROR_IF_CONTRACT_NOT_CONFIGURED = "ContractNotConfigured";
  const REVERT_ERROR_IF_LOAN_AMOUNT_ZERO = "LoanAmountZero";
  const REVERT_ERROR_IF_LOAN_DURATION_ZERO = "LoanDurationZero";
  const REVERT_ERROR_IF_PIX_CASH_OUT_INAPPROPRIATE = "PixCashOutInappropriate"; // with parameters
  const REVERT_ERROR_IF_PIX_CREDIT_STATUS_INAPPROPRIATE = "PixCreditStatusInappropriate"; // with parameters
  const REVERT_ERROR_IF_PIX_HOOK_CALLER_UNAUTHORIZED = "PixHookCallerUnauthorized";
  const REVERT_ERROR_IF_PIX_TX_ID_ZERO = "PixTxIdZero";
  const REVERT_ERROR_IF_PROGRAM_ID_ZERO = "ProgramIdZero";
  const REVERT_ERROR_IF_SAFE_CAST_OVERFLOWED_UINT_DOWNCAST = "SafeCastOverflowedUintDowncast";

  const EVENT_NAME_MOCK_CONFIGURE_CASH_OUT_HOOKS_CALLED = "MockConfigureCashOutHooksCalled";
  const EVENT_NAME_MOCK_REVOKE_LOAN_CALLED = "MockRevokeLoanCalled";
  const EVENT_NAME_MOCK_TAKE_LOAN_FOR_CALLED = "MockTakeLoanForCalled";
  const EVENT_NAME_LENDING_MARKET_CHANGED = "LendingMarketChanged";
  const EVENT_NAME_PIX_CASHIER_CHANGED = "PixCashierChanged";
  const EVENT_NAME_PIX_CREDIT_STATUS_CHANGED = "PixCreditStatusChanged";

  let pixCreditAgentFactory: ContractFactory;
  let pixCashierMockFactory: ContractFactory;
  let lendingMarketMockFactory: ContractFactory;
  let deployer: SignerWithAddress;
  let admin: SignerWithAddress;
  let manager: SignerWithAddress;
  let borrower: SignerWithAddress;

  const ownerRole: string = ethers.utils.id("OWNER_ROLE");
  const pauserRole: string = ethers.utils.id("PAUSER_ROLE");
  const rescuerRole: string = ethers.utils.id("RESCUER_ROLE");
  const adminRole: string = ethers.utils.id("ADMIN_ROLE");
  const managerRole: string = ethers.utils.id("MANAGER_ROLE");

  before(async () => {
    pixCreditAgentFactory = await ethers.getContractFactory("PixCreditAgent");
    pixCashierMockFactory = await ethers.getContractFactory("PixCashierMock");
    lendingMarketMockFactory = await ethers.getContractFactory("LendingMarketMock");

    [deployer, admin, manager, borrower] = await ethers.getSigners();
  });

  async function deployPixCashierMock(): Promise<Contract> {
    const pixCashierMock: Contract = await pixCashierMockFactory.deploy();
    await pixCashierMock.deployed();

    return pixCashierMock;
  }

  async function deployLendingMarketMock(): Promise<Contract> {
    const lendingMarketMock: Contract = await lendingMarketMockFactory.deploy();
    await lendingMarketMock.deployed();

    return lendingMarketMock;
  }

  async function deployPixCreditAgent(): Promise<Contract> {
    const pixCreditAgent: Contract = await upgrades.deployProxy(pixCreditAgentFactory);
    await pixCreditAgent.deployed();

    return pixCreditAgent;
  }

  async function deployAndConfigurePixCreditAgent(): Promise<Contract> {
    const pixCreditAgent: Contract = await deployPixCreditAgent();
    await proveTx(pixCreditAgent.grantRole(adminRole, admin.address));
    await proveTx(pixCreditAgent.grantRole(managerRole, manager.address));
    await proveTx(pixCreditAgent.grantRole(pauserRole, deployer.address));

    return pixCreditAgent;
  }

  async function deployAndConfigureContracts(): Promise<Fixture> {
    const pixCashierMock = await deployPixCashierMock();
    const lendingMarketMock = await deployLendingMarketMock();
    const pixCreditAgent = await deployAndConfigurePixCreditAgent();

    await proveTx(pixCreditAgent.setPixCashier(pixCashierMock.address));
    await proveTx(pixCreditAgent.setLendingMarket(lendingMarketMock.address));
    const loanIdStub = await lendingMarketMock.LOAN_ID_STAB();

    return { pixCreditAgent, pixCashierMock, lendingMarketMock, loanIdStub };
  }

  async function deployAndConfigureContractsThenInitiateCredit(): Promise<{
    fixture: Fixture;
    pixTxId: string;
    initPixCredit: PixCredit;
    initCashOut: CashOut;
  }> {
    const fixture = await deployAndConfigureContracts();
    const { pixCreditAgent, pixCashierMock, lendingMarketMock } = fixture;
    const initPixCredit = definePixCredit();
    const pixTxId = PIX_TX_ID_STUB1;
    const initCashOut: CashOut = {
      ...initialCashOut,
      account: borrower.address,
      amount: initPixCredit.loanAmount
    };

    await proveTx(initiatePixCredit(pixCreditAgent, { pixTxId }));
    await proveTx(pixCashierMock.setCashOut(pixTxId, initCashOut));

    return { fixture, pixTxId, initPixCredit, initCashOut };
  }

  function definePixCredit(props: {
    borrowerAddress?: string,
    programId?: number,
    durationInPeriods?: number,
    status?: PixCreditStatus,
    loanAmount?: BigNumber,
    loanAddon?: BigNumber,
    loanId?: BigNumber,
  } = {}): PixCredit {
    const borrowerAddress: string = props.borrowerAddress ?? borrower.address;
    const programId: number = props.programId ?? LOAN_PROGRAM_ID_STUB;
    const durationInPeriods: number = props.durationInPeriods ?? LOAN_DURATION_IN_SECONDS_STUB;
    const status = props.status ?? PixCreditStatus.Nonexistent;
    const loanAmount = props.loanAmount ?? LOAN_AMOUNT_STUB;
    const loanAddon = props.loanAddon ?? LOAN_ADDON_STUB;
    const loanId = props.loanId ?? BIG_NUMBER_ZERO;
    return {
      borrower: borrowerAddress,
      programId,
      durationInPeriods,
      status,
      loanAmount,
      loanAddon,
      loanId
    };
  }

  function initiatePixCredit(pixCreditAgent: Contract, props: {
    pixTxId?: string;
    pixCredit?: PixCredit;
    caller?: SignerWithAddress
  } = {}): Promise<TransactionResponse> {
    const caller = props.caller ?? manager;
    const pixTxId = props.pixTxId ?? PIX_TX_ID_STUB1;
    const pixCredit = props.pixCredit ?? definePixCredit();
    return pixCreditAgent.connect(caller).initiatePixCredit(
      pixTxId,
      pixCredit.borrower,
      pixCredit.programId,
      pixCredit.durationInPeriods,
      pixCredit.loanAmount,
      pixCredit.loanAddon
    );
  }

  async function checkPixCreditInitiation(fixture: Fixture, props: {
    tx: Promise<TransactionResponse>;
    pixTxId: string;
    pixCredit: PixCredit;
  }) {
    const { pixCreditAgent, pixCashierMock } = fixture;
    const { tx, pixTxId, pixCredit } = props;
    await expect(tx).to.emit(pixCreditAgent, EVENT_NAME_PIX_CREDIT_STATUS_CHANGED).withArgs(
      pixTxId,
      pixCredit.borrower,
      PixCreditStatus.Initiated, // newStatus
      PixCreditStatus.Nonexistent, // oldStatus
      pixCredit.loanId,
      pixCredit.programId,
      pixCredit.durationInPeriods,
      pixCredit.loanAmount,
      pixCredit.loanAddon
    );
    await expect(tx).to.emit(pixCashierMock, EVENT_NAME_MOCK_CONFIGURE_CASH_OUT_HOOKS_CALLED).withArgs(
      pixTxId,
      pixCreditAgent.address, // newCallableContract,
      NEEDED_PIX_CASH_OUT_HOOK_FLAGS // newHookFlags
    );
    pixCredit.status = PixCreditStatus.Initiated;
    checkEquality(await pixCreditAgent.getPixCredit(pixTxId) as PixCredit, pixCredit);
  }

  describe("Function 'initialize()'", async () => {
    it("Configures the contract as expected", async () => {
      const pixCreditAgent = await setUpFixture(deployPixCreditAgent);

      // Role hashes
      expect(await pixCreditAgent.OWNER_ROLE()).to.equal(ownerRole);
      expect(await pixCreditAgent.PAUSER_ROLE()).to.equal(pauserRole);
      expect(await pixCreditAgent.RESCUER_ROLE()).to.equal(rescuerRole);
      expect(await pixCreditAgent.ADMIN_ROLE()).to.equal(adminRole);
      expect(await pixCreditAgent.MANAGER_ROLE()).to.equal(managerRole);

      // The role admins
      expect(await pixCreditAgent.getRoleAdmin(ownerRole)).to.equal(ownerRole);
      expect(await pixCreditAgent.getRoleAdmin(pauserRole)).to.equal(ownerRole);
      expect(await pixCreditAgent.getRoleAdmin(rescuerRole)).to.equal(ownerRole);
      expect(await pixCreditAgent.getRoleAdmin(adminRole)).to.equal(ownerRole);
      expect(await pixCreditAgent.getRoleAdmin(managerRole)).to.equal(ownerRole);

      // The deployer should have the owner role and admin role, but not the other roles
      expect(await pixCreditAgent.hasRole(ownerRole, deployer.address)).to.equal(true);
      expect(await pixCreditAgent.hasRole(adminRole, deployer.address)).to.equal(true);
      expect(await pixCreditAgent.hasRole(pauserRole, deployer.address)).to.equal(false);
      expect(await pixCreditAgent.hasRole(rescuerRole, deployer.address)).to.equal(false);
      expect(await pixCreditAgent.hasRole(managerRole, deployer.address)).to.equal(false);

      // The initial contract state is unpaused
      expect(await pixCreditAgent.paused()).to.equal(false);

      // The initial settings
      expect(await pixCreditAgent.pixCashier()).to.equal(ADDRESS_ZERO);
      expect(await pixCreditAgent.lendingMarket()).to.equal(ADDRESS_ZERO);
      checkEquality(await pixCreditAgent.agentState() as AgentState, initialAgentState);
    });

    it("Is reverted if it is called a second time", async () => {
      const pixCreditAgent = await setUpFixture(deployPixCreditAgent);
      await expect(
        pixCreditAgent.initialize()
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_ALREADY_INITIALIZED);
    });
  });

  describe("Function 'setPixCashier()'", async () => {
    it("Executes as expected in different cases", async () => {
      const pixCreditAgent = await setUpFixture(deployAndConfigurePixCreditAgent);
      const pixCashierStubAddress1 = borrower.address;
      const pixCashierStubAddress2 = admin.address;

      expect(await pixCreditAgent.pixCashier()).to.equal(ADDRESS_ZERO);

      // Change the initial configuration
      await expect(
        pixCreditAgent.connect(admin).setPixCashier(pixCashierStubAddress1)
      ).to.emit(
        pixCreditAgent,
        EVENT_NAME_PIX_CASHIER_CHANGED
      ).withArgs(
        pixCashierStubAddress1,
        ADDRESS_ZERO
      );
      expect(await pixCreditAgent.pixCashier()).to.equal(pixCashierStubAddress1);
      checkEquality(await pixCreditAgent.agentState() as AgentState, initialAgentState);

      // Change to a new non-zero address
      await expect(
        pixCreditAgent.connect(admin).setPixCashier(pixCashierStubAddress2)
      ).to.emit(
        pixCreditAgent,
        EVENT_NAME_PIX_CASHIER_CHANGED
      ).withArgs(
        pixCashierStubAddress2,
        pixCashierStubAddress1
      );
      expect(await pixCreditAgent.pixCashier()).to.equal(pixCashierStubAddress2);
      checkEquality(await pixCreditAgent.agentState() as AgentState, initialAgentState);

      // Set the zero address
      await expect(
        pixCreditAgent.connect(admin).setPixCashier(ADDRESS_ZERO)
      ).to.emit(
        pixCreditAgent,
        EVENT_NAME_PIX_CASHIER_CHANGED
      ).withArgs(
        ADDRESS_ZERO,
        pixCashierStubAddress2
      );
      expect(await pixCreditAgent.pixCashier()).to.equal(ADDRESS_ZERO);
      checkEquality(await pixCreditAgent.agentState() as AgentState, initialAgentState);

      // Set the lending market address, then the PIX cashier address to check the logic of configured status
      const lendingMarketStubAddress = borrower.address;
      await proveTx(pixCreditAgent.connect(admin).setLendingMarket(lendingMarketStubAddress));
      await proveTx(pixCreditAgent.connect(admin).setPixCashier(pixCashierStubAddress1));
      expect(await pixCreditAgent.pixCashier()).to.equal(pixCashierStubAddress1);
      const expectedAgentState = { ...initialAgentState, configured: true };
      checkEquality(await pixCreditAgent.agentState() as AgentState, expectedAgentState);

      // Set another PIX cashier address must not change the configured status of the agent contract
      await proveTx(pixCreditAgent.connect(admin).setPixCashier(pixCashierStubAddress2));
      expect(await pixCreditAgent.pixCashier()).to.equal(pixCashierStubAddress2);
      checkEquality(await pixCreditAgent.agentState() as AgentState, expectedAgentState);

      // Resetting the address must change the configured status appropriately
      await proveTx(pixCreditAgent.connect(admin).setPixCashier(ADDRESS_ZERO));
      expectedAgentState.configured = false;
      checkEquality(await pixCreditAgent.agentState() as AgentState, expectedAgentState);
    });

    it("Is reverted if the contract is paused", async () => {
      const pixCreditAgent = await setUpFixture(deployAndConfigurePixCreditAgent);
      const pixCashierMockAddress = borrower.address;

      await proveTx(pixCreditAgent.pause());
      await expect(
        pixCreditAgent.connect(admin).setPixCashier(pixCashierMockAddress)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the admin role", async () => {
      const pixCreditAgent = await setUpFixture(deployAndConfigurePixCreditAgent);
      const pixCashierMockAddress = borrower.address;

      await expect(
        pixCreditAgent.connect(manager).setPixCashier(pixCashierMockAddress)
      ).to.be.revertedWith(createRevertMessageDueToMissingRole(manager.address, adminRole));
    });

    it("Is reverted if the configuration is unchanged", async () => {
      const pixCreditAgent = await setUpFixture(deployAndConfigurePixCreditAgent);
      const pixCashierMockAddress = borrower.address;

      // Try to set the default value
      await expect(
        pixCreditAgent.connect(admin).setPixCashier(ADDRESS_ZERO)
      ).to.be.revertedWithCustomError(pixCreditAgent, REVERT_ERROR_IF_CONFIGURATION_UNCHANGED);


      // Try to set the same value twice
      await proveTx(pixCreditAgent.connect(admin).setPixCashier(pixCashierMockAddress));
      await expect(
        pixCreditAgent.connect(admin).setPixCashier(pixCashierMockAddress)
      ).to.be.revertedWithCustomError(pixCreditAgent, REVERT_ERROR_IF_CONFIGURATION_UNCHANGED);
    });

    // Additional more complex checks are in the other sections
  });

  describe("Function 'setLendingMarket()'", async () => {
    it("Executes as expected in different cases", async () => {
      const pixCreditAgent = await setUpFixture(deployAndConfigurePixCreditAgent);
      const lendingMarketStubAddress1 = borrower.address;
      const lendingMarketStubAddress2 = admin.address;

      expect(await pixCreditAgent.lendingMarket()).to.equal(ADDRESS_ZERO);

      // Change the initial configuration
      await expect(
        pixCreditAgent.connect(admin).setLendingMarket(lendingMarketStubAddress1)
      ).to.emit(
        pixCreditAgent,
        EVENT_NAME_LENDING_MARKET_CHANGED
      ).withArgs(
        lendingMarketStubAddress1,
        ADDRESS_ZERO
      );
      expect(await pixCreditAgent.lendingMarket()).to.equal(lendingMarketStubAddress1);
      checkEquality(await pixCreditAgent.agentState() as AgentState, initialAgentState);

      // Change to a new non-zero address
      await expect(
        pixCreditAgent.connect(admin).setLendingMarket(lendingMarketStubAddress2)
      ).to.emit(
        pixCreditAgent,
        EVENT_NAME_LENDING_MARKET_CHANGED
      ).withArgs(
        lendingMarketStubAddress2,
        lendingMarketStubAddress1
      );
      expect(await pixCreditAgent.lendingMarket()).to.equal(lendingMarketStubAddress2);
      checkEquality(await pixCreditAgent.agentState() as AgentState, initialAgentState);

      // Set the zero address
      await expect(
        pixCreditAgent.connect(admin).setLendingMarket(ADDRESS_ZERO)
      ).to.emit(
        pixCreditAgent,
        EVENT_NAME_LENDING_MARKET_CHANGED
      ).withArgs(
        ADDRESS_ZERO,
        lendingMarketStubAddress2
      );
      expect(await pixCreditAgent.lendingMarket()).to.equal(ADDRESS_ZERO);
      checkEquality(await pixCreditAgent.agentState() as AgentState, initialAgentState);

      // Set the PIX cashier address, then the lending market address to check the logic of configured status
      const pixCashierStubAddress = borrower.address;
      await proveTx(pixCreditAgent.connect(admin).setPixCashier(pixCashierStubAddress));
      await proveTx(pixCreditAgent.connect(admin).setLendingMarket(lendingMarketStubAddress1));
      expect(await pixCreditAgent.lendingMarket()).to.equal(lendingMarketStubAddress1);
      const expectedAgentState = { ...initialAgentState, configured: true };
      checkEquality(await pixCreditAgent.agentState() as AgentState, expectedAgentState);

      // Set another lending market address must not change the configured status of the agent contract
      await proveTx(pixCreditAgent.connect(admin).setLendingMarket(lendingMarketStubAddress2));
      expect(await pixCreditAgent.lendingMarket()).to.equal(lendingMarketStubAddress2);
      checkEquality(await pixCreditAgent.agentState() as AgentState, expectedAgentState);

      // Resetting the address must change the configured status appropriately
      await proveTx(pixCreditAgent.connect(admin).setLendingMarket(ADDRESS_ZERO));
      expectedAgentState.configured = false;
      checkEquality(await pixCreditAgent.agentState() as AgentState, expectedAgentState);

    });

    it("Is reverted if the contract is paused", async () => {
      const pixCreditAgent = await setUpFixture(deployAndConfigurePixCreditAgent);
      const lendingMarketMockAddress = borrower.address;

      await proveTx(pixCreditAgent.pause());
      await expect(
        pixCreditAgent.connect(admin).setLendingMarket(lendingMarketMockAddress)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the admin role", async () => {
      const pixCreditAgent = await setUpFixture(deployAndConfigurePixCreditAgent);
      const lendingMarketMockAddress = borrower.address;

      await expect(
        pixCreditAgent.connect(manager).setLendingMarket(lendingMarketMockAddress)
      ).to.be.revertedWith(createRevertMessageDueToMissingRole(manager.address, adminRole));
    });

    it("Is reverted if the configuration is unchanged", async () => {
      const pixCreditAgent = await setUpFixture(deployAndConfigurePixCreditAgent);
      const lendingMarketMockAddress = borrower.address;

      // Try to set the default value
      await expect(
        pixCreditAgent.connect(admin).setLendingMarket(ADDRESS_ZERO)
      ).to.be.revertedWithCustomError(pixCreditAgent, REVERT_ERROR_IF_CONFIGURATION_UNCHANGED);


      // Try to set the same value twice
      await proveTx(pixCreditAgent.connect(admin).setLendingMarket(lendingMarketMockAddress));
      await expect(
        pixCreditAgent.connect(admin).setLendingMarket(lendingMarketMockAddress)
      ).to.be.revertedWithCustomError(pixCreditAgent, REVERT_ERROR_IF_CONFIGURATION_UNCHANGED);
    });

    // Additional more complex checks are in the other sections
  });

  describe("Function 'initiatePixCredit()", async () => {
    describe("Executes as expected if", async () => {
      it("The 'loanAddon' value is not zero", async () => {
        const fixture = await setUpFixture(deployAndConfigureContracts);
        const pixCredit = definePixCredit({ loanAddon: LOAN_ADDON_STUB });
        const pixTxId = PIX_TX_ID_STUB1;
        const tx = initiatePixCredit(fixture.pixCreditAgent, { pixTxId, pixCredit });
        await checkPixCreditInitiation(fixture, { tx, pixTxId, pixCredit });
      });

      it("The 'loanAddon' value is zero", async () => {
        const fixture = await setUpFixture(deployAndConfigureContracts);
        const pixCredit = definePixCredit({ loanAddon: BIG_NUMBER_ZERO });
        const pixTxId = PIX_TX_ID_STUB1;
        const tx = initiatePixCredit(fixture.pixCreditAgent, { pixTxId, pixCredit });
        await checkPixCreditInitiation(fixture, { tx, pixTxId, pixCredit });
      });
    });

    describe("Is reverted if", async () => {
      it("The contract is paused", async () => {
        const { pixCreditAgent } = await setUpFixture(deployAndConfigureContracts);
        await proveTx(pixCreditAgent.pause());

        await expect(
          initiatePixCredit(pixCreditAgent)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
      });

      it("The caller does not have the manager role", async () => {
        const { pixCreditAgent } = await setUpFixture(deployAndConfigureContracts);

        await expect(
          initiatePixCredit(pixCreditAgent, { caller: deployer })
        ).to.be.revertedWith(createRevertMessageDueToMissingRole(deployer.address, managerRole));
      });

      it("The 'PixCashier' contract address is not configured", async () => {
        const { pixCreditAgent } = await setUpFixture(deployAndConfigureContracts);
        await proveTx(pixCreditAgent.setPixCashier(ADDRESS_ZERO));

        await expect(
          initiatePixCredit(pixCreditAgent)
        ).to.be.revertedWithCustomError(pixCreditAgent, REVERT_ERROR_IF_CONTRACT_NOT_CONFIGURED);
      });

      it("The 'LendingMarket' contract address is not configured", async () => {
        const { pixCreditAgent } = await setUpFixture(deployAndConfigureContracts);
        await proveTx(pixCreditAgent.setLendingMarket(ADDRESS_ZERO));

        await expect(
          initiatePixCredit(pixCreditAgent)
        ).to.be.revertedWithCustomError(pixCreditAgent, REVERT_ERROR_IF_CONTRACT_NOT_CONFIGURED);
      });

      it("The provided 'pixTxId' value is zero", async () => {
        const { pixCreditAgent } = await setUpFixture(deployAndConfigureContracts);
        const pixCredit = definePixCredit({});

        await expect(
          initiatePixCredit(pixCreditAgent, { pixTxId: PIX_TX_ID_ZERO, pixCredit })
        ).to.be.revertedWithCustomError(pixCreditAgent, REVERT_ERROR_IF_PIX_TX_ID_ZERO);
      });

      it("The provided borrower address is zero", async () => {
        const { pixCreditAgent } = await setUpFixture(deployAndConfigureContracts);
        const pixCredit = definePixCredit({ borrowerAddress: ADDRESS_ZERO });

        await expect(
          initiatePixCredit(pixCreditAgent, { pixCredit })
        ).to.be.revertedWithCustomError(pixCreditAgent, REVERT_ERROR_IF_BORROWER_ADDRESS_ZERO);
      });

      it("The provided program ID is zero", async () => {
        const { pixCreditAgent } = await setUpFixture(deployAndConfigureContracts);
        const pixCredit = definePixCredit({ programId: 0 });

        await expect(
          initiatePixCredit(pixCreditAgent, { pixCredit })
        ).to.be.revertedWithCustomError(pixCreditAgent, REVERT_ERROR_IF_PROGRAM_ID_ZERO);
      });

      it("The provided loan duration is zero", async () => {
        const { pixCreditAgent } = await setUpFixture(deployAndConfigureContracts);
        const pixCredit = definePixCredit({ durationInPeriods: 0 });

        await expect(
          initiatePixCredit(pixCreditAgent, { pixCredit })
        ).to.be.revertedWithCustomError(pixCreditAgent, REVERT_ERROR_IF_LOAN_DURATION_ZERO);
      });

      it("The provided loan amount is zero", async () => {
        const { pixCreditAgent } = await setUpFixture(deployAndConfigureContracts);
        const pixCredit = definePixCredit({ loanAmount: BIG_NUMBER_ZERO });

        await expect(
          initiatePixCredit(pixCreditAgent, { pixCredit })
        ).to.be.revertedWithCustomError(pixCreditAgent, REVERT_ERROR_IF_LOAN_AMOUNT_ZERO);
      });

      it("A PIX credit is already initiated for the provided PIX transaction ID", async () => {
        const { pixCreditAgent } = await setUpFixture(deployAndConfigureContracts);
        const pixCredit = definePixCredit();
        const pixTxId = PIX_TX_ID_STUB1;
        await proveTx(initiatePixCredit(pixCreditAgent, { pixTxId, pixCredit }));

        await expect(
          initiatePixCredit(pixCreditAgent, { pixTxId, pixCredit })
        ).to.be.revertedWithCustomError(
          pixCreditAgent,
          REVERT_ERROR_IF_PIX_CREDIT_STATUS_INAPPROPRIATE
        ).withArgs(
          pixTxId,
          PixCreditStatus.Initiated // status
        );
      });

      it("The 'programId' argument is greater than unsigned 32-bit integer", async () => {
        const { pixCreditAgent } = await setUpFixture(deployAndConfigureContracts);
        const pixCredit = definePixCredit({ programId: Math.pow(2, 32) });
        await expect(
          initiatePixCredit(pixCreditAgent, { pixCredit })
        ).to.be.revertedWithCustomError(
          pixCreditAgent,
          REVERT_ERROR_IF_SAFE_CAST_OVERFLOWED_UINT_DOWNCAST
        ).withArgs(32, pixCredit.programId);
      });

      it("The 'durationInPeriods' argument is greater than unsigned 32-bit integer", async () => {
        const { pixCreditAgent } = await setUpFixture(deployAndConfigureContracts);
        const pixCredit = definePixCredit({ durationInPeriods: Math.pow(2, 32) });
        await expect(
          initiatePixCredit(pixCreditAgent, { pixCredit })
        ).to.be.revertedWithCustomError(
          pixCreditAgent,
          REVERT_ERROR_IF_SAFE_CAST_OVERFLOWED_UINT_DOWNCAST
        ).withArgs(32, pixCredit.durationInPeriods);
      });

      it("The 'loanAmount' argument is greater than unsigned 64-bit integer", async () => {
        const { pixCreditAgent } = await setUpFixture(deployAndConfigureContracts);
        const pixCredit = definePixCredit({ loanAmount: BigNumber.from(2).pow(64) });
        await expect(
          initiatePixCredit(pixCreditAgent, { pixCredit })
        ).to.be.revertedWithCustomError(
          pixCreditAgent,
          REVERT_ERROR_IF_SAFE_CAST_OVERFLOWED_UINT_DOWNCAST
        ).withArgs(64, pixCredit.loanAmount);
      });

      it("The 'loanAddon' argument is greater than unsigned 64-bit integer", async () => {
        const { pixCreditAgent } = await setUpFixture(deployAndConfigureContracts);
        const pixCredit = definePixCredit({ loanAddon: BigNumber.from(2).pow(64) });
        await expect(
          initiatePixCredit(pixCreditAgent, { pixCredit })
        ).to.be.revertedWithCustomError(
          pixCreditAgent,
          REVERT_ERROR_IF_SAFE_CAST_OVERFLOWED_UINT_DOWNCAST
        ).withArgs(64, pixCredit.loanAddon);
      });

      // Additional more complex checks are in the other sections
    });
  });

  describe("Function 'revokePixCredit()", async () => {
    it("Executes as expected", async () => {
      const { pixCreditAgent, pixCashierMock } = await setUpFixture(deployAndConfigureContracts);
      const pixCredit = definePixCredit();
      const pixTxId = PIX_TX_ID_STUB1;
      await proveTx(initiatePixCredit(pixCreditAgent, { pixTxId }));

      const tx = pixCreditAgent.connect(manager).revokePixCredit(pixTxId);
      await expect(tx).to.emit(pixCreditAgent, EVENT_NAME_PIX_CREDIT_STATUS_CHANGED).withArgs(
        pixTxId,
        pixCredit.borrower,
        PixCreditStatus.Nonexistent, // newStatus
        PixCreditStatus.Initiated, // oldStatus
        pixCredit.loanId,
        pixCredit.programId,
        pixCredit.durationInPeriods,
        pixCredit.loanAmount,
        pixCredit.loanAddon
      );
      await expect(tx).to.emit(pixCashierMock, EVENT_NAME_MOCK_CONFIGURE_CASH_OUT_HOOKS_CALLED).withArgs(
        pixTxId,
        ADDRESS_ZERO, // newCallableContract,
        0 // newHookFlags
      );
      checkEquality(await pixCreditAgent.getPixCredit(pixTxId) as PixCredit, initialPixCredit);
    });

    it("Is reverted if the contract is paused", async () => {
      const { pixCreditAgent } = await setUpFixture(deployAndConfigureContracts);
      await proveTx(pixCreditAgent.pause());

      await expect(
        pixCreditAgent.connect(manager).revokePixCredit(PIX_TX_ID_STUB1)
      ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
    });

    it("Is reverted if the caller does not have the manager role", async () => {
      const { pixCreditAgent } = await setUpFixture(deployAndConfigureContracts);

      await expect(
        pixCreditAgent.connect(deployer).revokePixCredit(PIX_TX_ID_STUB1)
      ).to.be.revertedWith(createRevertMessageDueToMissingRole(deployer.address, managerRole));
    });

    it("Is reverted if the provided 'pixTxId' value is zero", async () => {
      const { pixCreditAgent } = await setUpFixture(deployAndConfigureContracts);

      await expect(
        pixCreditAgent.connect(manager).revokePixCredit(PIX_TX_ID_ZERO)
      ).to.be.revertedWithCustomError(pixCreditAgent, REVERT_ERROR_IF_PIX_TX_ID_ZERO);
    });


    it("Is reverted if the PIX credit does not exist", async () => {
      const { pixCreditAgent } = await setUpFixture(deployAndConfigureContracts);

      await expect(
        pixCreditAgent.connect(manager).revokePixCredit(PIX_TX_ID_STUB1)
      ).to.be.revertedWithCustomError(
        pixCreditAgent,
        REVERT_ERROR_IF_PIX_CREDIT_STATUS_INAPPROPRIATE
      ).withArgs(
        PIX_TX_ID_STUB1,
        PixCreditStatus.Nonexistent // status
      );
    });

    // Additional more complex checks are in the other sections
  });

  describe("Function 'pixHook()", async () => {
    async function checkPixHookCalling(fixture: Fixture, props: {
      pixTxId: string;
      pixCredit: PixCredit;
      hookIndex: HookIndex;
      newPixCreditStatus: PixCreditStatus;
      oldPixCreditStatus: PixCreditStatus;
    }) {
      const { pixCreditAgent, pixCashierMock, lendingMarketMock } = fixture;
      const { pixCredit, pixTxId, hookIndex, newPixCreditStatus, oldPixCreditStatus } = props;

      let tx = pixCashierMock.callPixHook(pixCreditAgent.address, hookIndex, pixTxId);

      pixCredit.status = newPixCreditStatus;

      if (oldPixCreditStatus !== newPixCreditStatus) {
        await expect(tx).to.emit(pixCreditAgent, EVENT_NAME_PIX_CREDIT_STATUS_CHANGED).withArgs(
          pixTxId,
          pixCredit.borrower,
          newPixCreditStatus,
          oldPixCreditStatus,
          pixCredit.loanId,
          pixCredit.programId,
          pixCredit.durationInPeriods,
          pixCredit.loanAmount,
          pixCredit.loanAddon
        );
        if (newPixCreditStatus == PixCreditStatus.Pending) {
          await expect(tx).to.emit(lendingMarketMock, EVENT_NAME_MOCK_TAKE_LOAN_FOR_CALLED).withArgs(
            pixCredit.borrower,
            pixCredit.programId,
            pixCredit.loanAmount, // borrowAmount,
            pixCredit.loanAddon, // addonAmount,
            pixCredit.durationInPeriods
          );
        } else {
          await expect(tx).not.to.emit(lendingMarketMock, EVENT_NAME_MOCK_TAKE_LOAN_FOR_CALLED);
        }

        if (newPixCreditStatus == PixCreditStatus.Reversed) {
          await expect(tx).to.emit(lendingMarketMock, EVENT_NAME_MOCK_REVOKE_LOAN_CALLED).withArgs(pixCredit.loanId);
        } else {
          await expect(tx).not.to.emit(lendingMarketMock, EVENT_NAME_MOCK_REVOKE_LOAN_CALLED);
        }
      } else {
        await expect(tx).not.to.emit(pixCreditAgent, EVENT_NAME_PIX_CREDIT_STATUS_CHANGED);
      }

      checkEquality(await pixCreditAgent.getPixCredit(pixTxId) as PixCredit, pixCredit);
    }

    describe("Executes as expected if", async () => {
      it("The a PIX cash-out requested and then confirmed with other proper conditions", async () => {
        const { fixture, pixTxId, initPixCredit } = await setUpFixture(deployAndConfigureContractsThenInitiateCredit);
        const expectedAgentState: AgentState = {
          ...initialAgentState,
          initiatedCreditCounter: BIG_NUMBER_ONE,
          configured: true
        };
        checkEquality(await fixture.pixCreditAgent.agentState() as AgentState, expectedAgentState);
        const pixCredit: PixCredit = { ...initPixCredit, loanId: fixture.loanIdStub };

        // Emulate PIX cash-out request
        await checkPixHookCalling(
          fixture,
          {
            pixTxId,
            pixCredit,
            hookIndex: HookIndex.CashOutRequestBefore,
            newPixCreditStatus: PixCreditStatus.Pending,
            oldPixCreditStatus: PixCreditStatus.Initiated
          }
        );
        expectedAgentState.initiatedCreditCounter = BIG_NUMBER_ZERO;
        expectedAgentState.pendingCreditCounter = BIG_NUMBER_ONE;
        checkEquality(await fixture.pixCreditAgent.agentState() as AgentState, expectedAgentState);

        // Emulate an unexpected hook call
        await checkPixHookCalling(
          fixture,
          {
            pixTxId,
            pixCredit,
            hookIndex: HookIndex.Unused,
            newPixCreditStatus: PixCreditStatus.Pending,
            oldPixCreditStatus: PixCreditStatus.Pending
          }
        );
        checkEquality(await fixture.pixCreditAgent.agentState() as AgentState, expectedAgentState);

        // Emulate PIX cash-out confirmation
        await checkPixHookCalling(
          fixture,
          {
            pixTxId,
            pixCredit,
            hookIndex: HookIndex.CashOutConfirmationAfter,
            newPixCreditStatus: PixCreditStatus.Confirmed,
            oldPixCreditStatus: PixCreditStatus.Pending
          }
        );
        expectedAgentState.pendingCreditCounter = BIG_NUMBER_ZERO;
        expectedAgentState.processedCreditCounter = BIG_NUMBER_ONE;
        checkEquality(await fixture.pixCreditAgent.agentState() as AgentState, expectedAgentState);

        // Emulate an unexpected hook call
        await checkPixHookCalling(
          fixture,
          {
            pixTxId,
            pixCredit,
            hookIndex: HookIndex.Unused,
            newPixCreditStatus: PixCreditStatus.Confirmed,
            oldPixCreditStatus: PixCreditStatus.Confirmed
          }
        );
        checkEquality(await fixture.pixCreditAgent.agentState() as AgentState, expectedAgentState);
      });

      it("The a PIX cash-out requested and then reversed with other proper conditions", async () => {
        const { fixture, pixTxId, initPixCredit } = await setUpFixture(deployAndConfigureContractsThenInitiateCredit);
        const pixCredit: PixCredit = { ...initPixCredit, loanId: fixture.loanIdStub };

        // Emulate PIX cash-out request
        await checkPixHookCalling(
          fixture,
          {
            pixTxId,
            pixCredit,
            hookIndex: HookIndex.CashOutRequestBefore,
            newPixCreditStatus: PixCreditStatus.Pending,
            oldPixCreditStatus: PixCreditStatus.Initiated
          }
        );
        const expectedAgentState: AgentState = {
          ...initialAgentState,
          pendingCreditCounter: BIG_NUMBER_ONE,
          configured: true
        };
        checkEquality(await fixture.pixCreditAgent.agentState() as AgentState, expectedAgentState);

        // Emulate PIX cash-out reversal
        await checkPixHookCalling(
          fixture,
          {
            pixTxId,
            pixCredit,
            hookIndex: HookIndex.CashOutReversalAfter,
            newPixCreditStatus: PixCreditStatus.Reversed,
            oldPixCreditStatus: PixCreditStatus.Pending
          }
        );
        expectedAgentState.pendingCreditCounter = BIG_NUMBER_ZERO;
        expectedAgentState.processedCreditCounter = BIG_NUMBER_ONE;
        checkEquality(await fixture.pixCreditAgent.agentState() as AgentState, expectedAgentState);

        // Emulate an unexpected hook call
        await checkPixHookCalling(
          fixture,
          {
            pixTxId,
            pixCredit,
            hookIndex: HookIndex.Unused,
            newPixCreditStatus: PixCreditStatus.Reversed,
            oldPixCreditStatus: PixCreditStatus.Reversed
          }
        );
        checkEquality(await fixture.pixCreditAgent.agentState() as AgentState, expectedAgentState);
      });
    });

    describe("Is reverted if", async () => {
      async function checkPixHookInappropriateStatusError(fixture: Fixture, props: {
        pixTxId: string;
        hookIndex: HookIndex;
        pixCreditStatus: PixCreditStatus;
      }) {
        const { pixCreditAgent, pixCashierMock } = fixture;
        const { pixTxId, hookIndex, pixCreditStatus } = props;
        await expect(
          pixCashierMock.callPixHook(pixCreditAgent.address, hookIndex, PIX_TX_ID_STUB1)
        ).to.be.revertedWithCustomError(
          pixCreditAgent,
          REVERT_ERROR_IF_PIX_CREDIT_STATUS_INAPPROPRIATE
        ).withArgs(
          pixTxId,
          pixCreditStatus // status
        );
      }

      it("The contract is paused", async () => {
        const { fixture } = await setUpFixture(deployAndConfigureContractsThenInitiateCredit);
        const { pixCreditAgent, pixCashierMock } = fixture;
        const hookIndex = HookIndex.CashOutRequestBefore;
        await proveTx(pixCreditAgent.pause());

        await expect(
          pixCashierMock.callPixHook(pixCreditAgent.address, hookIndex, PIX_TX_ID_STUB1)
        ).to.be.revertedWith(REVERT_MESSAGE_IF_CONTRACT_IS_PAUSED);
      });

      it("The caller is not the configured 'PixCashier' contract", async () => {
        const { fixture } = await setUpFixture(deployAndConfigureContractsThenInitiateCredit);
        const { pixCreditAgent } = fixture;
        const hookIndex = HookIndex.CashOutRequestBefore;

        await expect(
          pixCreditAgent.connect(deployer).pixHook(hookIndex, PIX_TX_ID_STUB1)
        ).to.be.revertedWithCustomError(pixCreditAgent, REVERT_ERROR_IF_PIX_HOOK_CALLER_UNAUTHORIZED);
      });

      it("The PIX credit status is inappropriate to the provided hook index. Part 1", async () => {
        const { fixture, pixTxId } = await setUpFixture(deployAndConfigureContractsThenInitiateCredit);
        const { pixCreditAgent, pixCashierMock } = fixture;

        // Try for a PIX credit with the initiated status
        await checkPixHookInappropriateStatusError(fixture, {
          pixTxId,
          hookIndex: HookIndex.CashOutConfirmationAfter,
          pixCreditStatus: PixCreditStatus.Initiated
        });
        await checkPixHookInappropriateStatusError(fixture, {
          pixTxId,
          hookIndex: HookIndex.CashOutReversalAfter,
          pixCreditStatus: PixCreditStatus.Initiated
        });

        // Try for a PIX credit with the pending status
        await proveTx(pixCashierMock.callPixHook(pixCreditAgent.address, HookIndex.CashOutRequestBefore, pixTxId));
        await checkPixHookInappropriateStatusError(fixture, {
          pixTxId,
          hookIndex: HookIndex.CashOutRequestBefore,
          pixCreditStatus: PixCreditStatus.Pending
        });

        // Try for a PIX credit with the confirmed status
        await proveTx(pixCashierMock.callPixHook(pixCreditAgent.address, HookIndex.CashOutConfirmationAfter, pixTxId));
        await checkPixHookInappropriateStatusError(fixture, {
          pixTxId,
          hookIndex: HookIndex.CashOutRequestBefore,
          pixCreditStatus: PixCreditStatus.Confirmed
        });
        await checkPixHookInappropriateStatusError(fixture, {
          pixTxId,
          hookIndex: HookIndex.CashOutConfirmationAfter,
          pixCreditStatus: PixCreditStatus.Confirmed
        });
        await checkPixHookInappropriateStatusError(fixture, {
          pixTxId,
          hookIndex: HookIndex.CashOutReversalAfter,
          pixCreditStatus: PixCreditStatus.Confirmed
        });
      });

      it("The PIX credit status is inappropriate to the provided hook index. Part 2", async () => {
        const { fixture, pixTxId } = await setUpFixture(deployAndConfigureContractsThenInitiateCredit);
        const { pixCreditAgent, pixCashierMock } = fixture;

        // Try for a PIX credit with the reversed status
        await proveTx(pixCashierMock.callPixHook(pixCreditAgent.address, HookIndex.CashOutRequestBefore, pixTxId));
        await proveTx(pixCashierMock.callPixHook(pixCreditAgent.address, HookIndex.CashOutReversalAfter, pixTxId));
        await checkPixHookInappropriateStatusError(fixture, {
          pixTxId,
          hookIndex: HookIndex.CashOutRequestBefore,
          pixCreditStatus: PixCreditStatus.Reversed
        });
        await checkPixHookInappropriateStatusError(fixture, {
          pixTxId,
          hookIndex: HookIndex.CashOutConfirmationAfter,
          pixCreditStatus: PixCreditStatus.Reversed
        });
        await checkPixHookInappropriateStatusError(fixture, {
          pixTxId,
          hookIndex: HookIndex.CashOutReversalAfter,
          pixCreditStatus: PixCreditStatus.Reversed
        });
      });

      it("The PIX cash-out account is not match the PIX credit borrower before taking a loan", async () => {
        const { fixture, pixTxId, initCashOut } = await setUpFixture(deployAndConfigureContractsThenInitiateCredit);
        const { pixCreditAgent, pixCashierMock } = fixture;
        const cashOut: CashOut = {
          ...initCashOut,
          account: deployer.address,
        };
        await proveTx(pixCashierMock.setCashOut(pixTxId, cashOut));

        await expect(
          pixCashierMock.callPixHook(pixCreditAgent.address, HookIndex.CashOutRequestBefore, pixTxId)
        ).to.revertedWithCustomError(
          pixCreditAgent,
          REVERT_ERROR_IF_PIX_CASH_OUT_INAPPROPRIATE
        ).withArgs(pixTxId);
      });

      it("The PIX cash-out amount is not match the PIX credit amount before taking a loan", async () => {
        const { fixture, pixTxId, initCashOut } = await setUpFixture(deployAndConfigureContractsThenInitiateCredit);
        const { pixCreditAgent, pixCashierMock } = fixture;
        const cashOut: CashOut = {
          ...initCashOut,
          amount: initCashOut.amount.and(1),
        };
        await proveTx(pixCashierMock.setCashOut(pixTxId, cashOut));

        await expect(
          pixCashierMock.callPixHook(pixCreditAgent.address, HookIndex.CashOutRequestBefore, pixTxId)
        ).to.revertedWithCustomError(
          pixCreditAgent,
          REVERT_ERROR_IF_PIX_CASH_OUT_INAPPROPRIATE
        ).withArgs(pixTxId);
      });
    });
  });

  describe("Complex scenarios", async () => {
    it("A revoked PIX credit can be re-initiated", async () => {
      const { fixture, pixTxId, initPixCredit } = await setUpFixture(deployAndConfigureContractsThenInitiateCredit);
      const { pixCreditAgent } = fixture;
      const expectedAgentState: AgentState = {
        ...initialAgentState,
        initiatedCreditCounter: BIG_NUMBER_ONE,
        configured: true
      };
      const pixCredit: PixCredit = { ...initPixCredit };
      checkEquality(await fixture.pixCreditAgent.agentState() as AgentState, expectedAgentState);

      await proveTx(pixCreditAgent.connect(manager).revokePixCredit(pixTxId));
      expectedAgentState.initiatedCreditCounter = BIG_NUMBER_ZERO;
      checkEquality(await fixture.pixCreditAgent.agentState() as AgentState, expectedAgentState);

      const tx = initiatePixCredit(pixCreditAgent, { pixTxId, pixCredit });
      await checkPixCreditInitiation(fixture, { tx, pixTxId, pixCredit });
      expectedAgentState.initiatedCreditCounter = BIG_NUMBER_ONE;
      checkEquality(await fixture.pixCreditAgent.agentState() as AgentState, expectedAgentState);
    });

    it("A reversed PIX credit can be re-initiated", async () => {
      const { fixture, pixTxId, initPixCredit } = await setUpFixture(deployAndConfigureContractsThenInitiateCredit);
      const { pixCreditAgent, pixCashierMock, lendingMarketMock } = fixture;
      const pixCredit: PixCredit = { ...initPixCredit };

      await proveTx(pixCashierMock.callPixHook(pixCreditAgent.address, HookIndex.CashOutRequestBefore, pixTxId));
      await proveTx(pixCashierMock.callPixHook(pixCreditAgent.address, HookIndex.CashOutReversalAfter, pixTxId));

      const tx = initiatePixCredit(pixCreditAgent, { pixTxId, pixCredit });
      await checkPixCreditInitiation(fixture, { tx, pixTxId, pixCredit });
      const expectedAgentState: AgentState = {
        initiatedCreditCounter: BIG_NUMBER_ONE,
        pendingCreditCounter: BIG_NUMBER_ZERO,
        processedCreditCounter: BIG_NUMBER_ONE,
        configured: true
      };
      checkEquality(await fixture.pixCreditAgent.agentState() as AgentState, expectedAgentState);
    });

    it("A pending or confirmed PIX credit cannot be re-initiated", async () => {
      const { fixture, pixTxId, initPixCredit } = await setUpFixture(deployAndConfigureContractsThenInitiateCredit);
      const { pixCreditAgent, pixCashierMock, lendingMarketMock } = fixture;
      const pixCredit: PixCredit = { ...initPixCredit };

      // Try for a PIX credit with the pending status
      await proveTx(pixCashierMock.callPixHook(pixCreditAgent.address, HookIndex.CashOutRequestBefore, pixTxId));
      await expect(
        initiatePixCredit(pixCreditAgent, { pixTxId, pixCredit })
      ).to.be.revertedWithCustomError(
        pixCreditAgent,
        REVERT_ERROR_IF_PIX_CREDIT_STATUS_INAPPROPRIATE
      ).withArgs(
        pixTxId,
        PixCreditStatus.Pending // status
      );

      // Try for a PIX credit with the confirmed status
      await proveTx(pixCashierMock.callPixHook(pixCreditAgent.address, HookIndex.CashOutConfirmationAfter, pixTxId));
      await expect(
        initiatePixCredit(pixCreditAgent, { pixTxId, pixCredit })
      ).to.be.revertedWithCustomError(
        pixCreditAgent,
        REVERT_ERROR_IF_PIX_CREDIT_STATUS_INAPPROPRIATE
      ).withArgs(
        pixTxId,
        PixCreditStatus.Confirmed // status
      );
    });

    it("A PIX credit with any status except initiated cannot be revoked", async () => {
      const { fixture, pixTxId, initPixCredit } = await setUpFixture(deployAndConfigureContractsThenInitiateCredit);
      const { pixCreditAgent, pixCashierMock, lendingMarketMock } = fixture;
      const pixCredit: PixCredit = { ...initPixCredit };

      // Try for a PIX credit with the pending status
      await proveTx(pixCashierMock.callPixHook(pixCreditAgent.address, HookIndex.CashOutRequestBefore, pixTxId));
      await expect(
        pixCreditAgent.connect(manager).revokePixCredit(pixTxId)
      ).to.be.revertedWithCustomError(
        pixCreditAgent,
        REVERT_ERROR_IF_PIX_CREDIT_STATUS_INAPPROPRIATE
      ).withArgs(
        pixTxId,
        PixCreditStatus.Pending // status
      );

      // Try for a PIX credit with the reversed status
      await proveTx(pixCashierMock.callPixHook(pixCreditAgent.address, HookIndex.CashOutReversalAfter, pixTxId));
      await expect(
        pixCreditAgent.connect(manager).revokePixCredit(pixTxId)
      ).to.be.revertedWithCustomError(
        pixCreditAgent,
        REVERT_ERROR_IF_PIX_CREDIT_STATUS_INAPPROPRIATE
      ).withArgs(
        pixTxId,
        PixCreditStatus.Reversed // status
      );

      // Try for a PIX credit with the confirmed status
      await proveTx(initiatePixCredit(pixCreditAgent, { pixTxId, pixCredit }));
      await proveTx(pixCashierMock.callPixHook(pixCreditAgent.address, HookIndex.CashOutRequestBefore, pixTxId));
      await proveTx(pixCashierMock.callPixHook(pixCreditAgent.address, HookIndex.CashOutConfirmationAfter, pixTxId));
      await expect(
        pixCreditAgent.connect(manager).revokePixCredit(pixTxId)
      ).to.be.revertedWithCustomError(
        pixCreditAgent,
        REVERT_ERROR_IF_PIX_CREDIT_STATUS_INAPPROPRIATE
      ).withArgs(
        pixTxId,
        PixCreditStatus.Confirmed // status
      );
    });

    it("Configuring is prohibited when not all PIX credits are processed", async () => {
      const { fixture, pixTxId, initPixCredit } = await setUpFixture(deployAndConfigureContractsThenInitiateCredit);
      const { pixCreditAgent, pixCashierMock, lendingMarketMock } = fixture;
      const pixCredit: PixCredit = { ...initPixCredit };

      async function checkConfiguringProhibition() {
        await expect(
          pixCreditAgent.connect(admin).setPixCashier(ADDRESS_ZERO)
        ).to.be.revertedWithCustomError(pixCreditAgent, REVERT_ERROR_IF_CONFIGURING_PROHIBITED);
        await expect(
          pixCreditAgent.connect(admin).setLendingMarket(ADDRESS_ZERO)
        ).to.be.revertedWithCustomError(pixCreditAgent, REVERT_ERROR_IF_CONFIGURING_PROHIBITED);
      }

      async function checkConfiguringAllowance() {
        await proveTx(pixCreditAgent.connect(admin).setPixCashier(ADDRESS_ZERO));
        await proveTx(pixCreditAgent.connect(admin).setLendingMarket(ADDRESS_ZERO));
        await proveTx(pixCreditAgent.connect(admin).setPixCashier(pixCashierMock.address));
        await proveTx(pixCreditAgent.connect(admin).setLendingMarket(lendingMarketMock.address));
      }

      // Configuring is prohibited if a PIX credit is initiated
      await checkConfiguringProhibition();

      // Configuring is allowed when no PIX credit is initiated
      await proveTx(pixCreditAgent.connect(manager).revokePixCredit(pixTxId));
      await checkConfiguringAllowance();

      // Configuring is prohibited if a PIX credit is pending
      await proveTx(initiatePixCredit(pixCreditAgent, { pixTxId, pixCredit }));
      await proveTx(pixCashierMock.callPixHook(pixCreditAgent.address, HookIndex.CashOutRequestBefore, pixTxId));
      await checkConfiguringProhibition();

      // Configuring is allowed if a PIX credit is reversed and no more active PIX credits exist
      await proveTx(pixCashierMock.callPixHook(pixCreditAgent.address, HookIndex.CashOutReversalAfter, pixTxId));
      await checkConfiguringAllowance();

      // Configuring is prohibited if a PIX credit is initiated
      await proveTx(initiatePixCredit(pixCreditAgent, { pixTxId, pixCredit }));
      await checkConfiguringProhibition();

      // Configuring is allowed if PIX credits are reversed or confirmed and no more active PIX credits exist
      await proveTx(pixCashierMock.callPixHook(pixCreditAgent.address, HookIndex.CashOutRequestBefore, pixTxId));
      await proveTx(pixCashierMock.callPixHook(pixCreditAgent.address, HookIndex.CashOutConfirmationAfter, pixTxId));
      await checkConfiguringAllowance();
    });
  });
});
