// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title PixCashier types interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines the types used in the PIX cashier contract.
 */
interface IPixCashierTypes {
    /**
     * @dev Possible statuses of a cash-in operation as an enum.
     *
     * The possible values:
     * - Nonexistent ----- The operation does not exist (the default value).
     * - Executed -------- The operation was executed as a common mint.
     * - PremintExecuted - The operation was executed as a premint with some predetermined release time.
     */
    enum CashInStatus {
        Nonexistent,    // 0
        Executed,       // 1
        PremintExecuted // 2
    }

    /**
     * @dev Possible result statuses of a cash-in operation as an enum.
     *
     * The possible values:
     * - Success ------------- The operation was executed successfully.
     * - AlreadyExecuted ----- The operation was already executed.
     * - InappropriateStatus - The operation has inappropriate status and cannot be modified.
     */
    enum CashInExecutionResult {
        Success,            // 0
        AlreadyExecuted,    // 1
        InappropriateStatus // 2
    }

    /**
     * @dev Possible execution policies of a cash-in operation as an enum.
     *
     * The possible values:
     * - Revert - In case of failure the operation will be reverted.
     * - Skip --- In case of failure the operation will be skipped.
     */
    enum CashInExecutionPolicy {
        Revert, // 0
        Skip    // 1
    }

    /**
     * @dev Possible statuses of a cash-out operation as an enum.
     *
     * The possible values:
     * - Nonexistent - The operation does not exist (the default value).
     * - Pending ----- The status immediately after the operation requesting.
     * - Reversed ---- The operation was reversed.
     * - Confirmed --- The operation was confirmed.
     * - Internal ---- The operation executed internally
     */
    enum CashOutStatus {
        Nonexistent, // 0
        Pending,     // 1
        Reversed,    // 2
        Confirmed,   // 3
        Internal     // 4
    }

    /**
     * @dev Indexes of bit flags that are used to process cash-in operations:
     *
     * - SomeHookRegistered - The flag that indicates whether a hook function is registered for the operation.
     *
     * Notes:
     * - 1. This enum is not used in the current implementation.
     * - 2. An example of the code to convert a `CashInFlagIndex` value to a bit flag:
     *
     *    ```solidity
     *    uint256 flag = 1 << uint256(CashInFlagIndex.SomeHookRegistered);
     *    ```
     */
    enum CashInFlagIndex {
        SomeHookRegistered // 0
    }

    /**
     * @dev Indexes of bit flags that are used to process cash-out operations:
     *
     * - SomeHookRegistered - The flag that indicates whether a hook function is registered for the operation.
     *
     * Note: an example of the code to convert a `CashInFlagIndex` value to a bit flag:
     *
     *    ```solidity
     *    uint256 flag = 1 << uint256(CashOutFlagIndex.SomeHookRegistered);
     *    ```
     */
    enum CashOutFlagIndex {
        SomeHookRegistered // 0
    }

    /// @dev Structure with data of a single cash-in operation.
    struct CashInOperation {
        CashInStatus status;  // The status of the cash-in operation according to the {CashInStatus} enum.
        address account;      // The owner of tokens to cash-in.
        uint64 amount;        // The amount of tokens to cash-in.
        uint8 flags;          // The bit field of flags for the operation. See {CashInFlagIndex}.
        // uint16 __reserved; // Reserved for future use until the end of the storage slot.
    }

    /// @dev Structure with data of a single cash-out operation.
    struct CashOutOperation {
        CashOutStatus status;  // The status of the cash-out operation according to the {CashOutStatus} enum.
        address account;       // The owner of tokens to cash-out.
        uint64 amount;         // The amount of tokens to cash-out.
        uint8 flags;           // The bit field of flags for the operation. See {CashOutFlagIndex}.
        // uint16 __reserved;  // Reserved for future use until the end of the storage slot.
    }
}
