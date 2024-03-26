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
     * @dev Burns tokens.
     *
     * @param amount The amount of tokens to burn.
     */
    function burn(uint256 amount) external;
}
