// SPDX-License-Identifier: MIT

pragma solidity ^0.8.16;

/**
 * @title IPixHook interface
 * @dev Interface for hook functions invoked by Pix Cashier contract.
 * @author Cloudwalk Inc
 */
interface IPixHook {
    /**
     * @dev Invoked by Pix Cashier contract during cash-in operations.
     * @param hookIndex The index of the hook kind.
     * @param txId The unique identifier of the transaction.
     * @param hookFlags The flags indicating the hook types.
     */
    function onPixCashInHook(uint256 hookIndex, bytes32 txId, uint256 hookFlags) external;

    /**
     * @dev Invoked by Pix Cashier contract during cash-out operations.
     * @param hookIndex The index of the hook kind.
     * @param txId The unique identifier of the transaction.
     * @param hookFlags The flags indicating the hook types.
     */
    function onPixCashOutHook(uint256 hookIndex, bytes32 txId, uint256 hookFlags) external;
}
