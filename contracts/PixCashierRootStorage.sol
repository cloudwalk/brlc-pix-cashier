// SPDX-License-Identifier: MIT

import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { IPixCashierShard } from "./interfaces/IPixCashierShard.sol";

pragma solidity ^0.8.0;

/**
 * @title PixCashierRoot storage version 1
 */
abstract contract PixCashierRootStorageV1 {
    /// @dev The address of the underlying token.
    address internal _token;

    /// @dev The array of the underlying shard contracts.
    IPixCashierShard[] public _shards;

    /// @dev The mapping of a pending cash-out balance for a given account.
    mapping(address => uint256) internal _cashOutBalances;

    /// @dev The set of off-chain transaction identifiers that correspond the pending cash-out operations.
    EnumerableSet.Bytes32Set internal _pendingCashOutTxIds;
}

/**
 * @title PixCashierRoot storage
 * @dev Contains storage variables of the {PixCashierShard} contract.
 *
 * We are following Compound's approach of upgrading new contract implementations.
 * See https://github.com/compound-finance/compound-protocol.
 * When we need to add new storage variables, we create a new version of PixCashierRootStorage
 * e.g. PixCashierRootStorage<versionNumber>, so finally it would look like
 * "contract PixCashierRootStorage is PixCashierRootStorageV1, PixCashierRootStorageV2".
 */
abstract contract PixCashierRootStorage is PixCashierRootStorageV1 {
    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     */
    uint256[45] private __gap;
}