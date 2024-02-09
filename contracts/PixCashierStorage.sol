// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { IPixCashierTypes } from "./interfaces/IPixCashier.sol";

/**
 * @title PixCashier storage version 1
 */
abstract contract PixCashierStorageV1 is IPixCashierTypes {
    /// @dev The address of the underlying token.
    address internal _token;

    /// @dev The mapping of a cash-in operation structure for a given off-chain transaction identifier.
    mapping(bytes32 => CashInOperation) internal _cashInOperations;

    /// @dev The mapping of a cash-in batch operation structure for a given off-chain identifier.
    mapping(bytes32 => CashInBatchOperation) internal _cashInBatchOperations;

    /// @dev The mapping of a cash-out operation structure for a given off-chain transaction identifier.
    mapping(bytes32 => CashOutOperation) internal _cashOutOperations;

    /// @dev The mapping of a pending cash-out balance for a given account.
    mapping(address => uint256) internal _cashOutBalances;

    /// @dev The set of off-chain transaction identifiers that correspond the pending cash-out operations.
    EnumerableSet.Bytes32Set internal _pendingCashOutTxIds;
}

/**
 * @title PixCashier storage
 * @dev Contains storage variables of the {PixCashier} contract.
 *
 * We are following Compound's approach of upgrading new contract implementations.
 * See https://github.com/compound-finance/compound-protocol.
 * When we need to add new storage variables, we create a new version of PixCashierStorage
 * e.g. PixCashierStorage<versionNumber>, so finally it would look like
 * "contract PixCashierStorage is PixCashierStorageV1, PixCashierStorageV2".
 */
abstract contract PixCashierStorage is PixCashierStorageV1 {
    uint256[43] private __gap;
}
