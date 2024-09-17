// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title ICashierHook interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Defines the hook function that can be called by the cashier contract during operations.
 */
interface ICashierHook {
    /**
     * @dev The hook function that is called by the cashier contract.
     * @param hookIndex The index of the related hook. The possible values are defined in the cashier contract.
     * @param txId The unique off-chain transaction identifier of the related operation.
     */
    function onCashierHook(uint256 hookIndex, bytes32 txId) external;
}
