// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

/**
 * @title PixHookable types interface
 */
interface IPixHookableTypes {
    /**
     * @dev Possible types of hook functions that can be called by the contract during concrete cash-in actions.
     *
     * The possible values: TODO
     */
    enum CashInHookKind {
        CommonBefore,  // 0
        CommonAfter,   // 1
        PremintBefore, // 2
        PremintAfter   // 3
    }

    /**
     * @dev Possible types of hook functions that can be called by the contract during concrete cash-out actions.
     *
     * The possible values: TODO
     */
    enum CashOutHookKind {
        RequestBefore,      // 0
        RequestAfter,       // 1
        ConfirmationBefore, // 2
        ConfirmationAfter,  // 3
        ReversalBefore,     // 4
        ReversalAfter       // 5
    }

    /// @dev TODO
    struct HooksConfig {
        address callableContract;
        bytes32 hookFlags;
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
    event CashInHookInvoked(
        bytes32 indexed txId,
        CashInHookKind indexed hookKind,
        address callableContract
    );

    /// @dev TODO
    event CashOutHookInvoked(
        bytes32 indexed txId,
        CashOutHookKind indexed hookKind,
        address callableContract
    );

    /**
     * @dev Registers cash-in hooks to call TODO
     */
    function registerCashInHooks(bytes32 txId, address callableContract, uint256 hookFlags) external view;

    /**
     * @dev Registers cash-out hooks to call TODO
     */
    function registerCashOutHooks(bytes32 txId, address callableContract, uint256 hookFlags) external view;
}
