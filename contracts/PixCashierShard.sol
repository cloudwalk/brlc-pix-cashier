// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import { IPixCashierTypes } from "./interfaces/IPixCashier.sol";
import { IPixCashierErrors } from "./interfaces/IPixCashierErrors.sol";
import { IPixCashierShard } from "./interfaces/IPixCashierShard.sol";

import { PixCashierShardStorage } from "./PixCashierShardStorage.sol";


/**
 * @title PixCashier contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Wrapper contract for PIX cash-in and cash-out operations.
 */
contract PixCashierShard is
    PixCashierShardStorage,
    OwnableUpgradeable,
    UUPSUpgradeable,
    IPixCashierShard
{
    using EnumerableSet for EnumerableSet.Bytes32Set;

    // ------------------ Errors ---------------------------------- //

    /// @dev Throws if the provided token address is zero.
    error ZeroTokenAddress();

    // ------------------ Initializers ---------------------------- //

    /**
     * @dev Initializer of the upgradable contract.
     * @param owner_ The address of the contract owner.
     */
    function initialize(address owner_) external initializer {
        __PixCashierShard_init(owner_);
    }

    /**
     * @dev Internal initializer of the upgradable contract.
     * @param owner_ The address of the contract owner.
     */
    function __PixCashierShard_init(address owner_) internal onlyInitializing {
        __Context_init_unchained();
        __Ownable_init_unchained(owner_);
        __UUPSUpgradeable_init_unchained();
        __PixCashierShard_init_unchained();
    }

    /**
     * @dev Unchained internal initializer of the upgradable contract.
     */
    function __PixCashierShard_init_unchained() internal onlyInitializing {
    }

    // ------------------ View functions -------------------------- //

    function getCashIn(bytes32 txId) external view returns (CashInOperation memory) {
        return _cashInOperations[txId];
    }

    function getCashOut(bytes32 txIds) external view returns (CashOutOperation memory) {
        return _cashOutOperations[txIds];
    }

    function getCashIns(bytes32[] memory txIds) external view returns (CashInOperation[] memory) {
        uint256 len = txIds.length;
        CashInOperation[] memory cashInOperations = new CashInOperation[](len);
        for (uint256 i = 0; i < len; i++) {
            cashInOperations[i] = _cashInOperations[txIds[i]];
        }
        return cashInOperations;
    }

    function getCashOuts(bytes32[] memory txIds) external view returns (CashOutOperation[] memory) {
        uint256 len = txIds.length;
        CashOutOperation[] memory cashOutOperations = new CashOutOperation[](len);
        for (uint256 i = 0; i < len; i++) {
            cashOutOperations[i] = _cashOutOperations[txIds[i]];
        }
        return cashOutOperations;
    }

    // ------------------ Internal functions ---------------------- //

    /**
     * @dev Executes a cash-in operation internally depending on execution policy.
     */
    function registerCashIn(
        address account,
        uint256 amount,
        bytes32 txId,
        CashInStatus targetStatus
    ) public returns (Error) {
        if (account == address(0)) {
            return Error.ZeroAccount;
        }
        if (amount == 0) {
            return Error.ZeroAmount;
        }
        if (txId == 0) {
            return Error.ZeroTxId;
        }
        if (amount > type(uint64).max) {
            return Error.AmountExcess;
        }

        CashInOperation storage operation = _cashInOperations[txId];

        if (operation.status != CashInStatus.Nonexistent) {
            return Error.CashInAlreadyExecuted;
        }

        operation.account = account;
        operation.amount = uint64(amount);
        operation.status = targetStatus;

        return Error.None;
    }

    /**
     * @dev Revokes a cash-in premint operation internally.
     *
     * @param txId The off-chain transaction identifier of the operation.
     */
    function revokeCashIn(bytes32 txId) public returns (address, uint256, Error) {
        if (txId == 0) {
            return (address(0), 0, Error.ZeroTxId);
        }

        CashInOperation storage cashIn_ = _cashInOperations[txId];
        address account = cashIn_.account;

        if (cashIn_.status != CashInStatus.PremintExecuted) {
            return (address(0), 0, Error.InappropriateCashInStatus);
        }

        uint256 amount = cashIn_.amount;
        // Clearing by fields instead of `delete _cashInOperations[txId]` is due to less gas usage and bytecode size
        cashIn_.status = CashInStatus.Nonexistent;
        cashIn_.amount = 0;
        cashIn_.account = address(0);

        return (account, amount, Error.None);
    }

    /**
     * @dev Executes a cash-out request operation internally.
     * @param account The account on that behalf the operation is made.
     * @param amount The amount of tokens to be cash-outed.
     * @param txId The off-chain transaction identifier of the operation.
     */
    function registerCashOut(
        address account,
        uint256 amount,
        bytes32 txId
    ) external returns (Error) {
        if (account == address(0)) {
            return Error.ZeroAccount;
        }
        if (amount == 0) {
            return Error.ZeroAmount;
        }
        if (txId == 0) {
            return Error.ZeroTxId;
        }
        if (amount > type(uint64).max) {
            return Error.AmountExcess;
        }

        CashOutOperation storage operation = _cashOutOperations[txId];
        CashOutStatus status = operation.status;

        if (status == CashOutStatus.Pending || status == CashOutStatus.Confirmed) {
            return Error.InappropriateCashOutStatus;
        } else if (status == CashOutStatus.Reversed && operation.account != account) {
            return Error.InappropriateCashOutAccount;
        }

        operation.account = account;
        operation.amount = uint64(amount);
        operation.status = CashOutStatus.Pending;

        return Error.None;
    }

    /**
     * @notice Processes a previously requested cash-out operation internally.
     * @param txId The off-chain transaction identifier of the operation.
     * @param status The target status of the cash-out operation.
     */
    function processCashOut(bytes32 txId, CashOutStatus status) public returns (address, uint256, Error) {
        if (txId == 0) {
            return (address(0), 0, Error.ZeroTxId);
        }

        CashOutOperation storage operation = _cashOutOperations[txId];

        if (operation.status != CashOutStatus.Pending) {
            return (address(0), 0, Error.InappropriateCashOutStatus);
        }

        operation.status = status;

        return (operation.account, operation.amount, Error.None);
    }

    /**
     * @dev The upgrade authorization function for UUPSProxy.
     */
    function _authorizeUpgrade(address newImplementation) internal view override onlyOwner {
        newImplementation; // Suppresses a compiler warning about the unused variable
    }

    // ------------------ Service functions ----------------------- //

    /**
     * @dev The version of the standard upgrade function without the second parameter for backward compatibility.
     * @custom:oz-upgrades-unsafe-allow-reachable delegatecall
     */
    function upgradeTo(address newImplementation) external {
        upgradeToAndCall(newImplementation, "");
    }
}
