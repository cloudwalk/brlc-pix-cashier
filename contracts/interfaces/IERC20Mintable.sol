// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

/**
 * @title IERC20Mintable interface
 * @dev The interface of a token that supports mint, premint, burn operations.
 */
interface IERC20Mintable {
    /**
     * @dev Mints tokens.
     *
     * @param account The address of a tokens recipient.
     * @param amount The amount of tokens to mint.
     * @return True if the operation was successful.
     */
    function mint(address account, uint256 amount) external returns (bool);

    /**
     * @notice Increases the amount of an existing premint or creates a new one if it does not exist
     *
     * Emits a {Premint} event
     *
     * @param account The address of a tokens recipient
     * @param amount The amount of tokens to increase
     * @param release The timestamp when the tokens will be released
     */
    function premintIncrease(address account, uint256 amount, uint256 release) external;

    /**
     * @notice Decreases the amount of an existing premint or fails if it does not exist
     *
     * Emits a {Premint} event
     *
     * @param account The address of a tokens recipient
     * @param amount The amount of tokens to decrease
     * @param release The timestamp when the tokens will be released
     */
    function premintDecrease(address account, uint256 amount, uint256 release) external;

    /**
     * @notice Reschedules one release timestamp for all existing or future premints with another release timestamp
     *
     * Emits a {PremintsRescheduled} event
     *
     * @param originalRelease The premint release timestamp to be rescheduled
     * @param targetRelease The target premint release timestamp to be set during the rescheduling
     */
    function reschedulePremints(uint256 originalRelease, uint256 targetRelease) external;

    /**
     * @dev Burns tokens.
     *
     * @param amount The amount of tokens to burn.
     */
    function burn(uint256 amount) external;
}
