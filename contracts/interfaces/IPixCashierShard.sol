// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { IPixCashierTypes } from "./IPixCashierTypes.sol";

/**
 * @title PixCashier shard interface
 */
interface IPixCashierShard is IPixCashierTypes {
    /**
     * @dev Enumeration of the shard contract possible errors.
     */
    enum Error {
        None,
        ZeroAccount,
        ZeroAmount,
        ZeroTxId,
        AmountExcess,
        CashInAlreadyExecuted,
        InappropriateCashInStatus,
        InappropriateCashOutStatus,
        InappropriateCashOutAccount
    }

    /**
     * @dev Sets the admin status of an account.
     * @param account The address of the account to configure.
     * @param status The admin status of the account.
     */
    function setAdmin(address account, bool status) external;

    /**
     * @dev Registers a cash-in operation.
     * @param account The address of the account.
     * @param amount The amount of the cash-in operation.
     * @param txId The off-chain identifier of the cash-in operation.
     * @param status The status of the cash-in operation.
     * @return err The error code if the operation fails, otherwise None.
     */
    function registerCashIn(
        address account,
        uint256 amount,
        bytes32 txId,
        CashInStatus status
    ) external returns (Error err);

    /**
     * @dev Revokes a cash-in operation.
     * @param txId The off-chain identifier of the cash-in operation.
     * @return account The address of the account of the cash-in operation.
     * @return amount The amount of the cash-in operation.
     * @return err The error code if the operation fails, otherwise None.
     */
    function revokeCashIn(bytes32 txId) external returns (address account, uint256 amount, Error err);

    /**
     * @dev Registers a cash-out operation.
     * @param account The address of the account.
     * @param amount The amount of the cash-out operation.
     * @param txId The off-chain identifier of the cash-out operation.
     * @return err The error code if the operation fails, otherwise None.
     */
    function registerCashOut(address account, uint256 amount, bytes32 txId) external returns (Error err);

    /**
     * @dev Processes a cash-out operation.
     * @param txId The off-chain identifier of the cash-out operation.
     * @return account The address of the account of the cash-out operation.
     * @return amount The amount of the cash-out operation.
     * @return err The error code if the operation fails, otherwise None.
     */
    function processCashOut(
        bytes32 txId,
        CashOutStatus status
    ) external returns (address account, uint256 amount, Error err);

    /**
     * @dev Returns the data of a single cash-in operation.
     * @param txId The off-chain transaction identifier of the operation.
     * @return operation The data of the cash-in operation in the form of a structure.
     */
    function getCashIn(bytes32 txId) external view returns (CashInOperation memory operation);

    /**
     * @dev Returns the data of multiple cash-in operations.
     * @param txIds The off-chain transaction identifiers of the operations.
     * @return operations The data of the cash-in operations in the form of a structure.
     */
    function getCashIns(bytes32[] memory txIds) external view returns (CashInOperation[] memory operations);

    /**
     * @dev Returns the data of a single cash-out operation.
     * @param txId The off-chain transaction identifier of the operation.
     * @return operation The data of the cash-out operation in the form of a structure.
     */
    function getCashOut(bytes32 txId) external view returns (CashOutOperation memory operation);

    /**
     * @dev Returns the data of multiple cash-out operations.
     * @param txIds The off-chain transaction identifiers of the operations.
     * @return operations The data of the cash-out operations in the form of a structure.
     */
    function getCashOuts(bytes32[] memory txIds) external view returns (CashOutOperation[] memory operations);

    /**
     * @dev Checks if an account is an admin.
     * @param account The address of the account to check.
     * @return isAdmin The admin status of the account.
     */
    function isAdmin(address account) external view returns (bool);

    /**
     * @dev Upgrades the implementation of the contract.
     * @param newImplementation The address of the new implementation.
     */
    function upgradeTo(address newImplementation) external;
}
