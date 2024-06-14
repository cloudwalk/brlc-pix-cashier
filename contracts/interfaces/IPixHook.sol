// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

interface IPixHook {
    /// @dev TODO
    function pixHook(uint256 hookIndex, bytes32 txId) external;
}