// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import { IPixCashierShard } from "./interfaces/IPixCashierShard.sol";
import { IPixCashierShardPrimary } from "./interfaces/IPixCashierShard.sol";
import { IPixCashierShardConfiguration } from "./interfaces/IPixCashierShard.sol";
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
     *
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable.
     *
     * @param owner_ The address of the contract owner.
     */
    function initialize(address owner_) external initializer {
        __PixCashierShard_init(owner_);
    }

    /**
     * @dev Internal initializer of the upgradable contract.
     *
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable.
     *
     * @param owner_ The address of the contract owner.
     */
    function __PixCashierShard_init(address owner_) internal onlyInitializing {
        __Context_init_unchained();
        __Ownable_init_unchained(owner_);
        __UUPSUpgradeable_init_unchained();

        __PixCashierShard_init_unchained();
    }

    // ----------------------- Modifiers -------------------------- //

    modifier onlyOwnerOrAdmin() {
        if (msg.sender != owner() && !_admins[msg.sender]) {
            revert PixCashierShard_Unauthorized();
        }
        _;
    }

    /**
     * @dev Unchained internal initializer of the upgradable contract.
     *
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable.
     */
    function __PixCashierShard_init_unchained() internal onlyInitializing {}

    // ----------------------- Functions -------------------------- //

    /**
     * @inheritdoc IPixCashierShardPrimary
     */
    function registerCashIn(
        address account,
        uint256 amount,
        bytes32 txId,
        CashInStatus targetStatus
    ) external onlyOwnerOrAdmin returns (uint256) {
        CashInOperation storage operation = _cashInOperations[txId];

        if (operation.status != CashInStatus.Nonexistent) {
            return uint256(Error.CashInAlreadyExecuted);
        }

        operation.account = account;
        operation.amount = uint64(amount);
        operation.status = targetStatus;

        return uint256(Error.None);
    }

    /**
     * @inheritdoc IPixCashierShardPrimary
     */
    function revokeCashIn(bytes32 txId) external onlyOwnerOrAdmin returns (uint256, address, uint256) {
        CashInOperation storage operation = _cashInOperations[txId];

        if (operation.status != CashInStatus.PremintExecuted) {
            return (uint256(Error.InappropriateCashInStatus), address(0), 0);
        }

        address oldAccount = operation.account;
        uint256 oldAmount = operation.amount;

        operation.account = address(0);
        operation.amount = 0;
        operation.status = CashInStatus.Nonexistent;

        return (uint256(Error.None), oldAccount, oldAmount);
    }

    /**
     * @inheritdoc IPixCashierShardPrimary
     */
    function registerCashOut(
        address account, // Tools: This comment prevents Prettier from formatting into a single line.
        uint256 amount,
        bytes32 txId
    ) external onlyOwnerOrAdmin returns (uint256, uint256) {
        return _registerCashOut(account, amount, txId, CashOutStatus.Pending);
    }

    /**
     * @inheritdoc IPixCashierShardPrimary
     */
    function registerInternalCashOut(
        address account, // Tools: This comment prevents Prettier from formatting into a single line.
        uint256 amount,
        bytes32 txId
    ) external onlyOwnerOrAdmin returns (uint256, uint256) {
        return _registerCashOut(account, amount, txId, CashOutStatus.Internal);
    }

    /**
     * @inheritdoc IPixCashierShardPrimary
     */
    function processCashOut(
        bytes32 txId,
        CashOutStatus targetStatus
    ) external onlyOwnerOrAdmin returns (uint256, address, uint256, uint256) {
        CashOutOperation storage operation = _cashOutOperations[txId];

        uint256 err;
        if (operation.status != CashOutStatus.Pending) {
            err = uint256(Error.InappropriateCashOutStatus);
        } else {
            err = uint256(Error.None);
            operation.status = targetStatus;
        }

        return (err, operation.account, operation.amount, operation.flags);
    }

    /**
     * @inheritdoc IPixCashierShardPrimary
     */
    function setCashOutFlags(
        bytes32 txId, // Tools: This comment prevents Prettier from formatting into a single line.
        uint256 flags
    ) external onlyOwnerOrAdmin returns (uint256) {
        _cashOutOperations[txId].flags = uint8(flags);

        return uint256(Error.None);
    }

    /**
     * @inheritdoc IPixCashierShardConfiguration
     */
    function setAdmin(address account, bool status) external onlyOwnerOrAdmin {
        _admins[account] = status;
    }

    // ------------------ View functions -------------------------- //

    /**
     * @inheritdoc IPixCashierShardConfiguration
     */
    function isAdmin(address account) external view returns (bool) {
        return _admins[account];
    }

    /**
     * @inheritdoc IPixCashierShardPrimary
     */
    function getCashIn(bytes32 txId) external view returns (CashInOperation memory) {
        return _cashInOperations[txId];
    }

    /**
     * @inheritdoc IPixCashierShardPrimary
     */
    function getCashOut(bytes32 txId) external view returns (CashOutOperation memory) {
        return _cashOutOperations[txId];
    }

    /**
     * @inheritdoc IPixCashierShardPrimary
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
     * @inheritdoc IPixCashierShardPrimary
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
     * @dev Registers a cash-out operation internally with the provided status.
     * @param account The address of the tokens recipient.
     * @param amount The amount of tokens to be received.
     * @param txId The off-chain transaction identifier of the operation.
     * @param newStatus The new status of the operation to set.
     * @return err The error code if the operation fails, otherwise None.
     * @return flags The flags field of the stored cash-out operation structure.
     */
    function _registerCashOut(
        address account, // Tools: this comment prevents Prettier from formatting into a single line.
        uint256 amount,
        bytes32 txId,
        CashOutStatus newStatus
    ) internal returns (uint256, uint8) {
        CashOutOperation storage operation = _cashOutOperations[txId];
        CashOutStatus oldStatus = operation.status;

        uint256 err;
        if (oldStatus == CashOutStatus.Pending || oldStatus == CashOutStatus.Confirmed) {
            err = uint256(Error.InappropriateCashOutStatus);
        } else if (oldStatus == CashOutStatus.Reversed && operation.account != account) {
            err = uint256(Error.InappropriateCashOutAccount);
        } else {
            err = uint256(Error.None);
            operation.account = account;
            operation.amount = uint64(amount);
            operation.status = newStatus;
        }

        return (err, operation.flags);
    }

    /**
     * @dev The upgrade authorization function for UUPSProxy.
     * @param newImplementation The address of the new implementation.
     */
    function _authorizeUpgrade(address newImplementation) internal view override onlyOwnerOrAdmin {
        newImplementation; // Suppresses a compiler warning about the unused variable.
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
