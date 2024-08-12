// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title IERC20Mintable interface
 * @author CloudWalk Inc. (See https://www.cloudwalk.io)
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
     * @dev Increases the amount of an existing premint or creates a new one if it does not exist.
     *
     * @param account The address of a tokens recipient.
     * @param amount The amount of tokens to increase.
     * @param release The timestamp when the tokens will be released.
     */
    function premintIncrease(address account, uint256 amount, uint256 release) external;

    /**
     * @dev Decreases the amount of an existing premint or fails if it does not exist.
     *
     * @param account The address of a tokens recipient.
     * @param amount The amount of tokens to decrease.
     * @param release The timestamp when the tokens will be released.
     */
    function premintDecrease(address account, uint256 amount, uint256 release) external;

    /**
     * @dev Reschedules original premint release to a new target release.
     *
     * @param originalRelease The timestamp of the original premint release to be rescheduled.
     * @param targetRelease The new timestamp of the premint release to set during the rescheduling.
     */
    function reschedulePremintRelease(uint256 originalRelease, uint256 targetRelease) external;

    /**
     * @dev Burns tokens.
     *
     * @param amount The amount of tokens to burn.
     */
    function burn(uint256 amount) external;
}
