// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

interface IPixHook {
    /// @dev TODO
    function onPixHook(uint256 hookIndex, bytes32 txId) external;
}