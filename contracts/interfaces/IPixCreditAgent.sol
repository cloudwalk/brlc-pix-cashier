// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title PixCredit types interface
 */
interface IPixCreditAgentTypes {
    /// @dev TODO
    enum PixCreditStatus {
        Nonexistent, // 0
        Initiated,   // 1
        Pending,     // 2
        Confirmed,   // 3
        Reversed     // 4
    }

    /// @dev TODO
    struct PixCredit {
        // Slot 1
        address borrower;
        uint32 programId;
        uint32 durationInPeriods;
        PixCreditStatus status;
        // Slot 2
        uint64 loanAmount;
        uint64 loanAddon;
        // Slot 3
        uint256 loanId;
    }

    /// @dev TODO
    struct AgentState {
        // Slot 1
        uint64 initiatedCreditCounter;
        uint64 pendingCreditCounter;
        uint64 processedCreditCounter;
        bool configured;
        // uint56 reserved // Reserved for future use.
    }
}

/**
 * @title PixCreditAgent main interface
 * @dev The main part of the contract interface for PIX credit operations.
 */
interface IPixCreditAgentMain is IPixCreditAgentTypes {
    /**
     * @dev TODO
     */
    event PixCreditStatusChanged(
        bytes32 indexed pixTxId,
        address indexed borrower,
        PixCreditStatus newStatus,
        PixCreditStatus oldStatus,
        uint256 loanId, // Zero if not taken
        uint256 programId,
        uint256 durationInPeriods,
        uint256 loanAmount,
        uint256 loanAddon
    );

    /**
     * @dev TODO
     */
    function initiatePixCredit(
        bytes32 pixTxId,
        address borrower,
        uint256 programId,
        uint256 durationInPeriods,
        uint256 loanAmount,
        uint256 loanAddon
    ) external;

    /**
     * @dev TODO
     */
    function revokePixCredit(bytes32 pixTxId) external;

    /**
     * @dev TODO
     */
    function getPixCredit(bytes32 pixTxId) external view returns (PixCredit memory);

    /**
     * @dev TODO
     */
    function agentState() external view returns (AgentState memory);
}

/**
 * @title PixCreditAgent configuration interface
 * @dev The configuration part of the contract interface for PIX credit operations.
 */
interface IPixCreditAgentConfiguration is IPixCreditAgentTypes {
    /**
     * @dev TODO
     */
    event PixCashierChanged(address newPixCashier, address oldPixCashier);

    /**
     * @dev TODO
     */
    event LendingMarketChanged(address newLendingMarket, address oldLendingMarket);

    /**
     * @dev TODO
     */
    function setPixCashier(address newPixCashier) external;

    /**
     * @dev TODO
     */
    function setLendingMarket(address newLendingMarket) external;

    /**
     * @dev TODO
     */
    function pixCashier() external view returns (address);

    /**
     * @dev TODO
     */
    function lendingMarket() external view returns (address);
}

/**
 * @title PixCreditAgent full interface
 * @dev The full interface of the contract for PIX credit operations.
 */
interface IPixCreditAgent is IPixCreditAgentMain, IPixCreditAgentConfiguration {}
