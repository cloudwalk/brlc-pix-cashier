// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { IPixInvokerTypes } from "./interfaces/IPixInvoker.sol";

/**
 * @title PixInvokerStorage
 * @dev Defines storage for PixInvoker contract.
 * @author Cloudwalk Inc.
 */
contract PixInvokerStorage is IPixInvokerTypes {
    /// @dev The address of the pix cashier contract;
    address internal _pix;

    /// @dev The address of the token contract;
    address internal _token;

    /// @dev The mapping of cash in transaction id to registered data.
    mapping(bytes32 => HookData) internal _registeredCashInHookData;

    /// @dev The mapping of cash out transaction id to registered data.
    mapping(bytes32 => HookData) internal _registeredCashOutHookData;

    /// @dev This empty reserved space is put in place to allow future versions
    /// to add new variables without shifting down storage in the inheritance chain.
    uint256[46] private __gap;
}