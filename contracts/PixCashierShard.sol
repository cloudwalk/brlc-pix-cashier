// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import { IPixCashierShard } from "./interfaces/IPixCashierShard.sol";
import { PixCashierShardStorage } from "./PixCashierShardStorage.sol";

/**
 * @title PixCashierShard contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev The contract responsible for storing sharded cash-in and cash-out operations.
 */
contract PixCashierShard is PixCashierShardStorage, OwnableUpgradeable, UUPSUpgradeable, IPixCashierShard {
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
    function __PixCashierShard_init_unchained() internal onlyInitializing {}

    // ----------------------- Functions -------------------------- //

    /**
     * @inheritdoc IPixCashierShard
     */
    function registerCashIn(
        address account,
        uint256 amount,
        bytes32 txId,
        CashInStatus targetStatus
    ) external onlyOwner returns (Error) {
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
     * @inheritdoc IPixCashierShard
     */
    function revokeCashIn(bytes32 txId) external onlyOwner returns (address, uint256, Error) {
        if (txId == 0) {
            return (address(0), 0, Error.ZeroTxId);
        }

        CashInOperation storage operation = _cashInOperations[txId];

        if (operation.status != CashInStatus.PremintExecuted) {
            return (address(0), 0, Error.InappropriateCashInStatus);
        }

        address oldAccount = operation.account;
        uint256 oldAmount = operation.amount;

        operation.account = address(0);
        operation.amount = 0;
        operation.status = CashInStatus.Nonexistent;

        return (oldAccount, oldAmount, Error.None);
    }

    /**
     * @inheritdoc IPixCashierShard
     */
    function registerCashOut(address account, uint256 amount, bytes32 txId) external onlyOwner returns (Error) {
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
        CashOutStatus oldStatus = operation.status;

        if (oldStatus == CashOutStatus.Pending || oldStatus == CashOutStatus.Confirmed) {
            return Error.InappropriateCashOutStatus;
        } else if (oldStatus == CashOutStatus.Reversed && operation.account != account) {
            return Error.InappropriateCashOutAccount;
        }

        operation.account = account;
        operation.amount = uint64(amount);
        operation.status = CashOutStatus.Pending;

        return Error.None;
    }

    /**
     * @inheritdoc IPixCashierShard
     */
    function processCashOut(bytes32 txId, CashOutStatus targetStatus) external onlyOwner returns (address, uint256, Error) {
        if (txId == 0) {
            return (address(0), 0, Error.ZeroTxId);
        }

        CashOutOperation storage operation = _cashOutOperations[txId];

        if (operation.status != CashOutStatus.Pending) {
            return (address(0), 0, Error.InappropriateCashOutStatus);
        }

        operation.status = targetStatus;

        return (operation.account, operation.amount, Error.None);
    }

    // ------------------ View functions -------------------------- //

    /**
     * @inheritdoc IPixCashierShard
     */
    function getCashIn(bytes32 txId) external view returns (CashInOperation memory) {
        return _cashInOperations[txId];
    }

    /**
     * @inheritdoc IPixCashierShard
     */
    function getCashOut(bytes32 txId) external view returns (CashOutOperation memory) {
        return _cashOutOperations[txId];
    }

    /**
     * @inheritdoc IPixCashierShard
     */
    function getCashIns(bytes32[] memory txIds) external view returns (CashInOperation[] memory) {
        uint256 len = txIds.length;
        CashInOperation[] memory cashInOperations = new CashInOperation[](len);
        for (uint256 i = 0; i < len; i++) {
            cashInOperations[i] = _cashInOperations[txIds[i]];
        }
        return cashInOperations;
    }

    /**
     * @inheritdoc IPixCashierShard
     */
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
