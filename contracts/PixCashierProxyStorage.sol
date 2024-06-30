// SPDX-License-Identifier: MIT

import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { IPixCashierShard } from "./interfaces/IPixCashierShard.sol";

pragma solidity ^0.8.0;

/**
 * @title PixCashierProxy contract storage.
 */
contract PixCashierProxyStorage {
    /// @dev The address of the underlying token.
    address internal _token;

    /// @dev The array of the underlying shard contracts.
    IPixCashierShard[] public _shards;

    /// @dev The mapping of a pending cash-out balance for a given account.
    mapping(address => uint256) internal _cashOutBalances;

    /// @dev The set of off-chain transaction identifiers that correspond the pending cash-out operations.
    EnumerableSet.Bytes32Set internal _pendingCashOutTxIds;

    uint256 public counterCashIn;

    uint256 public counterRequestCashOut;

    uint256 public counterConfirmCashOut;

    uint256 public counterReverseCashOut;

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     */
    uint256[42] private __gap;
}