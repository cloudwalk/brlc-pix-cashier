// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

contract PixHookMock {
    /// @dev TODO
    event PixHookActivated(
        uint256 hookIndex,
        bytes32 txId
    );

    /// @dev TODO
    function pixHook(uint256 hookIndex, bytes32 txId) external {
        emit PixHookActivated(hookIndex, txId);
    }
}
