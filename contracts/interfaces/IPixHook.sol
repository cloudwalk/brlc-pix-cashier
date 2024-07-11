// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title IPixHook interface
 * @author CloudWalk Inc. (See https://cloudwalk.io)
 * @dev Defines the hook function that can be called by the PIX cashier contract during some operations.
 */
interface IPixHook {
    /**
     * @dev The hook function that is called by the PIX cashier contract.
     * @param hookIndex The index of the related hook. The possible values are defined in the PIX cashier contract.
     * @param txId The unique off-chain transaction identifier of the related PIX operation.
     */
    function onPixHook(uint256 hookIndex, bytes32 txId) external;
}
