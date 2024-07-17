// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title PixHookable types interface
 * @author CloudWalk Inc. (See https://cloudwalk.io)
 * @dev Defines the types used in the PixHookable contract.
 */
interface IPixHookableTypes {
    /**
     * @dev Possible indexes of hooks that are used to apply additional external actions during some operation steps.
     *
     * Those actions are triggered through the hook function that are implemented in external contracts and
     * called by the PixCashier contract at concrete moments.
     * The index of the hook is passed to the hook function to indicate when it was called.
     *
     * The possible values:
     *
     * - CashInCommonBefore -------- Called before the token transfer during a common cash-in operation.
     * - CashInCommonAfter --------- Called before the token transfer during a common cash-in operation.
     * - CashInPremintBefore ------- Called before the token transfer during a premint cash-in operation.
     * - CashInPremintAfter -------- Called after the token transfer during a premint cash-in operation.
     * - Reserved1 ----------------- Reserved for the future.
     * - Reserved2 ----------------- Reserved for the future.
     * - CashOutRequestBefore ------ Called before the token transfer during a cash-out request operation.
     * - CashOutRequestAfter ------- Called after the token transfer during a cash-out request operation.
     * - CashOutConfirmationBefore - Called before the token transfer during a cash-out confirmation operation.
     * - CashOutConfirmationAfter -- Called after the token transfer during a cash-out confirmation operation.
     * - CashOutReversalBefore ----- Called before the token transfer during a cash-out reversal operation.
     * - CashOutReversalAfter ------ Called after the token transfer during a cash-out reversal operation.
     *
     * Notes:
     *
     * - 1. Hooks with indexes from 0 to 5 including are not used in the current implementation.
     * - 2. The hook with index `CashOutRequestAfter` is not called during internal cash-out operations.
     * - 3. An example of the code to convert a `HookIndex` value to bit flags:
     *
     *    ```solidity
     *    uint256 flag1 = 1 << uint256(HookIndex.CashOutRequestBefore);
     *    uint256 flag2 = 1 << uint256(HookIndex.CashOutConfirmationAfter);
     *    uint256 flag3 = 1 << uint256(HookIndex.CashOutReversalAfter);
     *    uint256 flags = flag1 + flag2 + flag3;
     *    ```
     */
    enum HookIndex {
        CashInCommonBefore,        // 0
        CashInCommonAfter,         // 1
        CashInPremintBefore,       // 2
        CashInPremintAfter,        // 3
        Reserved1,                 // 4
        Reserved2,                 // 5
        CashOutRequestBefore,      // 6
        CashOutRequestAfter,       // 7
        CashOutConfirmationBefore, // 8
        CashOutConfirmationAfter,  // 9
        CashOutReversalBefore,     // 10
        CashOutReversalAfter       // 11
    }

    /**
     * @dev The hook configuration for a concrete PIX operation.
     *
     * See notes for the {HookIndex} enumeration.
     */
    struct HookConfig {
        address callableContract; // The address of the contract that implements the hook function.
        uint32 hookFlags;         // The bit flags that define when the hook function should be called
        // uint64 __reserved;     // Reserved for future use until the end of the storage slot.
    }
}

/**
 * @title PixHookable interface
 * @author CloudWalk Inc. (See https://cloudwalk.io)
 * @dev The interface of an addition to the PixCashier contract that allows to call a hook function during some actions.
 */
interface IPixHookable is IPixHookableTypes {
    // ------------------ Events ---------------------------------- //

    /// @dev Emitted when the hook configuration is changed for a PIX cash-out operation.
    event CashOutHooksConfigured(
        bytes32 indexed txId, // Tools: this comment prevents Prettier from formatting into a single line.
        address newCallableContract,
        address oldCallableContract,
        uint256 newHookFlags,
        uint256 oldHookFlags
    );

    /// @dev Emitted when a hook function is called.
    event HookInvoked(
        bytes32 indexed txId, // Tools: this comment prevents Prettier from formatting into a single line.
        uint256 indexed hookIndex,
        address callableContract
    );

    // ------------------ Functions ------------------------------- //

    /**
     * @dev Configures the hook logic for a PIX cash-out operation.
     * @param txId The unique off-chain transaction identifier of the related PIX operation.
     * @param newCallableContract The address of the contract that implements the hook function to be called.
     * @param newHookFlags The bit flags that define when the hook function should be called.
     *        See notes for the {HookIndex} enumeration.
     */
    function configureCashOutHooks(bytes32 txId, address newCallableContract, uint256 newHookFlags) external;

    /**
     * @dev Returns the current hook configuration for a PIX cash-out operation.
     * @param txId The unique off-chain transaction identifier of the PIX operation.
     * @return The hook configuration structure.
     */
    function getCashOutHookConfig(bytes32 txId) external view returns (HookConfig memory);
}
