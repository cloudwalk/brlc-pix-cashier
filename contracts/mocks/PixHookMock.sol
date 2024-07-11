// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title PixHookMock contract
 * @author CloudWalk Inc. (See https://cloudwalk.io)
 * @dev A simplified version of a PIX hook contract to use in tests for other contracts.
 */
contract PixHookMock {
    /// @dev A counter of the hook function calls.
    uint256 public hookCallCounter;

    // ------------------ Events ---------------------------------- //

    /// @dev Emitted when the `pixHook()` function is called with the parameters of the function.
    event MockPixHookCalled(
        bytes32 txId, // Tools: This comment prevents Prettier from formatting into a single line.
        uint256 hookIndex,
        uint256 hookCallCounter
    );

    // ------------------ Functions ------------------------------- //

    /// @dev Imitates the same-name function of the {IPixHook} interface.
    function onPixHook(uint256 hookIndex, bytes32 txId) external {
        hookCallCounter += 1;
        emit MockPixHookCalled(txId, hookIndex, hookCallCounter);
    }
}
