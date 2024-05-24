// SPDX-License-Identifier: MIT

pragma solidity ^0.8.16;

/**
 * @title PixHookable types interface
 * @dev Interface defining types related to hookable functions.
 * @author Cloudwalk Inc.
 */
interface IPixHookableTypes {
    /**
     * @dev Possible types of hook functions that can be called by the contract during concrete actions.
     */
    enum HookKind {
        CashInDefaultBefore,        // 0
        CashInDefaultAfter,         // 1
        CashInPremintBefore,        // 2
        CashInPremintAfter,         // 3
        CashOutRequestBefore,       // 4
        CashOutRequestAfter,        // 5
        CashOutConfirmationBefore,  // 6
        CashOutConfirmationAfter,   // 7
        CashOutReversalBefore,      // 8
        CashOutReversalAfter        // 9
    }

    /**
     * @dev Configuration struct for hooks.
     * @param callableContract The address of the contract implementing hook functions.
     * @param hookFlags Flags indicating which and how hook functions should be called.
     */
    struct HooksConfig {
        address callableContract;
        uint256 hookFlags;
    }
}

/**
 * @title PixHookable interface
 * @dev Interface for adding hook functions to the PixCashier contract to enable calling hooks during specific actions.
 * @author Cloudwalk Inc.
 */
interface IPixHookable is IPixHookableTypes {
    /**
     * @dev Emitted when cash-in hooks are registered.
     * @param txId Transaction ID.
     * @param newCallableContract Address of the new callable contract.
     * @param oldCallableContract Address of the old callable contract.
     * @param newHookFlags New hook flags.
     * @param oldHookFlags Old hook flags.
     */
    event CashInHooksRegistered(
        bytes32 indexed txId,
        address newCallableContract,
        address oldCallableContract,
        uint256 newHookFlags,
        uint256 oldHookFlags
    );

    /**
     * @dev Emitted when cash-out hooks are registered.
     * @param txId Transaction ID.
     * @param newCallableContract Address of the new callable contract.
     * @param oldCallableContract Address of the old callable contract.
     * @param newHookFlags New hook flags.
     * @param oldHookFlags Old hook flags.
     */
    event CashOutHooksRegistered(
        bytes32 indexed txId,
        address newCallableContract,
        address oldCallableContract,
        uint256 newHookFlags,
        uint256 oldHookFlags
    );

    /**
     * @dev Emitted when a hook is invoked.
     * @param txId Transaction ID.
     * @param hookKind Kind of hook that was invoked.
     * @param callableContract Address of the contract where the hook function is implemented.
     */
    event HookInvoked(
        bytes32 indexed txId,
        HookKind indexed hookKind,
        address callableContract
    );

    /**
     * @dev Registers cash-in hooks to call during specific actions.
     * @param txId Transaction ID.
     * @param newCallableContract Address of the contract implementing hook functions.
     * @param newHookFlags Flags indicating which hook functions to call.
     */
    function registerCashInHooks(bytes32 txId, address newCallableContract, uint256 newHookFlags) external;

    /**
     * @dev Registers cash-out hooks to call during specific actions.
     * @param txId Transaction ID.
     * @param newCallableContract Address of the contract implementing hook functions.
     * @param newHookFlags Flags indicating which hook functions to call.
     */
    function registerCashOutHooks(bytes32 txId, address newCallableContract, uint256 newHookFlags) external;
}
