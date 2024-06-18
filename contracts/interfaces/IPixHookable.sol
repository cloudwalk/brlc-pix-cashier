// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title PixHookable types interface
 */
interface IPixHookableTypes {
    /**
     * @dev Possible indexes of hook functions that can be called by the contract during concrete actions.
     *
     * The possible values: TODO
     */
    enum HookIndex {
        CashInCommonBefore,        // 0
        CashInCommonAfter,         // 1
        CashInPremintBefore,       // 2
        CashInPremintAfter,        // 3
        CashOutRequestBefore,      // 4
        CashOutRequestAfter,       // 5
        CashOutConfirmationBefore, // 6
        CashOutConfirmationAfter,  // 7 TODO: is not called during internal cash-out operations
        CashOutReversalBefore,     // 8
        CashOutReversalAfter       // 9
    }

    /// @dev TODO
    struct HooksConfig {
        address callableContract;
        uint256 hookFlags; // TODO like (1 << HookIndex.CashInCommonBefore) + (1 << HookIndex.CashInCommonAfter) + ...
    }
}

/**
 * @title PixHookable interface
 * @dev The interface of an addition to the PixCashier contract that allows to call hook functions during some actions.
 */
interface IPixHookable is IPixHookableTypes {
    /// @dev TODO
    event CashInHooksRegistered(
        bytes32 indexed txId,
        address newCallableContract,
        address oldCallableContract,
        uint256 newHookFlags,
        uint256 oldHookFlags
    );

    /// @dev TODO
    event CashOutHooksRegistered(
        bytes32 indexed txId,
        address newCallableContract,
        address oldCallableContract,
        uint256 newHookFlags,
        uint256 oldHookFlags
    );

    /// @dev TODO
    event HookInvoked(
        bytes32 indexed txId,
        uint256 indexed hookIndex,
        address callableContract
    );

    /**
     * @dev Registers cash-in hooks to call TODO
     */
    function registerCashInHooks(bytes32 txId, address newCallableContract, uint256 newHookFlags) external;

    /**
     * @dev Registers cash-out hooks to call TODO
     */
    function registerCashOutHooks(bytes32 txId, address newCallableContract, uint256 newHookFlags) external;
}
