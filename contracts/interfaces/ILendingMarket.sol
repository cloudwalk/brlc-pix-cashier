// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title TODO
 */
interface ILendingMarket {

    /**
     * @dev TODO
     */
    function takeLoanFor(
        address borrower,
        uint32 programId,
        uint256 borrowAmount,
        uint256 addonAmount,
        uint256 durationInPeriods
    ) external returns (uint256);

    /**
     * @dev TODO
     */
    function revokeLoan(uint256 loanId) external;
}
