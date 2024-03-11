// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

/**
 * @title IERC20Mintable interface
 * @dev The interface of a token that supports mint, premint, burn operations.
 */
interface IERC20Mintable {
    /// @dev The enum describing restrictions for actions with premints
    enum PremintRestriction {
        None,   // No restriction
        Create,
        Update
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
     */
    function premint(
        address account,
        uint256 amount,
        uint256 releaseTime,
        PremintRestriction restriction
    ) external;

    /**
     * @dev Burns tokens.
     *
     * @param amount The amount of tokens to burn.
     */
    function burn(uint256 amount) external;
}
