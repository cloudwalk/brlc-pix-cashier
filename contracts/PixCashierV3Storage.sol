// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

import { EnumerableSetUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/structs/EnumerableSetUpgradeable.sol";
import { IPixCashierV3Types } from "./interfaces/IPixCashierV3.sol";

/**
 * @title PixCashierV3 storage version 1
 */
abstract contract PixCashierV3StorageV1 is IPixCashierV3Types {
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
    EnumerableSetUpgradeable.Bytes32Set internal _pendingCashOutTxIds;
}

/**
 * @title PixCashierV3 storage
 * @dev Contains storage variables of the {PixCashierV3} contract.
 *
 * We are following Compound's approach of upgrading new contract implementations.
 * See https://github.com/compound-finance/compound-protocol.
 * When we need to add new storage variables, we create a new version of PixCashierV3Storage
 * e.g. PixCashierV3Storage<versionNumber>, so finally it would look like
 * "contract PixCashierV3Storage is PixCashierV3StorageV1, PixCashierV3StorageV2".
 */
abstract contract PixCashierV3Storage is PixCashierV3StorageV1 {
    uint256[43] private __gap;
}
