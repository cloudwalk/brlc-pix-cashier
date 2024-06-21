// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { PausableExtUpgradeable } from "./base/PausableExtUpgradeable.sol";
import { RescuableUpgradeable } from "./base/RescuableUpgradeable.sol";
import { AccessControlExtUpgradeable } from "./base/AccessControlExtUpgradeable.sol";

import { PixCreditAgentStorage } from "./PixCreditAgentStorage.sol";
import { SafeCast } from "./libraries/SafeCast.sol";

import { IPixCashier } from "./interfaces/IPixCashier.sol";
import { IPixCreditAgent } from "./interfaces/IPixCreditAgent.sol";
import { IPixHook } from "./interfaces/IPixHook.sol";
import { IPixHookable } from "./interfaces/IPixHookable.sol";
import { IPixHookableTypes } from "./interfaces/IPixHookable.sol";
import { ILendingMarket } from "./interfaces/ILendingMarket.sol";

/**
 * @title PixCashier contract
 * @dev Wrapper contract for PIX cash-in and cash-out operations.
 *
 * Only accounts that have {CASHIER_ROLE} role can execute the cash-in operations and process the cash-out operations.
 * About roles see https://docs.openzeppelin.com/contracts/4.x/api/access#AccessControl.
 */
contract PixCreditAgent is
    PixCreditAgentStorage,
    AccessControlExtUpgradeable,
    PausableExtUpgradeable,
    RescuableUpgradeable,
    IPixCreditAgent,
    IPixHook
{
    using SafeCast for uint256;

    // ------------------ Constants ------------------------------- //

    /// @dev The role of this contract owner.
    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");

    /// @dev The role of admin that is allowed to configure the contract.
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    /// @dev The role of manager that is allowed to initialize and cancel PIX credit operations.
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    /// @dev TODO
    uint256 private constant NEEDED_PIX_CASH_OUT_HOOK_FLAGS =
        (1 << uint256(IPixHookableTypes.HookIndex.CashOutRequestBefore)) +
        (1 << uint256(IPixHookableTypes.HookIndex.CashOutConfirmationAfter)) +
        (1 << uint256(IPixHookableTypes.HookIndex.CashOutReversalAfter));

    // ------------------ Errors ---------------------------------- //

    /// @dev The zero contract address has been passed as a function argument.
    error ContractAddressZero();

    /// @dev The zero PIX off-chain transaction identifier has been passed as a function argument.
    error PixTxIdZero();

    /// @dev The zero borrower address has been passed as a function argument.
    error BorrowerAddressZero();

    /// @dev The zero loan amount has been passed as a function argument.
    error LoanAmountZero();

    /// @dev The zero loan duration has been passed as a function argument.
    error LoanDurationZero();

    /**
     * @dev The related PIX credit has inappropriate status to execute the requested operation.
     * @param pixTxId The PIX off-chain transaction identifiers of the operation.
     * @param status The current status of the credit.
     */
    error PixCreditStatusInappropriate(bytes32 pixTxId, PixCreditStatus status);

    /// @dev The related PIX cash-out operation has inappropriate parameters (e.g. account, amount values).
    error PixCashOutInappropriate(bytes32 pixTxId);

    /// @dev Configuring is prohibited due to at least one unprocessed PIX credit exists or other conditions.
    error ConfiguringProhibited();

    /// @dev The value of a configuration parameter is the same as previously set one.
    error ConfigurationUnchanged();

    /// @dev TODO
    error PixHookCallerUnauthorized(address caller);

    // ------------------ Initializers ---------------------------- //

    /**
     * @dev The initialize function of the upgradable contract.
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable
     */
    function initialize() external initializer {
        __PixCreditAgent_init();
    }

    function __PixCreditAgent_init() internal onlyInitializing {
        __Context_init_unchained();
        __ERC165_init_unchained();
        __AccessControl_init_unchained();
        __AccessControlExt_init_unchained();
        __Pausable_init_unchained();
        __PausableExt_init_unchained(OWNER_ROLE);
        __Rescuable_init_unchained(OWNER_ROLE);

        __PixCreditAgent_init_unchained();
    }

    function __PixCreditAgent_init_unchained() internal onlyInitializing {
        _setRoleAdmin(OWNER_ROLE, OWNER_ROLE);
        _setRoleAdmin(ADMIN_ROLE, OWNER_ROLE);
        _setRoleAdmin(MANAGER_ROLE, OWNER_ROLE);

        _grantRole(OWNER_ROLE, _msgSender());
        _grantRole(ADMIN_ROLE, _msgSender());
    }

    // ------------------ Functions ------------------------------- //

    /// @dev TODO
    function setPixCashier(address newPixCashier) external whenNotPaused onlyRole(ADMIN_ROLE) {
        _checkConfiguringPermission();
        address oldPixCashier = _pixCashier;
        if (oldPixCashier == newPixCashier) {
            revert ConfigurationUnchanged();
        }
        if (newPixCashier == address(0)) {
            revert ContractAddressZero();
        }

        _pixCashier = newPixCashier;

        emit PixCashierChanged(newPixCashier, oldPixCashier);
    }

    /// @dev TODO
    function setLendingMarket(address newLendingMarket) external whenNotPaused onlyRole(ADMIN_ROLE) {
        _checkConfiguringPermission();
        address oldLendingMarket = _lendingMarket;
        if (oldLendingMarket == newLendingMarket) {
            revert ConfigurationUnchanged();
        }
        if (newLendingMarket == address(0)) {
            revert ContractAddressZero();
        }

        _lendingMarket = newLendingMarket;

        emit LendingMarketChanged(newLendingMarket, oldLendingMarket);
    }

    /// @dev TODO
    function initiatePixCredit(
        bytes32 pixTxId,
        address borrower,
        uint256 programId,
        uint256 durationInPeriods,
        uint256 loanAmount,
        uint256 loanAddon
    ) external whenNotPaused onlyRole(MANAGER_ROLE) {
        if (pixTxId == bytes32(0)) {
            revert PixTxIdZero();
        }
        if (borrower == address(0)) {
            revert BorrowerAddressZero();
        }
        if (loanAmount == 0) {
            revert LoanAmountZero();
        }
        if (durationInPeriods == 0) {
            revert LoanDurationZero();
        }

        PixCredit storage pixCredit = _pixCredits[pixTxId];
        if (pixCredit.status != PixCreditStatus.Nonexistent || pixCredit.status != PixCreditStatus.Reversed) {
            revert PixCreditStatusInappropriate(pixTxId, pixCredit.status);
        }

        IPixHookable(_pixCashier).configureCashOutHooks(pixTxId, address(this), NEEDED_PIX_CASH_OUT_HOOK_FLAGS);

        pixCredit.borrower = borrower;
        pixCredit.programId = programId.toUint32();
        pixCredit.loanAmount = loanAmount.toUint64();
        pixCredit.loanAddon = loanAddon.toUint64();
        pixCredit.durationInPeriods = durationInPeriods.toUint32();

        if (pixCredit.loanId != 0) {
            pixCredit.loanId = 0;
        }

        _changePixCreditStatus(
            pixTxId,
            pixCredit,
            PixCreditStatus.Initiated, // newStatus
            PixCreditStatus.Nonexistent // oldStatus
        );
    }

    /// @dev TODO
    function revokePixCredit(bytes32 pixTxId) external whenNotPaused onlyRole(MANAGER_ROLE) {
        if (pixTxId == bytes32(0)) {
            revert PixTxIdZero();
        }
        PixCredit storage pixCredit = _pixCredits[pixTxId];
        if (pixCredit.status != PixCreditStatus.Initiated) {
            revert PixCreditStatusInappropriate(pixTxId, pixCredit.status);
        }

        IPixHookable(_pixCashier).configureCashOutHooks(pixTxId, address(this), 0);

        _changePixCreditStatus(
            pixTxId,
            pixCredit,
            PixCreditStatus.Nonexistent, // newStatus
            PixCreditStatus.Initiated // oldStatus
        );

        delete _pixCredits[pixTxId];
    }

    /// @dev TODO
    function pixHook(uint256 hookIndex, bytes32 txId) external whenNotPaused {
        _checkPixHookCaller();
        if (hookIndex == uint256(IPixHookableTypes.HookIndex.CashOutRequestBefore)) {
            _processPixHookCashOutRequestBefore(txId);
        } else if (hookIndex == uint256(IPixHookableTypes.HookIndex.CashOutConfirmationAfter)) {
            _processPixHookCashOutConfirmationAfter(txId);
        } else if (hookIndex == uint256(IPixHookableTypes.HookIndex.CashOutReversalAfter)) {
            _processPixHookCashOutReversalAfter(txId);
        }
    }

    // ------------------ View functions -------------------------- //

    /// @dev TODO
    function pixCashier() external view returns (address) {
        return _pixCashier;
    }

    /// @dev TODO
    function lendingMarket() external view returns (address) {
        return _lendingMarket;
    }

    /// @dev TODO
    function getPixCredit(bytes32 pixTxId) external view returns (PixCredit memory) {
        return _pixCredits[pixTxId];
    }

    /// @dev TODO
    function pixCreditCounters() external view returns (PixCreditCounters memory) {
        return _pixCreditCounters;
    }

    // ------------------ Internal functions ---------------------- //

    /// @dev TODO
    function _checkConfiguringPermission() internal view {
        if (_pixCreditCounters.initiated > 0 || _pixCreditCounters.pending > 0) {
            revert ConfiguringProhibited();
        }
    }

    /// @dev TODO
    function _changePixCreditStatus(
        bytes32 pixTxId,
        PixCredit storage pixCredit,
        PixCreditStatus newStatus,
        PixCreditStatus oldStatus
    ) internal {
        emit PixCreditStatusChanged(
            pixTxId,
            pixCredit.borrower,
            newStatus,
            oldStatus,
            pixCredit.loanId,
            pixCredit.programId,
            pixCredit.durationInPeriods,
            pixCredit.loanAmount,
            pixCredit.loanAddon
        );

        unchecked {
            if (oldStatus == PixCreditStatus.Initiated) {
                _pixCreditCounters.initiated -= uint64(1);
            }
            else if (oldStatus == PixCreditStatus.Pending) {
                _pixCreditCounters.pending -= uint64(1);
            }
        }

        if (newStatus == PixCreditStatus.Initiated) {
            _pixCreditCounters.initiated += uint64(1);
        } else if (newStatus == PixCreditStatus.Pending) {
            _pixCreditCounters.pending += uint64(1);
        } else if (newStatus == PixCreditStatus.Confirmed || newStatus == PixCreditStatus.Reversed) {
            _pixCreditCounters.processed += uint64(1);
        } else {
            return;
        }

        pixCredit.status = newStatus;
    }

    /// @dev TODO
    function _processPixHookCashOutRequestBefore(bytes32 pixTxId) internal {
        PixCredit storage pixCredit = _pixCredits[pixTxId];
        if (pixCredit.status != PixCreditStatus.Initiated) {
            revert PixCreditStatusInappropriate(pixTxId, pixCredit.status);
        }

        address borrower = pixCredit.borrower;
        uint256 loanAmount = pixCredit.loanAmount;

        _checkPixCashOutState(pixTxId, borrower, loanAmount);

        pixCredit.loanId = ILendingMarket(_lendingMarket).takeLoanFor(
            borrower,
            pixCredit.programId,
            loanAmount,
            pixCredit.loanAddon,
            pixCredit.durationInPeriods
        );

        _changePixCreditStatus(
            pixTxId,
            pixCredit,
            PixCreditStatus.Pending, // newStatus
            PixCreditStatus.Initiated // oldStatus
        );
    }

    /// @dev TODO
    function _processPixHookCashOutConfirmationAfter(bytes32 pixTxId) internal {
        PixCredit storage pixCredit = _pixCredits[pixTxId];
        if (pixCredit.status != PixCreditStatus.Pending) {
            revert PixCreditStatusInappropriate(pixTxId, pixCredit.status);
        }

        _changePixCreditStatus(
            pixTxId,
            pixCredit,
            PixCreditStatus.Pending, // newStatus
            PixCreditStatus.Confirmed // oldStatus
        );
    }

    /// @dev TODO
    function _processPixHookCashOutReversalAfter(bytes32 pixTxId) internal {
        PixCredit storage pixCredit = _pixCredits[pixTxId];
        if (pixCredit.status != PixCreditStatus.Pending) {
            revert PixCreditStatusInappropriate(pixTxId, pixCredit.status);
        }

        ILendingMarket(_lendingMarket).revokeLoan(pixCredit.loanId);

        _changePixCreditStatus(
            pixTxId,
            pixCredit,
            PixCreditStatus.Reversed, // newStatus
            PixCreditStatus.Pending // oldStatus
        );
    }

    /// @dev TODO
    function _checkPixHookCaller() internal view {
        address sender = _msgSender();
        if (sender != _pixCashier) {
            revert PixHookCallerUnauthorized(sender);
        }
    }

    /// @dev TODO
    function _checkPixCashOutState(
        bytes32 pixTxId,
        address expectedAccount,
        uint256 expectedAmount
    ) internal view {
        IPixCashier.CashOut memory cashOut = IPixCashier(_pixCashier).getCashOut(pixTxId);
        if (
            cashOut.account != expectedAccount ||
            cashOut.amount != expectedAmount
        ) {
            revert PixCashOutInappropriate(pixTxId);
        }
    }
}
