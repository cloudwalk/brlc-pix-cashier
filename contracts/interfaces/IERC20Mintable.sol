// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
 * @title IERC20Mintable interface
 * @dev The interface of a token that supports mint, premint, burn operations.
 */
interface IERC20Mintable {
    /// @dev An enum describing restrictions for premint operation.
    enum PremintRestriction {
        None,   // No restriction.
        Create, // Creating a new premint is disallowed.
        Update  // Updating an existing premint is disallowed.
    }

    /**
     * @dev Mints tokens.
     *
     * @param account The address of a tokens recipient.
     * @param amount The amount of tokens to mint.
     * @return True if the operation was successful.
     */
    function mint(address account, uint256 amount) external returns (bool);

    /**
     * @dev Premints tokens.
     *
     * @param account The address of a tokens recipient.
     * @param amount The amount of tokens to premint.
     * @param releaseTime The timestamp when the tokens will be released.
     * @param restriction The restriction for the premint operation.
     */
    function premint(address account, uint256 amount, uint256 releaseTime, PremintRestriction restriction) external;

    /**
     * @dev Burns tokens.
     *
     * @param amount The amount of tokens to burn.
     */
    function burn(uint256 amount) external;
}
