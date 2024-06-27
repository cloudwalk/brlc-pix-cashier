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
import { IPixCashierTypes, IPixCashierErrors } from "./interfaces/IPixCashier.sol";
import { IPixCashierShard } from "./PixCashierShard.sol";

/**
 * @title PixCashier interface
 * @dev The interface of the wrapper contract for PIX cash-in and cash-out operations.
 */
interface IPixCashierProxy is IPixCashierTypes {
    // ------------------ Events ---------------------------------- //

    /// @dev Emitted when a new cash-in operation is executed.
    event CashIn(
        address indexed account, // The account that receives tokens.
        uint256 amount,          // The amount of tokens to receive.
        bytes32 indexed txId     // The off-chain transaction identifier.
    );

    /// @dev Emitted when a cash-in premint operation is executed or changed.
    event CashInPremint(
        address indexed account, // The account that will receive the preminted tokens.
        uint256 newAmount,       // The new amount of preminted tokens.
        uint256 oldAmount,       // The old amount of preminted tokens.
        bytes32 indexed txId,    // The off-chain transaction identifier for the operation.
        uint256 releaseTime      // The timestamp when the preminted tokens will become available for usage.
    );

    /// @dev Emitted when a new cash-out operation is initiated.
    event RequestCashOut(
        address indexed account, // The account that owns the tokens to cash-out.
        uint256 amount,          // The amount of tokens to cash-out.
        uint256 balance,         // The new pending cash-out balance of the account.
        bytes32 indexed txId,    // The off-chain transaction identifier.
        address indexed sender   // The account that initiated the cash-out.
    );

    /// @dev Emitted when a cash-out operation is confirmed.
    event ConfirmCashOut(
        address indexed account, // The account that owns the tokens to cash-out.
        uint256 amount,          // The amount of tokens to cash-out.
        uint256 balance,         // The new pending cash-out balance of the account.
        bytes32 indexed txId     // The off-chain transaction identifier.
    );

    /// @dev Emitted when a cash-out operation is reversed.
    event ReverseCashOut(
        address indexed account, // The account that owns the tokens to cash-out.
        uint256 amount,          // The amount of tokens to cash-out.
        uint256 balance,         // The new pending cash-out balance of the account.
        bytes32 indexed txId     // The off-chain transaction identifier.
    );

    // ------------------ Functions ------------------------------- //

    /**
     * @dev Executes a cash-in operation as a common mint.
     *
     * This function is expected to be called by a limited number of accounts
     * that are allowed to execute cash-in operations.
     *
     * Emits a {CashIn} event.
     *
     * @param account The address of the tokens recipient.
     * @param amount The amount of tokens to be received.
     * @param txId The off-chain transaction identifier of the operation.
     */
    function cashIn(address account, uint256 amount, bytes32 txId) external;

    /**
     * @dev Executes a cash-in operation as a premint with some predetermined release time.
     *
     * This function is expected to be called by a limited number of accounts
     * that are allowed to execute cash-in operations.
     *
     * Emits a {CashInPremint} event.
     *
     * @param account The address of the tokens recipient.
     * @param amount The amount of tokens to be received.
     * @param txId The off-chain transaction identifier of the operation.
     * @param releaseTime The timestamp when the minted tokens will become available for usage.
     */
    function cashInPremint(
        address account,
        uint256 amount,
        bytes32 txId,
        uint256 releaseTime
    ) external;

    /**
     * @dev Revokes the existing premint that has not yet been released.
     *
     * This function is expected to be called by a limited number of accounts
     * that are allowed to execute cash-in operations.
     *
     * Emits a {CashInPremint} event.
     *
     * @param txId The off-chain transaction identifier of the operation.
     * @param releaseTime The timestamp of the premint that will be revoked.
     */
    function cashInPremintRevoke(
        bytes32 txId,
        uint256 releaseTime
    ) external;

    /**
     * @dev Reschedules original cash-in premint release to a new target release.
     *
     * @param originalRelease The timestamp of the original premint release to be rescheduled.
     * @param targetRelease The new timestamp of the premint release to set during the rescheduling.
     */
    function reschedulePremintRelease(uint256 originalRelease, uint256 targetRelease) external;

    /**
     * @dev Initiates a cash-out operation from some other account.
     *
     * Transfers tokens from the account to the contract.
     * This function is expected to be called by a limited number of accounts
     * that are allowed to process cash-out operations.
     *
     * Emits a {CashOut} event.
     *
     * @param account The account on that behalf the operation is made.
     * @param amount The amount of tokens to be cash-outed.
     * @param txId The off-chain transaction identifier of the operation.
     */
    function requestCashOutFrom(address account, uint256 amount, bytes32 txId) external;

    /**
     * @dev Confirms a single cash-out operation.
     *
     * Burns tokens previously transferred to the contract.
     * This function is expected to be called by a limited number of accounts
     * that are allowed to process cash-out operations.
     *
     * Emits a {CashOutConfirm} event for the operation.
     *
     * @param txId The off-chain transaction identifier of the operation.
     */
    function confirmCashOut(bytes32 txId) external;

    /**
     * @dev Reverts a single cash-out operation.
     *
     * Transfers tokens back from the contract to the account that requested the operation.
     * This function is expected to be called by a limited number of accounts
     * that are allowed to process cash-out operations.
     *
     * Emits a {CashOutReverse} event for the operation.
     *
     * @param txId The off-chain transaction identifier of the operation.
     */
    function reverseCashOut(bytes32 txId) external;

    // ------------------ View functions -------------------------- //

    /**
     * @dev Returns the data of a single cash-in operation.
     * @param txId The off-chain transaction identifier of the operation.
     */
    function getCashIn(bytes32 txId) external view returns (CashInOperation memory);

    /**
     * @dev Returns the data of multiple cash-in operations.
     * @param txIds The off-chain transaction identifiers of the operations.
     */
    function getCashIns(bytes32[] memory txIds) external view returns (CashInOperation[] memory);

    /**
     * @dev Returns the data of a single cash-out operation.
     * @param txId The off-chain transaction identifier of the operation.
     */
    function getCashOut(bytes32 txId) external view returns (CashOutOperation memory);

    /**
     * @dev Returns the data of multiple cash-out operations.
     * @param txIds The off-chain transaction identifiers of the operations.
     */
    function getCashOuts(bytes32[] memory txIds) external view returns (CashOutOperation[] memory);

    /**
     * @dev Returns the off-chain transaction identifiers of pending cash-out operations.
     *
     * No guarantees are made on the ordering of the identifiers in the returned array.
     * When you can't prevent confirming and reversing of cash-out operations during calling this function several
     * times to sequentially read of all available identifiers the following procedure is recommended:
     *
     * - 1. Call the `processedCashOutCounter()` function and remember the returned value as C1.
     * - 2. Call this function several times with needed values of `index` and `limit` like (0,5), (5,5), (10,5), ...
     * - 3. Execute step 2 until the length of the returned array becomes less than the `limit` value.
     * - 4. Call the `processedCashOutCounter()` function and remember the returned value as C2.
     * - 5. If C1 == C2 the result of function calls is consistent, else repeat the procedure from step 1.
     * @param index The first index in the internal array of pending identifiers to fetch.
     * @param limit The maximum number of returned identifiers.
     * @return txIds The array of requested identifiers.
     */
    function getPendingCashOutTxIds(uint256 index, uint256 limit) external view returns (bytes32[] memory);

    /**
     * @dev Returns the pending cash-out balance for an account.
     * @param account The address of the account to check.
     */
    function cashOutBalanceOf(address account) external view returns (uint256);

    /**
     * @dev Returns the pending cash-out operation counter.
     */
    function pendingCashOutCounter() external view returns (uint256);

    /**
     * @dev Returns the address of the underlying token.
     */
    function underlyingToken() external view returns (address);

    /**
     * @dev Returns the number of shards in the proxy.
     */
    function getShardCount() external view returns (uint256);

    /**
     * @dev Returns the shard address by the off-chain transaction identifier.
     * @param txId The off-chain transaction identifier of the operation.
     */
    function getShardByTxId(bytes32 txId) external view returns (address);

    /**
     * @dev Returns the array of shard addresses by the range of indexes.
     * @param startIndex The start index of the range.
     * @param endIndex The end index of the range.
     */
    function getShardsByRange(uint256 startIndex, uint256 endIndex) external view returns (address[] memory);
}


/**
 * @title PixCashierProxy contract storage.
 */
contract PixCashierProxyStorage {
    /// @dev The address of the underlying token.
    address internal _token;

    /// @dev The array of the underlying shard contracts.
    IPixCashierShard[] public _shards;

    /// @dev The mapping of a pending cash-out balance for a given account.
    mapping(address => uint256) internal _cashOutBalances;

    /// @dev The set of off-chain transaction identifiers that correspond the pending cash-out operations.
    EnumerableSet.Bytes32Set internal _pendingCashOutTxIds;

    uint256 public counterCashIn;

    uint256 public counterRequestCashOut;

    uint256 public counterConfirmCashOut;

    uint256 public counterReverseCashOut;

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     */
    uint256[42] private __gap;
}

/**
 * @title PixCashierProxy contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Entry point contract for PIX cash-in and cash-out operations.
 */
contract PixCashierProxy is
    PixCashierProxyStorage,
    AccessControlExtUpgradeable,
    PausableExtUpgradeable,
    RescuableUpgradeable,
    UUPSUpgradeable,
    IPixCashierProxy,
    IPixCashierErrors
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

    /// @dev Thrown when the provided array of off-chain transaction identifiers is empty.
    error EmptyTransactionIdsArray();

    /// @dev Thrown if the minting of tokens failed during a cash-in operation.
    error TokenMintingFailure();

    /// @dev Thrown if the provided amount exceeds the maximum allowed value.
    error AmountExcess();

    /**
     * @dev Thrown if the cash-in operation with the provided txId is already executed.
     */
    error CashInAlreadyExecuted();

    /**
     * @dev Thrown if the cash-in operation with the provided txId has an inappropriate status.
     */
    error InappropriateCashInStatus();

    /**
     * @dev Thrown if the cash-out operation with the provided txId has an inappropriate status.
     */
    error InappropriateCashOutStatus();

    /**
     * @dev Thrown if the cash-out operation cannot be executed for the provided account and txId.
     */
    error InappropriateCashOutAccount();

    /**
     * @dev Thrown if the provided release time for the premint operation is inappropriate.
     */
    error InappropriatePremintReleaseTime();

    /// @dev Throws if the common error occurred.
    error CommonError(Error err);

    /// @dev Throws if the provided range of shards is invalid.
    error InvalidShardRange();

    // ------------------ Initializers ---------------------------- //

    /**
     * @dev Initializer of the upgradable contract.
     * @param token_ The address of the token to set as the underlying one.
     */
    function initialize(address token_) external initializer {
        __PixCashierProxy_init(token_);
    }

    /**
     * @dev Internal initializer of the upgradable contract.
     * @param token_ The address of the token to set as the underlying one.
     */
    function __PixCashierProxy_init(address token_) internal onlyInitializing {
        __Context_init_unchained();
        __ERC165_init_unchained();
        __AccessControl_init_unchained();
        __AccessControlExt_init_unchained();
        __Pausable_init_unchained();
        __PausableExt_init_unchained(OWNER_ROLE);
        __Rescuable_init_unchained(OWNER_ROLE);
        __UUPSUpgradeable_init_unchained();
        __PixCashierProxy_init_unchained(token_);
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
    function __PixCashierProxy_init_unchained(address token_) internal onlyInitializing {
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
     * @inheritdoc IPixCashierProxy
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {CASHIER_ROLE} role.
     * - The provided `account`, `amount`, and `txId` values must not be zero.
     * - The cash-in operation with the provided `txId` must not be already executed.
     */
    function cashIn(
        address account,
        uint256 amount,
        bytes32 txId
    ) external whenNotPaused onlyRole(CASHIER_ROLE) {
        Error err = _shard(txId).registerCashIn(account, amount, txId, CashInStatus.Executed);
        if (err != Error.None) {
            if (err == Error.ZeroAccount) revert ZeroAccount();
            if (err == Error.ZeroAmount) revert ZeroAmount();
            if (err == Error.ZeroTxId) revert ZeroTxId();
            if (err == Error.AmountExcess) revert AmountExcess();
            if (err == Error.CashInAlreadyExecuted) revert CashInAlreadyExecuted();
            revert CommonError(err);
        }

        emit CashIn(account, amount, txId);

        if (!IERC20Mintable(_token).mint(account, amount)) {
            revert TokenMintingFailure();
        }

        counterCashIn++;
    }

    /**
     * @inheritdoc IPixCashierProxy
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {CASHIER_ROLE} role.
     * - The provided `account`, `amount`, `txId` and `releaseTime` values must not be zero.
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

        Error err = _shard(txId).registerCashIn(account, amount, txId, CashInStatus.PremintExecuted);
        if (err != Error.None) {
            if (err == Error.ZeroAccount) revert ZeroAccount();
            if (err == Error.ZeroAmount) revert ZeroAmount();
            if (err == Error.ZeroTxId) revert ZeroTxId();
            if (err == Error.AmountExcess) revert AmountExcess();
            if (err == Error.CashInAlreadyExecuted) revert CashInAlreadyExecuted();
            revert CommonError(err);
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
    function cashInPremintRevoke(
        bytes32 txId,
        uint256 releaseTime
    ) external whenNotPaused onlyRole(CASHIER_ROLE) {
        if (releaseTime == 0) {
            revert InappropriatePremintReleaseTime();
        }

        (address account, uint256 amount, Error err) = _shard(txId).revokeCashIn(txId);
        if (err != Error.None) {
            if (err == Error.ZeroTxId) revert ZeroTxId();
            if (err == Error.InappropriateCashInStatus) revert InappropriateCashInStatus();
            revert CommonError(err);
        }

        emit CashInPremint(account, 0, amount, txId, releaseTime);

        IERC20Mintable(_token).premintDecrease(account, amount, releaseTime);
    }

    /**
     * @inheritdoc IPixCashierProxy
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
     * @inheritdoc IPixCashierProxy
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {CASHIER_ROLE} role.
     * - The `account`, `amount`, and `txId` values must not be zero.
     * - The cash-out operation with the provided `txId` must not be already pending.
     */
    function requestCashOutFrom(
        address account,
        uint256 amount,
        bytes32 txId
    ) external whenNotPaused onlyRole(CASHIER_ROLE) {
        Error err = _shard(txId).registerCashOut(account, amount, txId);
        if (err != Error.None) {
            if (err == Error.ZeroAccount) revert ZeroAccount();
            if (err == Error.ZeroAmount) revert ZeroAmount();
            if (err == Error.ZeroTxId) revert ZeroTxId();
            if (err == Error.AmountExcess) revert AmountExcess();
            if (err == Error.InappropriateCashOutStatus) revert InappropriateCashOutStatus();
            if (err == Error.InappropriateCashOutAccount) revert InappropriateCashOutAccount();
            revert CommonError(err);
        }

        uint256 cashOutBalance = _cashOutBalances[account] + amount;
        _cashOutBalances[account] = cashOutBalance;
        _pendingCashOutTxIds.add(txId);

        emit RequestCashOut(account, amount, cashOutBalance, txId, msg.sender);

        IERC20(_token).safeTransferFrom(account, address(this), amount);

        counterRequestCashOut++;
    }

    /**
     * @inheritdoc IPixCashierProxy
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {CASHIER_ROLE} role.
     * - The provided `txId` value must not be zero.
     * - The cash-out operation corresponded the provided `txId` value must have the pending status.
     */
    function confirmCashOut(bytes32 txId) external whenNotPaused onlyRole(CASHIER_ROLE) {
        (
            address account,
            uint256 amount,
            Error err
        ) = _shard(txId).processCashOut(txId, CashOutStatus.Confirmed);
        if (err != Error.None) {
            if (err == Error.ZeroTxId) revert ZeroTxId();
            if (err == Error.InappropriateCashOutStatus) revert InappropriateCashOutStatus();
            revert CommonError(err);
        }

        uint256 cashOutBalance = _cashOutBalances[account] - amount;
        _cashOutBalances[account] = cashOutBalance;
        _pendingCashOutTxIds.remove(txId);

        emit ConfirmCashOut(account, amount, cashOutBalance, txId);

        IERC20Mintable(_token).burn(amount);

        counterConfirmCashOut++;
    }

    /**
     * @inheritdoc IPixCashierProxy
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {CASHIER_ROLE} role.
     * - The provided `txId` value must not be zero.
     * - The cash-out operation corresponded the provided `txId` value must have the pending status.
     */
    function reverseCashOut(bytes32 txId) external whenNotPaused onlyRole(CASHIER_ROLE) {
        (
            address account,
            uint256 amount,
            Error err
        ) = _shard(txId).processCashOut(txId, CashOutStatus.Reversed);
        if (err != Error.None) {
            if (err == Error.ZeroTxId) revert ZeroTxId();
            if (err == Error.InappropriateCashOutStatus) revert InappropriateCashOutStatus();
            revert CommonError(err);
        }

        uint256 cashOutBalance = _cashOutBalances[account] - amount;
        _cashOutBalances[account] = cashOutBalance;
        _pendingCashOutTxIds.remove(txId);

        emit ReverseCashOut(account, amount, cashOutBalance, txId);

        IERC20(_token).safeTransfer(account, amount);

        counterReverseCashOut++;
    }

    function addShards(address[] memory shards) external onlyRole(OWNER_ROLE) {
        for(uint256 i; i < shards.length; i++)
        {
            _shards.push(IPixCashierShard(shards[i]));
        }
    }

    // ------------------ View functions -------------------------- //

    /**
     * @inheritdoc IPixCashierProxy
     */
    function getCashIn(bytes32 txId) external view returns (CashInOperation memory) {
        return _shard(txId).getCashIn(txId);
    }

    /**
     * @inheritdoc IPixCashierProxy
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
     * @inheritdoc IPixCashierProxy
     */
    function getCashOut(bytes32 txId) external view returns (CashOutOperation memory) {
        return _shard(txId).getCashOut(txId);
    }

    /**
     * @inheritdoc IPixCashierProxy
     */
    function getCashOuts(bytes32[] memory txIds) external view returns (CashOutOperation[] memory) {
        uint256 len = txIds.length;
        CashOutOperation[] memory cashOutOperations = new CashOutOperation[](len);
        for (uint256 i = 0; i < len; i++) {
            cashOutOperations[i] = _shard(txIds[i]).getCashOut(txIds[i]);
        }
        return cashOutOperations;
    }

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

    function cashOutBalanceOf(address account) external view returns (uint256) {
        return _cashOutBalances[account];
    }

    function pendingCashOutCounter() external view returns (uint256) {
        return _pendingCashOutTxIds.length();
    }

    /**
     * @inheritdoc IPixCashierProxy
     */
    function underlyingToken() external view returns (address) {
        return _token;
    }

    /**
     * @inheritdoc IPixCashierProxy
     */
    function getShardCount() external view returns (uint256) {
        return _shards.length;
    }

    /**
     * @inheritdoc IPixCashierProxy
     */
    function getShardByTxId(bytes32 txId) external view returns (address) {
        return address(_shard(txId));
    }

    /**
     * @inheritdoc IPixCashierProxy
     */
    function getShardsByRange(uint256 startIndex, uint256 endIndex) external view returns (address[] memory) {
        if (startIndex >= endIndex || endIndex > _shards.length) {
            revert InvalidShardRange();
        }

        address[] memory shards = new address[](endIndex - startIndex);
        for(uint256 i = startIndex; i < endIndex; i++) {
            shards[i - startIndex] = address(_shards[i]);
        }

        return shards;
    }

    // ------------------ Internal functions ---------------------- //

    /**
     * @dev Returns the shard contract by the off-chain transaction identifier.
     * @param txId The off-chain transaction identifier of the operation.
     */
    function _shard(bytes32 txId) public view returns (IPixCashierShard) {
        return _shards[uint256(txId) % _shards.length];
    }

    /**
     * @dev The upgrade authorization function for UUPSProxy.
     * @param newImplementation The address of the new implementation.
     */
    function _authorizeUpgrade(address newImplementation) internal view override  onlyRole(OWNER_ROLE) {
        newImplementation; // Suppresses a compiler warning about the unused variable.
    }

    // ------------------ Service functions ----------------------- //

    /**
     * @dev Upgrades the range of the underlying shard contracts to the a implementation.
     * @param newImplementation The address of the new shard implementation.
     * @param fromIndex The start index of the range.
     * @param toIndex The end index of the range.
     */
    function upgradeShardsTo(address newImplementation, uint256 fromIndex, uint256 toIndex) external onlyRole(OWNER_ROLE) {
        /**
         * TODO: make this function more secure and reliable.
         */
        for(uint256 i = fromIndex; i < toIndex; i++) {
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
