// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title LendingMarketMock contract
 * @dev A simplified version of a lending market contract to use in tests for other contracts.
 */
contract LendingMarketMock {
    uint256 constant public LOAN_ID_STAB = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFDE;

    /// @dev Emitted when the `takeLoanFor()` function is called with the parameters of the function.
    event MockTakeLoanForCalled (
        address borrower,
        uint256 programId,
        uint256 borrowAmount,
        uint256 addonAmount,
        uint256 durationInPeriods
    );

    /// @dev Emitted when the `revokeLoan()` function is called with the parameters of the function.
    event MockRevokeLoanCalled (
        uint256 loanId
    );

    /**
     * @dev Imitates the same-name function a lending market contracts.
     *      Just emits an event about the call and returns a constant.
     */
    function takeLoanFor(
        address borrower,
        uint32 programId,
        uint256 borrowAmount,
        uint256 addonAmount,
        uint256 durationInPeriods
    ) external returns (uint256) {
        emit MockTakeLoanForCalled(
            borrower,
            programId,
            borrowAmount,
            addonAmount,
            durationInPeriods
        );
        return LOAN_ID_STAB;
    }

    /// @dev Imitates the same-name function a lending market contracts. Just emits an event about the call.
    function revokeLoan(uint256 loanId) external {
        emit MockRevokeLoanCalled(loanId);
    }
}
