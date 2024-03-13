// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

/**
 * @title IERC20Mintable interface
 * @dev The interface of a token that supports mint, premint, burn operations.
 */
interface IERC20Mintable {
    /// @notice An enum describing restrictions for premint operation
    enum PremintRestriction {
        None,   // No restriction
        Create, // Creating a new premint is disallowed
        Update  // Updating an existing premint is disallowed
    }

    /**
     * @notice Mints tokens
     *
     * Emits a {Mint} event
     *
     * @param account The address of a tokens recipient
     * @param amount The amount of tokens to mint
     * @return True if the operation was successful
     */
    function mint(address account, uint256 amount) external returns (bool);

    /**
     * @notice Premints tokens
     *
     * Emits a {Premint} event
     *
     * @param account The address of a tokens recipient
     * @param amount The amount of tokens to premint
     * @param release The timestamp when the tokens will be released
     * @param restriction The restriction for the premint operation
     */
    function premint(address account, uint256 amount, uint256 release, PremintRestriction restriction) external;

    /**
     * @notice Burns tokens
     *
     * Emits a {Burn} event
     *
     * @param amount The amount of tokens to burn
     */
    function burn(uint256 amount) external;
}
