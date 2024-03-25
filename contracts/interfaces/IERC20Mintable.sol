// SPDX-License-Identifier: MIT

pragma solidity 0.8.16;

/**
 * @title IERC20Mintable interface
 * @dev The interface of a token that supports mint, premint, burn operations.
 */
interface IERC20Mintable {
    /** @notice Scenarios of premint operations
     *
     * @dev The possible values:
     * - Create --- Creates a new premint or fails if the premint with the provided account and release time
     *              already exists.
     *              The default scenario.
     * - Increase - Increases the amount of an existing premint by the provided value or
     *              creates a new premint with the provided parameters if it does not exist.
     * - Decrease - Decreasing the amount of an existing premint by the provided value or
     *              fails if the premint with the provided account and release time does not exist.
     *              If during the decreasing the premint amount becomes zero it is completely removed.
     * - Update --- Updates the amount of an existing premint with the new provided value or
     *              fails if the premint with the provided account and release time does not exist.
     *              If the provided amount is zero the premint is completely removed.
     */
    enum PremintScenario {
        Create,   // 0
        Increase, // 1
        Decrease, // 2
        Update    // 3
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
     * @param release The timestamp when the tokens will be released.
     * @param scenario The scenario for the premint operation.
     */
    function premint(address account, uint256 amount, uint256 release, PremintScenario scenario) external;

    /**
     * @dev Burns tokens.
     *
     * @param amount The amount of tokens to burn.
     */
    function burn(uint256 amount) external;
}
