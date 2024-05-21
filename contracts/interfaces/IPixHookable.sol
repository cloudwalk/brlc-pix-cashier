// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

/**
 * @title PixHookable types interface
 */
interface IPixHookableTypes {
    /**
     * @dev Possible types of hook functions that can be called by the contract during concrete actions.
     *
     * The possible values: TODO
     */
    enum HookKind {
        CashInCommonBefore,        // 0
        CashInCommonAfter,         // 1
        CashInPremintBefore,       // 2
        CashInPremintAfter,        // 3
        CashOutRequestBefore,      // 4
        CashOutRequestAfter,       // 5
        CashOutConfirmationBefore, // 6
        CashOutConfirmationAfter,  // 7
        CashOutReversalBefore,     // 8
        CashOutReversalAfter       // 9
    }

    /// @dev TODO
    struct HooksConfig {
        address callableContract;
        uint256 hookFlags; // TODO like (1 << CashInHookKind.CommonBefore) + (1 << CashInHookKind.CommonAfter) + ...
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
        HookKind indexed hookKind,
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
