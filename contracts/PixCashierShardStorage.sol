// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { IPixCashierTypes } from "./interfaces/IPixCashierTypes.sol";

/**
 * @title PixCashierShard storage version 1
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 */
abstract contract PixCashierShardStorageV1 is IPixCashierTypes {
    /// @dev The mapping of a cash-in operation structure for a given off-chain transaction identifier.
    mapping(bytes32 => CashInOperation) internal _cashInOperations;

    /// @dev The mapping of a cash-out operation structure for a given off-chain transaction identifier.
    mapping(bytes32 => CashOutOperation) internal _cashOutOperations;
}

/**
 * @title PixCashierShard storage version 2
 */
abstract contract PixCashierShardStorageV2 is IPixCashierTypes {
    /// @dev The mapping of an account to its admin status (True if admin, False otherwise).
    mapping(address => bool) internal _admins;
}

/**
 * @title PixCashierShard storage
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
 * @dev Contains storage variables of the {PixCashierShard} contract.
 *
 * We are following Compound's approach of upgrading new contract implementations.
 * See https://github.com/compound-finance/compound-protocol.
 * When we need to add new storage variables, we create a new version of PixCashierShardStorage
 * e.g. PixCashierShardStorage<versionNumber>, so finally it would look like
 * "contract PixCashierShardStorage is PixCashierShardStorageV1, PixCashierShardStorageV2".
 */
abstract contract PixCashierShardStorage is PixCashierShardStorageV1, PixCashierShardStorageV2 {
    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     */
    uint256[47] private __gap;
}
