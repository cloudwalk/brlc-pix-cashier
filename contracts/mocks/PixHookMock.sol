// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

contract PixHookMock {
    uint256 public hookCallCounter;

    /// @dev TODO
    event MockPixHookCalled(
        bytes32 txId,
        uint256 hookIndex,
        uint256 hookCallCounter
    );

    /// @dev TODO
    function pixHook(uint256 hookIndex, bytes32 txId) external {
        hookCallCounter += 1;
        emit MockPixHookCalled(txId, hookIndex, hookCallCounter);
    }
}
