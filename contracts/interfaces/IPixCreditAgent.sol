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
    enum PixCreditStatus {
        Nonexistent, // 0
        Prepared,    // 1
        Taken,       // 2
        Reversed     // 3
    }

    /**
     * @dev Struct for the data associated with a hook.
     */
    struct PixCredit {
        // Slot 1
        uint256 loanId;     // The ID of the loan associated with the hook, if applicable.

        // Slot 2
        address account;    // TODO
        uint64  amount;     // TODO
        PixCreditStatus status; // TODO
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
     * @dev TODO
     */
    event PixCreditPrepared(bytes32 indexed pixTxId, uint256 indexed loanId);

    /**
     * @dev TODO
     */
    event PixCreditChanged(bytes32 indexed pixTxId, uint256 indexed loanId);

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
     * @dev TODO
     */
    error PixTxIdZero();

    /**
     * @dev TODO
     */
    error LoanIdZero();

    /// @dev TODO
    error PixCreditInAction(PixCreditStatus currentStatus);

    /**
     * @dev TODO
     */
    function preparePixCredit(bytes32 pixTxId, uint256 loanId) external;

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
