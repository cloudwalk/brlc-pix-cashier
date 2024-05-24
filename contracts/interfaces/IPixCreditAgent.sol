// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IPixCreditAgentTypes
 * @dev Defines types used in the PixCreditAgent contract.
 */
interface IPixCreditAgentTypes {
    /**
     * @dev Enumeration for the goal of a hook.
     */
    enum HookGoal {
        Restrict,   // 0
        Revoke      // 1
    }

    /**
     * @dev Struct for the data associated with a hook.
     */
    struct HookData {
        uint256 amount;     // The amount associated with the pix operation.
        address account;    // The account address associated with the operation.
        HookGoal goal;      // The goal of the hook (see HookGoal enum).
        bool invoked;       // Flag indicating if the hook has been invoked.
        bytes32 purpose;    // The purpose of the hook, if applicable.
        uint256 loanId;     // The ID of the loan associated with the hook, if applicable.
    }
}

/**
 * @title IPixCreditAgent
 * @dev Interface for the PixCreditAgent contract.
 */
interface IPixCreditAgent is IPixCreditAgentTypes {
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
     * @dev Emitted when the address of the market contract is configured.
     * @param newMarket The new address of the market contract.
     * @param oldMarket The old address of the market contract.
     */
    event MarketAddressConfigured(address indexed newMarket, address indexed oldMarket);

    /**
     * @dev Emitted when a Pix cash-in operation is prepared.
     * @param txId The transaction ID.
     * @param data The data associated with the transaction.
     * @param hookFlags The flags for hooks.
     */
    event PixCashInPrepared(bytes32 indexed txId, HookData data, uint256 hookFlags);

    /**
     * @dev Emitted when a Pix cash-out operation is prepared.
     * @param txId The transaction ID.
     * @param data The data associated with the transaction.
     * @param hookFlags The flags for hooks.
     */
    event PixCashOutPrepared(bytes32 indexed txId, HookData data, uint256 hookFlags);

    /**
    * @dev Emitted when a PixCreditAgent invokes a call after a hook.
    * @param txId The transaction ID.
    * @param goal The goal of other contract invoking.
    */
    event HookInvoked(bytes32 txId, HookGoal goal);

    /**
     * @dev Throws if the given address is zero.
     */
    error ZeroAddress();

    /**
     * @dev Throws if the given amount is zero.
     */
    error ZeroAmount();

    /**
     * @dev Throws if the transaction ID is not registered.
     */
    error TransactionIdNotRegistered();

    /**
     * @dev Throws if the transaction ID is already invoked.
     */
    error TransactionIdAlreadyInvoked();

    /**
     * @dev Throws if the configured goal is invalid.
     */
    error InvalidConfiguredGoal();

    /**
     * @dev Throws if attempting to configure an address that is already configured.
     */
    error AlreadyConfigured();

    /**
     * @dev Prepares for a Pix cash-in operation.
     * @param txId The transaction ID.
     * @param data The data associated with the transaction.
     * @param hookFlags The flags for hooks.
     */
    function preparePixCashIn(bytes32 txId, HookData memory data, uint256 hookFlags) external;

    /**
     * @dev Prepares for a Pix cash-out operation.
     * @param txId The transaction ID.
     * @param data The data associated with the transaction.
     * @param hookFlags The flags for hooks.
     */
    function preparePixCashOut(bytes32 txId, HookData memory data, uint256 hookFlags) external;

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

    /**
     * @dev Configures the address of the lending market contract.
     * @param market The address of the lending market contract.
     */
    function configureMarketAddress(address market) external;
}
