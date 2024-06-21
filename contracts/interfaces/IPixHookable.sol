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
     *
     * Note: hook indexes from 0 to 5 including are not used for now and reserved for the future
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
        CashOutConfirmationAfter,  // 9 TODO: is not called during internal cash-out operations
        CashOutReversalBefore,     // 10
        CashOutReversalAfter       // 11
    }

    /// @dev TODO
    struct HooksConfig {
        address callableContract;
        uint32 hookFlags; // TODO like (1 << HookIndex.CashInCommonBefore) + (1 << HookIndex.CashInCommonAfter) + ...
    }
}

/**
 * @title PixHookable interface
 * @dev The interface of an addition to the PixCashier contract that allows to call hook functions during some actions.
 */
interface IPixHookable is IPixHookableTypes {
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
     * @dev Registers cash-out hooks to call TODO
     */
    function registerCashOutHooks(bytes32 txId, address newCallableContract, uint256 newHookFlags) external;
}
