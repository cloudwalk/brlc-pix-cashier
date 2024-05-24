// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

/// @title ILendingMarket interface
/// @author CloudWalk Inc. (See https://cloudwalk.io)
/// @dev Defines the lending market contract functions and events.
interface ILendingMarket {

    /// @dev Takes a loan.
    /// @param creditLine The address of the credit line to take the loan from.
    /// @param borrowAmount The desired amount of tokens to borrow.
    /// @param durationInPeriods The desired duration of the loan in periods.
    /// @return The unique identifier of the loan.
    function takeLoan(
        address creditLine,
        uint256 borrowAmount,
        uint256 durationInPeriods
    ) external returns (uint256);

    /// @dev Repays a loan.
    /// @param loanId The unique identifier of the loan to repay.
    /// @param repayAmount The amount to repay or `type(uint256).max` to repay the remaining balance of the loan.
    function repayLoan(uint256 loanId, uint256 repayAmount) external;

    /// @dev Revokes a loan.
    /// @param loanId The unique identifier of the loan to revoke.
    function revokeLoan(uint256 loanId) external;
}