// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import { AccessControlExtUpgradeable } from "./base/AccessControlExtUpgradeable.sol";
import { PausableExtUpgradeable } from "./base/PausableExtUpgradeable.sol";
import { RescuableUpgradeable } from "./base/RescuableUpgradeable.sol";

import { IERC20Mintable } from "./interfaces/IERC20Mintable.sol";
import { IPixCashierRoot } from "./interfaces/IPixCashierRoot.sol";
import { IPixCashierShard } from "./interfaces/IPixCashierShard.sol";

import { PixCashierRootStorage } from "./PixCashierRootStorage.sol";

/**
 * @title PixCashierRoot contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Entry point contract for PIX cash-in and cash-out operations.
 */
contract PixCashierRoot is
    PixCashierRootStorage,
    AccessControlExtUpgradeable,
    PausableExtUpgradeable,
    RescuableUpgradeable,
    UUPSUpgradeable,
    IPixCashierRoot
{
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.Bytes32Set;

    // ------------------ Constants ------------------------------- //

    /// @dev The role of this contract owner.
    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");

    /// @dev The role of cashier that is allowed to execute the cash-in operations.
    bytes32 public constant CASHIER_ROLE = keccak256("CASHIER_ROLE");

    // ------------------ Errors ---------------------------------- //

    /// @dev Throws if the provided token address is zero.
    error ZeroTokenAddress();

    /// @dev Throws if the provided account address is zero.
    error ZeroAccount();

    /// @dev Thrown if the provided amount is zero.
    error ZeroAmount();

    /// @dev Throws if the provided off-chain transaction identifier is zero.
    error ZeroTxId();

    /// @dev Thrown if the provided amount exceeds the maximum allowed value.
    error AmountExcess();

    /// @dev Thrown if the minting of tokens failed during a cash-in operation.
    error TokenMintingFailure();

    /// @dev Thrown if the cash-in operation with the provided txId is already executed.
    error CashInAlreadyExecuted();

    /// @dev Thrown if the cash-in operation with the provided txId has an inappropriate status.
    error InappropriateCashInStatus();

    /// @dev Thrown if the cash-out operation with the provided txId has an inappropriate status.
    error InappropriateCashOutStatus();

    /// @dev Thrown if the cash-out operation cannot be executed for the provided account and txId.
    error InappropriateCashOutAccount();

    /// @dev Thrown if the provided release time for the premint operation is inappropriate.
    error InappropriatePremintReleaseTime();

    /// @dev Throws if the shard contract returns an error.
    error ShardError(IPixCashierShard.Error err);

    /// @dev Throws if the maximum number of shards is exceeded.
    error ShardCountExcess();

    // ------------------ Initializers ---------------------------- //

    /**
     * @dev Initializer of the upgradable contract.
     * @param token_ The address of the token to set as the underlying one.
     */
    function initialize(address token_) external initializer {
        __PixCashierRoot_init(token_);
    }

    /**
     * @dev Internal initializer of the upgradable contract.
     * @param token_ The address of the token to set as the underlying one.
     */
    function __PixCashierRoot_init(address token_) internal onlyInitializing {
        __Context_init_unchained();
        __ERC165_init_unchained();
        __AccessControl_init_unchained();
        __AccessControlExt_init_unchained();
        __Pausable_init_unchained();
        __PausableExt_init_unchained(OWNER_ROLE);
        __Rescuable_init_unchained(OWNER_ROLE);
        __UUPSUpgradeable_init_unchained();
        __PixCashierRoot_init_unchained(token_);
    }

    /**
     * @dev Unchained internal initializer of the upgradable contract.
     *
     * Requirements:
     *
     * - The passed address of the underlying token must not be zero.
     *
     * @param token_ The address of the token to set as the underlying one
     */
    function __PixCashierRoot_init_unchained(address token_) internal onlyInitializing {
        if (token_ == address(0)) {
            revert ZeroTokenAddress();
        }

        _token = token_;

        _setRoleAdmin(OWNER_ROLE, OWNER_ROLE);
        _setRoleAdmin(CASHIER_ROLE, OWNER_ROLE);
        _grantRole(OWNER_ROLE, _msgSender());
    }

    // ------------------ Functions ------------------------------- //

    /**
     * @inheritdoc IPixCashierRoot
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {CASHIER_ROLE} role.
     * - The provided `account` and `txId` values must not be zero.
     * - The provided `amount` value must not be zero and less or equal to uint64.max.
     * - The cash-in operation with the provided `txId` must not be already executed.
     */
    function cashIn(address account, uint256 amount, bytes32 txId) external whenNotPaused onlyRole(CASHIER_ROLE) {
        IPixCashierShard.Error err = _shard(txId).registerCashIn(account, amount, txId, CashInStatus.Executed);
        if (err != IPixCashierShard.Error.None) {
            if (err == IPixCashierShard.Error.ZeroAccount) revert ZeroAccount();
            if (err == IPixCashierShard.Error.ZeroAmount) revert ZeroAmount();
            if (err == IPixCashierShard.Error.ZeroTxId) revert ZeroTxId();
            if (err == IPixCashierShard.Error.AmountExcess) revert AmountExcess();
            if (err == IPixCashierShard.Error.CashInAlreadyExecuted) revert CashInAlreadyExecuted();
            revert ShardError(err);
        }

        emit CashIn(account, amount, txId);

        if (!IERC20Mintable(_token).mint(account, amount)) {
            revert TokenMintingFailure();
        }
    }

    /**
     * @inheritdoc IPixCashierRoot
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {CASHIER_ROLE} role.
     * - The provided `account`, `txId` and `releaseTime` values must not be zero.
     * - The provided `amount` value must not be zero and less or equal to uint64.max.
     * - The cash-in operation with the provided `txId` must not be already executed.
     */
    function cashInPremint(
        address account,
        uint256 amount,
        bytes32 txId,
        uint256 releaseTime
    ) external whenNotPaused onlyRole(CASHIER_ROLE) {
        if (releaseTime == 0) {
            revert InappropriatePremintReleaseTime();
        }

        IPixCashierShard.Error err = _shard(txId).registerCashIn(account, amount, txId, CashInStatus.PremintExecuted);
        if (err != IPixCashierShard.Error.None) {
            if (err == IPixCashierShard.Error.ZeroAccount) revert ZeroAccount();
            if (err == IPixCashierShard.Error.ZeroAmount) revert ZeroAmount();
            if (err == IPixCashierShard.Error.ZeroTxId) revert ZeroTxId();
            if (err == IPixCashierShard.Error.AmountExcess) revert AmountExcess();
            if (err == IPixCashierShard.Error.CashInAlreadyExecuted) revert CashInAlreadyExecuted();
            revert ShardError(err);
        }

        emit CashInPremint(account, amount, 0, txId, releaseTime);

        IERC20Mintable(_token).premintIncrease(account, amount, releaseTime);
    }

    /**
     * @dev See {IPixCashier-cashInPremintRevoke}.
     *
     * Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {CASHIER_ROLE} role.
     * - The provided `account`, `txId` and `releaseTime` values must not be zero.
     */
    function cashInPremintRevoke(bytes32 txId, uint256 releaseTime) external whenNotPaused onlyRole(CASHIER_ROLE) {
        if (releaseTime == 0) {
            revert InappropriatePremintReleaseTime();
        }

        (address account, uint256 amount, IPixCashierShard.Error err) = _shard(txId).revokeCashIn(txId);
        if (err != IPixCashierShard.Error.None) {
            if (err == IPixCashierShard.Error.ZeroTxId) revert ZeroTxId();
            if (err == IPixCashierShard.Error.InappropriateCashInStatus) revert InappropriateCashInStatus();
            revert ShardError(err);
        }

        emit CashInPremint(account, 0, amount, txId, releaseTime);

        IERC20Mintable(_token).premintDecrease(account, amount, releaseTime);
    }

    /**
     * @inheritdoc IPixCashierRoot
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {CASHIER_ROLE} role.
     * - The original and target release timestamps must meet the requirements of the appropriate function of the
     *   underlying token contract.
     */
    function reschedulePremintRelease(
        uint256 originalRelease,
        uint256 targetRelease
    ) external whenNotPaused onlyRole(CASHIER_ROLE) {
        IERC20Mintable(_token).reschedulePremintRelease(originalRelease, targetRelease);
    }

    /**
     * @inheritdoc IPixCashierRoot
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {CASHIER_ROLE} role.
     * - The `account` and `txId` values must not be zero.
     * - The `amount` value must not be zero and less or equal to uint64.max.
     * - The cash-out operation with the provided `txId` must not be already pending.
     */
    function requestCashOutFrom(
        address account,
        uint256 amount,
        bytes32 txId
    ) external whenNotPaused onlyRole(CASHIER_ROLE) {
        IPixCashierShard.Error err = _shard(txId).registerCashOut(account, amount, txId);
        if (err != IPixCashierShard.Error.None) {
            if (err == IPixCashierShard.Error.ZeroAccount) revert ZeroAccount();
            if (err == IPixCashierShard.Error.ZeroAmount) revert ZeroAmount();
            if (err == IPixCashierShard.Error.ZeroTxId) revert ZeroTxId();
            if (err == IPixCashierShard.Error.AmountExcess) revert AmountExcess();
            if (err == IPixCashierShard.Error.InappropriateCashOutStatus) revert InappropriateCashOutStatus();
            if (err == IPixCashierShard.Error.InappropriateCashOutAccount) revert InappropriateCashOutAccount();
            revert ShardError(err);
        }

        uint256 cashOutBalance = _cashOutBalances[account] + amount;
        _cashOutBalances[account] = cashOutBalance;
        _pendingCashOutTxIds.add(txId);

        emit RequestCashOut(account, amount, cashOutBalance, txId, msg.sender);

        IERC20(_token).safeTransferFrom(account, address(this), amount);
    }

    /**
     * @inheritdoc IPixCashierRoot
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {CASHIER_ROLE} role.
     * - The provided `txId` value must not be zero.
     * - The cash-out operation corresponded the provided `txId` value must have the pending status.
     */
    function confirmCashOut(bytes32 txId) external whenNotPaused onlyRole(CASHIER_ROLE) {
        (address account, uint256 amount, IPixCashierShard.Error err) = _shard(txId).processCashOut(
            txId,
            CashOutStatus.Confirmed
        );
        if (err != IPixCashierShard.Error.None) {
            if (err == IPixCashierShard.Error.ZeroTxId) revert ZeroTxId();
            if (err == IPixCashierShard.Error.InappropriateCashOutStatus) revert InappropriateCashOutStatus();
            revert ShardError(err);
        }

        uint256 cashOutBalance = _cashOutBalances[account] - amount;
        _cashOutBalances[account] = cashOutBalance;
        _pendingCashOutTxIds.remove(txId);

        emit ConfirmCashOut(account, amount, cashOutBalance, txId);

        IERC20Mintable(_token).burn(amount);
    }

    /**
     * @inheritdoc IPixCashierRoot
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {CASHIER_ROLE} role.
     * - The provided `txId` value must not be zero.
     * - The cash-out operation corresponded the provided `txId` value must have the pending status.
     */
    function reverseCashOut(bytes32 txId) external whenNotPaused onlyRole(CASHIER_ROLE) {
        (address account, uint256 amount, IPixCashierShard.Error err) = _shard(txId).processCashOut(
            txId,
            CashOutStatus.Reversed
        );
        if (err != IPixCashierShard.Error.None) {
            if (err == IPixCashierShard.Error.ZeroTxId) revert ZeroTxId();
            if (err == IPixCashierShard.Error.InappropriateCashOutStatus) revert InappropriateCashOutStatus();
            revert ShardError(err);
        }

        uint256 cashOutBalance = _cashOutBalances[account] - amount;
        _cashOutBalances[account] = cashOutBalance;
        _pendingCashOutTxIds.remove(txId);

        emit ReverseCashOut(account, amount, cashOutBalance, txId);

        IERC20(_token).safeTransfer(account, amount);
    }

    /**
     * @inheritdoc IPixCashierRoot
     *
     * @dev Requirements:
     *
     * - The caller must have the {OWNER_ROLE} role.
     * - The maximum number of shards if limited by 1100.
     */
    function addShards(address[] memory shards) external onlyRole(OWNER_ROLE) {
        if(_shards.length + shards.length > 1100) {
            revert ShardCountExcess();
        }

        for (uint256 i; i < shards.length; i++) {
            _shards.push(IPixCashierShard(shards[i]));
            emit ShardAdded(shards[i]);
        }
    }

    // ------------------ View functions -------------------------- //

    /**
     * @inheritdoc IPixCashierRoot
     */
    function getCashIn(bytes32 txId) external view returns (CashInOperation memory) {
        return _shard(txId).getCashIn(txId);
    }

    /**
     * @inheritdoc IPixCashierRoot
     */
    function getCashIns(bytes32[] memory txIds) external view returns (CashInOperation[] memory) {
        uint256 len = txIds.length;
        CashInOperation[] memory cashInOperations = new CashInOperation[](len);
        for (uint256 i = 0; i < len; i++) {
            cashInOperations[i] = _shard(txIds[i]).getCashIn(txIds[i]);
        }
        return cashInOperations;
    }

    /**
     * @inheritdoc IPixCashierRoot
     */
    function getCashOut(bytes32 txId) external view returns (CashOutOperation memory) {
        return _shard(txId).getCashOut(txId);
    }

    /**
     * @inheritdoc IPixCashierRoot
     */
    function getCashOuts(bytes32[] memory txIds) external view returns (CashOutOperation[] memory) {
        uint256 len = txIds.length;
        CashOutOperation[] memory cashOutOperations = new CashOutOperation[](len);
        for (uint256 i = 0; i < len; i++) {
            cashOutOperations[i] = _shard(txIds[i]).getCashOut(txIds[i]);
        }
        return cashOutOperations;
    }

    /**
     * @inheritdoc IPixCashierRoot
     */
    function getPendingCashOutTxIds(uint256 index, uint256 limit) external view returns (bytes32[] memory) {
        uint256 len = _pendingCashOutTxIds.length();
        bytes32[] memory txIds;
        if (len <= index || limit == 0) {
            txIds = new bytes32[](0);
        } else {
            len -= index;
            if (len > limit) {
                len = limit;
            }
            txIds = new bytes32[](len);
            for (uint256 i = 0; i < len; i++) {
                txIds[i] = _pendingCashOutTxIds.at(index);
                index++;
            }
        }
        return txIds;
    }

    /**
     * @inheritdoc IPixCashierRoot
     */
    function cashOutBalanceOf(address account) external view returns (uint256) {
        return _cashOutBalances[account];
    }

    /**
     * @inheritdoc IPixCashierRoot
     */
    function pendingCashOutCounter() external view returns (uint256) {
        return _pendingCashOutTxIds.length();
    }

    /**
     * @inheritdoc IPixCashierRoot
     */
    function underlyingToken() external view returns (address) {
        return _token;
    }

    /**
     * @inheritdoc IPixCashierRoot
     */
    function getShardCount() external view returns (uint256) {
        return _shards.length;
    }

    /**
     * @inheritdoc IPixCashierRoot
     */
    function getShardByTxId(bytes32 txId) external view returns (address) {
        return address(_shard(txId));
    }

    /**
     * @inheritdoc IPixCashierRoot
     */
    function getShardRange(uint256 index, uint256 limit) external view returns (address[] memory) {
        uint256 len = _shards.length;
        address[] memory shards;
        if (len <= index || limit == 0) {
            shards = new address[](0);
        } else {
            len -= index;
            if (len > limit) {
                len = limit;
            }
            shards = new address[](len);
            for (uint256 i = 0; i < len; i++) {
                shards[i] = address(_shards[index]);
                index++;
            }
        }
        return shards;
    }

    // ------------------ Internal functions ---------------------- //

    /**
     * @dev Returns the shard contract by the off-chain transaction identifier.
     * @param txId The off-chain transaction identifier of the operation.
     */
    function _shard(bytes32 txId) internal view returns (IPixCashierShard) {
        uint256 i = uint256(keccak256(abi.encodePacked(txId)));
        i %= _shards.length;
        return _shards[i];
    }

    /**
     * @dev The upgrade authorization function for UUPSProxy.
     * @param newImplementation The address of the new implementation.
     */
    function _authorizeUpgrade(address newImplementation) internal view override onlyRole(OWNER_ROLE) {
        newImplementation; // Suppresses a compiler warning about the unused variable.
    }

    // ------------------ Service functions ----------------------- //

    /**
     * @dev Upgrades the range of the underlying shard contracts to the a implementation.
     * @param newImplementation The address of the new shard implementation.
     * @param fromIndex The start index of the range (inclusive).
     * @param toIndex The end index of the range (inclusive).
     */
    function upgradeShardsTo(
        address newImplementation,
        uint256 fromIndex,
        uint256 toIndex
    ) external onlyRole(OWNER_ROLE) {
        /**
         * TODO: make this function more secure and reliable.
         */
        for (uint256 i = fromIndex; i <= toIndex; i++) {
            _shards[i].upgradeTo(newImplementation);
        }
    }

    /**
     * @dev The version of the standard upgrade function without the second parameter for backward compatibility.
     * @custom:oz-upgrades-unsafe-allow-reachable delegatecall
     */
    function upgradeTo(address newImplementation) external {
        upgradeToAndCall(newImplementation, "");
    }
}
