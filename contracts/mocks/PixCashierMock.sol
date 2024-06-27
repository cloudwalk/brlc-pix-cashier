// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { IPixCashierTypes } from "../interfaces/IPixCashier.sol";
import { IPixHook } from "../interfaces/IPixHook.sol";
import { IPixHookableTypes } from "../interfaces/IPixHookable.sol";

/**
 * @title PixCashierMock contract
 * @dev A simplified version of the PixCashier contract to use in tests for other contracts.
 */
contract PixCashierMock is IPixCashierTypes, IPixHookableTypes {
    /// @dev The mapping of a cash-out operation structure for a given off-chain transaction identifier.
    mapping(bytes32 => CashOut) internal _cashOuts;

    /// @dev Emitted when the `configureCashOutHooks()` function is called with the parameters of the function.
    event MockConfigureCashOutHooksCalled (
        bytes32 txId,
        address newCallableContract,
        uint256 newHookFlags
    );

    /// @dev Imitates the same-name function of the {IPixHookable} interface. Just emits an event about the call.
    function configureCashOutHooks(bytes32 txId, address newCallableContract, uint256 newHookFlags) external {
        emit MockConfigureCashOutHooksCalled(
            txId,
            newCallableContract,
            newHookFlags
        );
    }

    /// @dev Calls the `IPixHook.pixHook()` function for a provided contract with provided parameters.
    function callPixHook(address callableContract, uint256 hookIndex, bytes32 txId) external {
        IPixHook(callableContract).pixHook(hookIndex, txId);
    }

    /// @dev Sets the fields of a single cash-out operation for a provided PIX transaction ID.
    function setCashOut(bytes32 txId, CashOut calldata cashOut) external {
        _cashOuts[txId] = cashOut;
    }

    /// @dev Returns the data of a previously set single cash-out operation by a PIX transaction ID.
    function getCashOut(bytes32 txId) external view returns (CashOut memory) {
        return _cashOuts[txId];
    }
}
