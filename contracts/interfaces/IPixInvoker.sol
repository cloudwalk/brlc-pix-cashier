// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IPixInvokerTypes
 * @dev Interface containing data structures for PixInvoker contract.
 * @author Cloudwalk Inc.
 */
interface IPixInvokerTypes {
    struct HookData {
        address account;                // The address associated with the hook.
        uint256 amount;                 // The amount associated with the hook.
        bytes32 restrictionPurpose;     // The purpose of the restriction, if applicable.
        uint256 releaseTime;            // The release time, if applicable.
        HookGoal goal;                  // The goal of the hook function.
    }

    /**
     * @dev Enum representing the goals of hook functions.
     */
    enum HookGoal {
        Default,        // 0: Default goal, used for general hook functions.
        Premint,        // 1: Goal for hook functions related to premint operations.
        Restrict,       // 2: Goal for hook functions related to restriction operations.
        Freeze          // 3: Goal for hook functions related to freezing operations.
    }
}

/**
 * @title IPixInvoker
 * @dev Interface for PixInvoker contract.
 */
interface IPixInvoker is IPixInvokerTypes {
    /**
     * @dev Emitted when the address of the Pix contract is configured.
     * @param newPix The new address of the Pix contract.
     * @param oldPix The old address of the Pix contract.
     */
    event PixAddressConfigured(address indexed newPix, address indexed oldPix);

    /**
     * @dev Emitted when the address of the token contract is configured.
     * @param newToken The new address of the token contract.
     * @param oldToken The old address of the token contract.
     */
    event TokenAddressConfigured(address indexed newToken, address indexed oldToken);

    /**
     * @dev Emitted when hook data is submitted for a transaction.
     * @param txId The unique identifier of the transaction.
     * @param data The hook data submitted.
     */
    event HookDataSubmitted(bytes32 indexed txId, HookData data);

    /**
     * @dev Error emitted when attempting to use a zero address.
     */
    error ZeroAddress();

    /**
     * @dev Error emitted when attempting to configure an address that is already configured.
     */
    error AlreadyConfigured();

    /**
     * @dev Error emitted when submitted data is invalid.
     */
    error InvalidSubmittedData();

    /**
     * @dev Registers a transaction and invokes Pix Cashier for default cash-in operations.
     * @param hookKind The kind of hook to be registered.
     * @param callableContract The address of the callable contract.
     * @param txId The unique identifier of the transaction.
     * @param data The hook data to associate with the transaction.
     */
    function registerTxAndInvokeDefaultPixCashIn(
        uint256 hookKind,
        address callableContract,
        bytes32 txId,
        HookData memory data
    ) external;

    /**
     * @dev Registers a transaction and invokes Pix Cashier for premint cash-in operations.
     * @param hookKind The kind of hook to be registered.
     * @param callableContract The address of the callable contract.
     * @param txId The unique identifier of the transaction.
     * @param data The hook data to associate with the transaction.
     */
    function registerTxAndInvokePremintCashIn(
        uint256 hookKind,
        address callableContract,
        bytes32 txId,
        HookData memory data
    ) external;

    /**
     * @dev Registers a transaction and invokes Pix Cashier for cash-out request operations.
     * @param hookKind The kind of hook to be registered.
     * @param callableContract The address of the callable contract.
     * @param txId The unique identifier of the transaction.
     * @param data The hook data to associate with the transaction.
     */
    function registerTxAndInvokeCashOutRequest(
        uint256 hookKind,
        address callableContract,
        bytes32 txId,
        HookData memory data
    ) external;

    /**
     * @dev Registers a transaction and invokes Pix Cashier for cash-out confirmation operations.
     * @param hookKind The kind of hook to be registered.
     * @param callableContract The address of the callable contract.
     * @param txId The unique identifier of the transaction.
     * @param data The hook data to associate with the transaction.
     */
    function registerTxAndInvokeCashOutConfirmation(
        uint256 hookKind,
        address callableContract,
        bytes32 txId,
        HookData memory data
    ) external;

    /**
     * @dev Registers a transaction and invokes Pix Cashier for cash-out reversal operations.
     * @param hookKind The kind of hook to be registered.
     * @param callableContract The address of the callable contract.
     * @param txId The unique identifier of the transaction.
     * @param data The hook data to associate with the transaction.
     */
    function registerTxAndInvokeCashOutReversal(
        uint256 hookKind,
        address callableContract,
        bytes32 txId,
        HookData memory data
    ) external;

    /**
     * @dev Registers cash-in hooks for a transaction.
     * @param txId The unique identifier of the transaction.
     * @param newCallableContract The address of the new callable contract.
     * @param newHookFlags The flags indicating the hook types to register.
     * @param data The hook data to associate with the transaction.
     */
    function registerCashInHooks(
        bytes32 txId,
        address newCallableContract,
        uint256 newHookFlags,
        HookData memory data
    ) external;

    /**
     * @dev Registers cash-out hooks for a transaction.
     * @param txId The unique identifier of the transaction.
     * @param newCallableContract The address of the new callable contract.
     * @param newHookFlags The flags indicating the hook types to register.
     * @param data The hook data to associate with the transaction.
     */
    function registerCashOutHooks(
        bytes32 txId,
        address newCallableContract,
        uint256 newHookFlags,
        HookData memory data
    ) external;

    /**
     * @dev Configures the address of the Pix contract.
     * @param pix The address of the Pix contract.
     */
    function configurePixAddress(address pix) external;

    /**
     * @dev Configures the address of the token contract.
     * @param token The address of the token contract.
     */
    function configureTokenAddress(address token) external;
}