// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import { AccessControlExtUpgradeable } from "./base/AccessControlExtUpgradeable.sol";
import { PausableExtUpgradeable } from "./base/PausableExtUpgradeable.sol";
import { RescuableUpgradeable } from "./base/RescuableUpgradeable.sol";

import { PixCashierStorage } from "./PixCashierStorage.sol";

import { IERC20Mintable } from "./interfaces/IERC20Mintable.sol";
import { IPixCashier } from "./interfaces/IPixCashier.sol";

/**
 * @title PixCashier contract
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Wrapper contract for PIX cash-in and cash-out operations.
 */
contract PixCashier is
    PixCashierStorage,
    AccessControlExtUpgradeable,
    PausableExtUpgradeable,
    RescuableUpgradeable,
    UUPSUpgradeable,
    IPixCashier
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

    /// @dev Thrown if the provided off-chain transaction batch identifier is zero.
    error ZeroBatchId();

    /// @dev Thrown when the provided array of off-chain transaction identifiers is empty.
    error EmptyTransactionIdsArray();

    /// @dev Thrown if the minting of tokens failed during a cash-in operation.
    error TokenMintingFailure();

    /// @dev Thrown if the bath arrays are empty or have different lengths.
    error InvalidBatchArrays();

    /// @dev Thrown if the provided amount exceeds the maximum allowed value.
    error AmountExcess();

    /**
     * @dev Thrown if the cash-in operation with the provided txId is already executed.
     * @param txId The off-chain transaction identifiers of the operation.
     */
    error CashInAlreadyExecuted(bytes32 txId);

    /**
     * @dev Thrown if the cash-in batch operation with the provided batchId is already executed.
     * @param batchId The off-chain transaction identifiers of the operation.
     */
    error CashInBatchAlreadyExecuted(bytes32 batchId);

    /**
     * @dev Thrown if the cash-in operation with the provided txId has an inappropriate status.
     * @param txId The off-chain transaction identifiers of the operation.
     * @param status The current status of the operation.
     */
    error InappropriateCashInStatus(bytes32 txId, CashInStatus status);

    /**
     * @dev Thrown if the cash-out operation with the provided txId has an inappropriate status.
     * @param txId The off-chain transaction identifiers of the operation.
     * @param status The current status of the operation.
     */
    error InappropriateCashOutStatus(bytes32 txId, CashOutStatus status);

    /**
     * @dev Thrown if the cash-out operation cannot be executed for the provided account and txId.
     * @param txId The off-chain transaction identifiers of the operation.
     * @param account The account that must be used for the operation.
     */
    error InappropriateCashOutAccount(bytes32 txId, address account);

    /**
     * @dev Thrown if the provided release time for the premint operation is inappropriate.
     */
    error InappropriatePremintReleaseTime();

    // ------------------ Initializers ---------------------------- //

    /**
     * @dev Initializer of the upgradable contract.
     * @param token_ The address of the token to set as the underlying one.
     */
    function initialize(address token_) external initializer {
        __PixCashier_init(token_);
    }

    /**
     * @dev Internal initializer of the upgradable contract.
     * @param token_ The address of the token to set as the underlying one.
     */
    function __PixCashier_init(address token_) internal onlyInitializing {
        __Context_init_unchained();
        __ERC165_init_unchained();
        __AccessControl_init_unchained();
        __AccessControlExt_init_unchained();
        __Pausable_init_unchained();
        __PausableExt_init_unchained(OWNER_ROLE);
        __Rescuable_init_unchained(OWNER_ROLE);
        __UUPSUpgradeable_init_unchained();

        __PixCashier_init_unchained(token_);
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
    function __PixCashier_init_unchained(address token_) internal onlyInitializing {
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
     * @inheritdoc IPixCashier
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
        _cashIn(
            account,
            amount,
            txId,
            0, // releaseTime
            CashInExecutionPolicy.Revert
        );
    }

    /**
     * @inheritdoc IPixCashier
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
        _cashIn(
            account,
            amount,
            txId,
            releaseTime,
            CashInExecutionPolicy.Revert
        );
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
        _cashInPremintRevoke(
            txId,
            releaseTime,
            CashInExecutionPolicy.Revert
        );
    }

    /**
     * @inheritdoc IPixCashier
     *
     * @dev Requirements:
     *
     * - The length of each passed array must be equal.
     * - The contract must not be paused.
     * - The caller must have the {CASHIER_ROLE} role.
     * - The provided `account`, `amount`, and `txId` values must not be zero.
     * - The provided `accounts`, `amounts`, `txIds` arrays must not be empty and must have the same length.
     * - The provided `batchId` must not be zero.
     * - The cash-in batch operation with the provided `batchId` must not be already executed.
     * - Each cash-in operation with the provided identifier from the `txIds` array must not be already executed.
     */
    function cashInBatch(
        address[] memory accounts,
        uint256[] memory amounts,
        bytes32[] memory txIds,
        bytes32 batchId
    ) external whenNotPaused onlyRole(CASHIER_ROLE) {
        _cashInBatch(
            accounts,
            amounts,
            txIds,
            0, // releaseTime
            batchId
        );
    }

    /**
     * @inheritdoc IPixCashier
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {CASHIER_ROLE} role.
     * - The provided `account`, `amount`, and `txId` values must not be zero.
     * - The provided `accounts`, `amounts`, `txIds` arrays must not be empty and must have the same length.
     * - The provided `batchId` and `releaseTime` must not be zero.
     * - The cash-in batch operation with the provided `batchId` must not be already executed.
     */
    function cashInPremintBatch(
        address[] memory accounts,
        uint256[] memory amounts,
        bytes32[] memory txIds,
        uint256 releaseTime,
        bytes32 batchId
    ) external whenNotPaused onlyRole(CASHIER_ROLE) {
        if (releaseTime == 0) {
            revert InappropriatePremintReleaseTime();
        }
        _cashInBatch(
            accounts,
            amounts,
            txIds,
            releaseTime,
            batchId
        );
    }

    /**
     * @inheritdoc IPixCashier
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {CASHIER_ROLE} role.
     * - The provided `txId` values must not be zero.
     * - The provided `txIds` array must not be empty.
     * - The provided `batchId` and `releaseTime` must not be zero.
     * - The cash-in batch operation with the provided `batchId` must not be already executed.
     */
    function cashInPremintRevokeBatch(
        bytes32[] memory txIds,
        uint256 releaseTime,
        bytes32 batchId
    ) external whenNotPaused onlyRole(CASHIER_ROLE) {
        _cashInPremintRevokeBatch(
            txIds,
            releaseTime,
            batchId
        );
    }

    /**
     * @inheritdoc IPixCashier
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
     * @inheritdoc IPixCashier
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
        _requestCashOut(_msgSender(), account, amount, txId);
    }

    /**
     * @inheritdoc IPixCashier
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {CASHIER_ROLE} role.
     * - Each `account`, `amount`, and `txId` values in the provided arrays must not be zero.
     * - Each cash-out operation with the provided `txId` in the array must not be already pending.
     */
    function requestCashOutFromBatch(
        address[] memory accounts,
        uint256[] memory amounts,
        bytes32[] memory txIds
    ) external whenNotPaused onlyRole(CASHIER_ROLE) {
        if (accounts.length != amounts.length || accounts.length != txIds.length) {
            revert InvalidBatchArrays();
        }

        for (uint256 i = 0; i < accounts.length; i++) {
            _requestCashOut(_msgSender(), accounts[i], amounts[i], txIds[i]);
        }
    }

    /**
     * @inheritdoc IPixCashier
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {CASHIER_ROLE} role.
     * - The provided `txId` value must not be zero.
     * - The cash-out operation corresponded the provided `txId` value must have the pending status.
     */
    function confirmCashOut(bytes32 txId) external whenNotPaused onlyRole(CASHIER_ROLE) {
        _processCashOut(txId, CashOutStatus.Confirmed);
    }

    /**
     * @inheritdoc IPixCashier
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {CASHIER_ROLE} role.
     * - The input `txIds` array must not be empty.
     * - All the values in the input `txIds` array must not be zero.
     * - All the cash-out operations corresponded the values in the input `txIds` array must have the pending status.
     */
    function confirmCashOutBatch(bytes32[] memory txIds) external whenNotPaused onlyRole(CASHIER_ROLE) {
        uint256 len = txIds.length;
        if (len == 0) {
            revert EmptyTransactionIdsArray();
        }

        for (uint256 i = 0; i < len; i++) {
            _processCashOut(txIds[i], CashOutStatus.Confirmed);
        }
    }

    /**
     * @inheritdoc IPixCashier
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {CASHIER_ROLE} role.
     * - The provided `txId` value must not be zero.
     * - The cash-out operation corresponded the provided `txId` value must have the pending status.
     */
    function reverseCashOut(bytes32 txId) external whenNotPaused onlyRole(CASHIER_ROLE) {
        _processCashOut(txId, CashOutStatus.Reversed);
    }

    /**
     * @inheritdoc IPixCashier
     *
     * @dev Requirements:
     *
     * - The contract must not be paused.
     * - The caller must have the {CASHIER_ROLE} role.
     * - The input `txIds` array must not be empty.
     * - All the values in the input `txIds` array must not be zero.
     * - All the cash-out operations corresponded the values in the input `txIds` array must have the pending status.
     */
    function reverseCashOutBatch(bytes32[] memory txIds) external whenNotPaused onlyRole(CASHIER_ROLE) {
        uint256 len = txIds.length;
        if (len == 0) {
            revert EmptyTransactionIdsArray();
        }

        for (uint256 i = 0; i < len; i++) {
            _processCashOut(txIds[i], CashOutStatus.Reversed);
        }
    }

    // ------------------ View functions -------------------------- //

    /**
     * @inheritdoc IPixCashier
     */
    function getCashIn(bytes32 txId) external view returns (CashInOperation memory) {
        return _cashInOperations[txId];
    }

    /**
     * @inheritdoc IPixCashier
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
     * @inheritdoc IPixCashier
     */
    function getCashInBatch(bytes32 batchId) external view returns (CashInBatchOperation memory) {
        return _cashInBatchOperations[batchId];
    }

    /**
     * @inheritdoc IPixCashier
     */
    function getCashInBatches(bytes32[] memory batchIds) external view returns (CashInBatchOperation[] memory) {
        uint256 len = batchIds.length;
        CashInBatchOperation[] memory cashInBatches = new CashInBatchOperation[](len);
        for (uint256 i = 0; i < len; i++) {
            cashInBatches[i] = _cashInBatchOperations[batchIds[i]];
        }
        return cashInBatches;
    }

    /**
     * @inheritdoc IPixCashier
     */
    function getCashOut(bytes32 txIds) external view returns (CashOutOperation memory) {
        return _cashOutOperations[txIds];
    }

    /**
     * @inheritdoc IPixCashier
     */
    function getCashOuts(bytes32[] memory txIds) external view returns (CashOutOperation[] memory) {
        uint256 len = txIds.length;
        CashOutOperation[] memory cashOutOperations = new CashOutOperation[](len);
        for (uint256 i = 0; i < len; i++) {
            cashOutOperations[i] = _cashOutOperations[txIds[i]];
        }
        return cashOutOperations;
    }

    /**
     * @inheritdoc IPixCashier
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
     * @inheritdoc IPixCashier
     */
    function cashOutBalanceOf(address account) external view returns (uint256) {
        return _cashOutBalances[account];
    }

    /**
     * @inheritdoc IPixCashier
     */
    function pendingCashOutCounter() external view returns (uint256) {
        return _pendingCashOutTxIds.length();
    }

    /**
     * @inheritdoc IPixCashier
     */
    function underlyingToken() external view returns (address) {
        return _token;
    }

    // ------------------ Internal functions ---------------------- //

    /**
     * @dev Executes a cash-in operation internally depending on execution policy.
     *
     * If the release time is zero then the operation is executed as a common mint otherwise as a premint.
     *
     * @param account The address of the tokens recipient.
     * @param amount The amount of tokens to be received.
     * @param txId The off-chain transaction identifier of the operation.
     * @param releaseTime The timestamp when the tokens will be released.
     * @param policy The execution policy of the operation.
     * @return The result of the operation according to the appropriate enum.
     */
    function _cashIn(
        address account,
        uint256 amount,
        bytes32 txId,
        uint256 releaseTime,
        CashInExecutionPolicy policy
    ) internal returns (CashInExecutionResult) {
        if (account == address(0)) {
            revert ZeroAccount();
        }
        if (amount == 0) {
            revert ZeroAmount();
        }
        if (amount > type(uint64).max) {
            revert AmountExcess();
        }
        if (txId == 0) {
            revert ZeroTxId();
        }

        CashInOperation storage operation = _cashInOperations[txId];
        if (operation.status != CashInStatus.Nonexistent) {
            if (policy == CashInExecutionPolicy.Skip) {
                return CashInExecutionResult.AlreadyExecuted;
            } else {
                revert CashInAlreadyExecuted(txId);
            }
        }

        if (releaseTime == 0) {
            operation.status = CashInStatus.Executed;
            operation.account = account;
            operation.amount = uint64(amount);
            emit CashIn(account, amount, txId);
            if (!IERC20Mintable(_token).mint(account, amount)) {
                revert TokenMintingFailure();
            }
        } else {
            operation.status = CashInStatus.PremintExecuted;
            operation.account = account;
            operation.amount = uint64(amount);
            emit CashInPremint(account, amount, 0, txId, releaseTime);
            IERC20Mintable(_token).premintIncrease(account, amount, releaseTime);
        }

        return CashInExecutionResult.Success;
    }

    /**
     * @dev Revokes a cash-in premint operation internally.
     *
     * @param txId The off-chain transaction identifier of the operation.
     * @param releaseTime The timestamp when the tokens will be released.
     */
    function _cashInPremintRevoke(
        bytes32 txId,
        uint256 releaseTime,
        CashInExecutionPolicy policy
    ) internal returns (CashInExecutionResult) {
        if (txId == 0) {
            revert ZeroTxId();
        }
        if (releaseTime == 0) {
            revert InappropriatePremintReleaseTime();
        }

        CashInOperation storage cashIn_ = _cashInOperations[txId];
        address account = cashIn_.account;

        if (cashIn_.status != CashInStatus.PremintExecuted) {
            if (policy == CashInExecutionPolicy.Skip) {
                return CashInExecutionResult.InappropriateStatus;
            } else {
                revert InappropriateCashInStatus(txId, cashIn_.status);
            }
        }

        uint256 oldAmount = cashIn_.amount;
        // Clearing by fields instead of `delete _cashInOperations[txId]` is due to less gas usage and bytecode size
        cashIn_.status = CashInStatus.Nonexistent;
        cashIn_.amount = 0;
        cashIn_.account = address(0);

        emit CashInPremint(account, 0, oldAmount, txId, releaseTime);

        IERC20Mintable(_token).premintDecrease(account, oldAmount, releaseTime);

        return CashInExecutionResult.Success;
    }

    /**
     * @dev Executes a cash-in batch operation internally depending on the release time.
     * @param accounts The array of the addresses of the tokens recipient.
     * @param amounts The array of the token amounts to be received.
     * @param txIds The array of the off-chain transaction identifiers of the operation.
     * @param releaseTime Zero if the cash-ins are common otherwise the release time of the preminted tokens.
     * @param batchId The off-chain batch identifier.
     */
    function _cashInBatch(
        address[] memory accounts,
        uint256[] memory amounts,
        bytes32[] memory txIds,
        uint256 releaseTime,
        bytes32 batchId
    ) internal {
        if (
            accounts.length == 0 ||
            accounts.length != amounts.length ||
            accounts.length != txIds.length
        ) {
            revert InvalidBatchArrays();
        }
        if (_cashInBatchOperations[batchId].status != CashInBatchStatus.Nonexistent) {
            revert CashInBatchAlreadyExecuted(batchId);
        }
        if (batchId == 0) {
            revert ZeroBatchId();
        }

        CashInExecutionResult[] memory executionResults = new CashInExecutionResult[](txIds.length);

        for (uint256 i = 0; i < accounts.length; i++) {
            executionResults[i] = _cashIn(
                accounts[i],
                amounts[i],
                txIds[i],
                releaseTime,
                CashInExecutionPolicy.Skip
            );
        }

        if (releaseTime == 0) {
            _cashInBatchOperations[batchId].status = CashInBatchStatus.Executed;
        } else {
            _cashInBatchOperations[batchId].status = CashInBatchStatus.PremintExecuted;
        }

        emit CashInBatch(batchId, txIds, executionResults);
    }

    /**
     * @dev Executes a batch revocation of cash-in premint operations internally.
     * @param txIds The array of the off-chain transaction identifiers of the operation.
     * @param releaseTime The release time of the preminted tokens.
     * @param batchId The off-chain batch identifier.
     */
    function _cashInPremintRevokeBatch(
        bytes32[] memory txIds,
        uint256 releaseTime,
        bytes32 batchId
    ) internal {
        if (txIds.length == 0) {
            revert InvalidBatchArrays();
        }
        if (releaseTime == 0) {
            revert InappropriatePremintReleaseTime();
        }
        if (batchId == 0) {
            revert ZeroBatchId();
        }
        if (_cashInBatchOperations[batchId].status != CashInBatchStatus.Nonexistent) {
            revert CashInBatchAlreadyExecuted(batchId);
        }

        CashInExecutionResult[] memory executionResults = new CashInExecutionResult[](txIds.length);

        for (uint256 i = 0; i < txIds.length; i++) {
            executionResults[i] = _cashInPremintRevoke(
                txIds[i],
                releaseTime,
                CashInExecutionPolicy.Skip
            );
        }

        _cashInBatchOperations[batchId].status = CashInBatchStatus.PremintExecuted;

        emit CashInBatch(batchId, txIds, executionResults);
    }

    /**
     * @dev Executes a cash-out request operation internally.
     * @param sender The address of the caller of the operation.
     * @param account The account on that behalf the operation is made.
     * @param amount The amount of tokens to be cash-outed.
     * @param txId The off-chain transaction identifier of the operation.
     */
    function _requestCashOut(
        address sender,
        address account,
        uint256 amount,
        bytes32 txId
    ) internal {
        if (account == address(0)) {
            revert ZeroAccount();
        }
        if (amount == 0) {
            revert ZeroAmount();
        }
        if (amount > type(uint64).max) {
            revert AmountExcess();
        }
        if (txId == 0) {
            revert ZeroTxId();
        }

        CashOutOperation storage operation = _cashOutOperations[txId];
        CashOutStatus status = operation.status;
        if (status == CashOutStatus.Pending || status == CashOutStatus.Confirmed) {
            revert InappropriateCashOutStatus(txId, status);
        } else if (status == CashOutStatus.Reversed && operation.account != account) {
            revert InappropriateCashOutAccount(txId, operation.account);
        }

        operation.status = CashOutStatus.Pending;
        operation.account = account;
        operation.amount = uint64(amount);

        uint256 newCashOutBalance = _cashOutBalances[account] + amount;
        _cashOutBalances[account] = newCashOutBalance;
        _pendingCashOutTxIds.add(txId);

        emit RequestCashOut(account, amount, newCashOutBalance, txId, sender);

        IERC20(_token).safeTransferFrom(account, address(this), amount);
    }

    /**
     * @notice Processes a previously requested cash-out operation internally.
     * @param txId The off-chain transaction identifier of the operation.
     * @param targetStatus The target status of the cash-out operation.
     */
    function _processCashOut(bytes32 txId, CashOutStatus targetStatus) internal {
        if (txId == 0) {
            revert ZeroTxId();
        }

        CashOutOperation storage operation = _cashOutOperations[txId];
        CashOutStatus status = operation.status;
        if (status != CashOutStatus.Pending) {
            revert InappropriateCashOutStatus(txId, status);
        }

        address account = operation.account;
        uint256 amount = operation.amount;
        uint256 newCashOutBalance = _cashOutBalances[account] - amount;

        _cashOutBalances[account] = newCashOutBalance;
        _pendingCashOutTxIds.remove(txId);

        operation.status = targetStatus;

        if (targetStatus == CashOutStatus.Confirmed) {
            emit ConfirmCashOut(account, amount, newCashOutBalance, txId);
            IERC20Mintable(_token).burn(amount);
        } else {
            emit ReverseCashOut(account, amount, newCashOutBalance, txId);
            IERC20(_token).safeTransfer(account, amount);
        }
    }

    /**
     * @dev The upgrade authorization function for UUPSProxy.
     */
    function _authorizeUpgrade(address newImplementation) internal view override {
        newImplementation; // Suppresses a compiler warning about the unused variable
        _checkRole(OWNER_ROLE);
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
