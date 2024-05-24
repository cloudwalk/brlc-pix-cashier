// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IPixCreditAgentTypes } from "./interfaces/IPixCreditAgent.sol";

/**
 * @title PixCreditAgentStorage
 * @dev Defines storage for PixCreditAgent contract.
 * @author Cloudwalk Inc.
 */
contract PixCreditAgentStorage is IPixCreditAgentTypes {
    /// @dev The address of the pix contract.
    address internal _pix;

    /// @dev The address of the token contract.
    address internal _token;

    /// @dev The address of the lending market contract.
    address internal _market;

    /// @dev The mapping of cash-in id to registered hook data.
    mapping(bytes32 txId => PixCredit) internal _pixCredits;
}
