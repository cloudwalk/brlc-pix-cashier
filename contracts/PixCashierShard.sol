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
    // ------------------ Errors ---------------------------------- //

    /// @dev Throws if the caller is not the owner or admin.
    error Unauthorized();

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
            revert Unauthorized();
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
     * @inheritdoc IPixCashierShard
     */
    function registerCashIn(
        address account,
        uint256 amount,
        bytes32 txId,
        CashInStatus targetStatus
    ) external onlyOwnerOrAdmin returns (Error) {
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
    function revokeCashIn(bytes32 txId) external onlyOwnerOrAdmin returns (Error, address, uint256) {
        if (txId == 0) {
            return (Error.ZeroTxId, address(0), 0);
        }

        CashInOperation storage operation = _cashInOperations[txId];

        if (operation.status != CashInStatus.PremintExecuted) {
            return (Error.InappropriateCashInStatus, address(0), 0);
        }

        address oldAccount = operation.account;
        uint256 oldAmount = operation.amount;

        operation.account = address(0);
        operation.amount = 0;
        operation.status = CashInStatus.Nonexistent;

        return (Error.None, oldAccount, oldAmount);
    }

    /**
     * @inheritdoc IPixCashierShard
     */
    function registerCashOut(
        address account, // Tools: This comment prevents Prettier from formatting into a single line.
        uint256 amount,
        bytes32 txId
    ) external onlyOwnerOrAdmin returns (Error, uint8) {
        return _registerCashOut(account, amount, txId, CashOutStatus.Pending);
    }

    /**
     * @inheritdoc IPixCashierShard
     */
    function registerInternalCashOut(
        address account, // Tools: This comment prevents Prettier from formatting into a single line.
        uint256 amount,
        bytes32 txId
    ) external onlyOwnerOrAdmin returns (Error, uint8) {
        return _registerCashOut(account, amount, txId, CashOutStatus.Internal);
    }

    /**
     * @inheritdoc IPixCashierShard
     */
    function processCashOut(
        bytes32 txId,
        CashOutStatus targetStatus
    ) external onlyOwnerOrAdmin returns (Error, address, uint256, uint8) {
        if (txId == 0) {
            return (Error.ZeroTxId, address(0), 0, 0);
        }

        CashOutOperation storage operation = _cashOutOperations[txId];

        Error err;
        if (operation.status != CashOutStatus.Pending) {
            err = Error.InappropriateCashOutStatus;
        } else {
            err = Error.None;
            operation.status = targetStatus;
        }

        return (err, operation.account, operation.amount, operation.flags);
    }

    /**
     * @inheritdoc IPixCashierShard
     */
    function setCashOutFlags(
        bytes32 txId, // Tools: This comment prevents Prettier from formatting into a single line.
        uint256 flags
    ) external onlyOwnerOrAdmin returns (Error) {
        if (txId == 0) {
            return Error.ZeroTxId;
        }

        _cashOutOperations[txId].flags = uint8(flags);

        return Error.None;
    }

    /**
     * @inheritdoc IPixCashierShard
     */
    function setAdmin(address account, bool status) external onlyOwnerOrAdmin {
        _admins[account] = status;
    }

    // ------------------ View functions -------------------------- //

    /**
     * @inheritdoc IPixCashierShard
     */
    function isAdmin(address account) external view returns (bool) {
        return _admins[account];
    }

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
    ) internal returns (Error, uint8) {
        if (account == address(0)) {
            return (Error.ZeroAccount, 0);
        }
        if (amount == 0) {
            return (Error.ZeroAmount, 0);
        }
        if (txId == 0) {
            return (Error.ZeroTxId, 0);
        }
        if (amount > type(uint64).max) {
            return (Error.AmountExcess, 0);
        }

        CashOutOperation storage operation = _cashOutOperations[txId];
        CashOutStatus oldStatus = operation.status;

        Error err;
        if (oldStatus == CashOutStatus.Pending || oldStatus == CashOutStatus.Confirmed) {
            err = Error.InappropriateCashOutStatus;
        } else if (oldStatus == CashOutStatus.Reversed && operation.account != account) {
            err = Error.InappropriateCashOutAccount;
        } else {
            err = Error.None;
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
