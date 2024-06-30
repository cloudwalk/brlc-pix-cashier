// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { IPixCashierTypes } from "./IPixCashier.sol";
import { IPixCashierErrors } from "./IPixCashierErrors.sol";

/**
 * @title PixCashier shard interface
 */
interface IPixCashierShard is IPixCashierTypes, IPixCashierErrors {

    /**
     * @dev Registers a cash-in operation.
     * @param account The address of the account.
     * @param amount The amount of the cash-in operation.
     * @param txId The off-chain identifier of the cash-in operation.
     * @param status The status of the cash-in operation.
     */
    function registerCashIn(
        address account,
        uint256 amount,
        bytes32 txId,
        CashInStatus status
    ) external returns (Error);

    /**
     * @dev Revokes a cash-in operation.
     * @param txId The off-chain identifier of the cash-in operation.
     * @return account The address of the account of the cash-in operation.
     * @return amount The amount of the cash-in operation.
     * @return err The error code.
     */
    function revokeCashIn(
        bytes32 txId
    ) external returns (address account, uint256 amount, Error err);

    function registerCashOut(
        address account,
        uint256 amount,
        bytes32 txId
    ) external returns (Error);

    function processCashOut(
        bytes32 txId,
        CashOutStatus status
    ) external returns (address, uint256, Error);

    function getCashIn(bytes32 txId) external view returns (CashInOperation memory);

    function getCashOut(bytes32 txId) external view returns (CashOutOperation memory);

    function upgradeTo(address newImplementation) external;
}