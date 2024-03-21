// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import { IERC20Mintable } from "../../interfaces/IERC20Mintable.sol";

/**
 * @title ERC20TokenMock contract
 * @dev An implementation of the {ERC20Upgradeable} contract for testing purposes
 */
contract ERC20TokenMock is ERC20Upgradeable, IERC20Mintable, UUPSUpgradeable {
    /// @dev A mock premint event with the parameters that were passed to the `premint()` function.
    event MockPremint(
        address account,
        uint256 amount,
        uint256 releaseTime,
        PremintRestriction restriction
    );

    bool public mintResult;

    // -------------------- Initializers -----------------------------

    /**
     * @dev The initialize function of the upgradable contract.
     * @param name_ The name of the token to set for this ERC20-comparable contract.
     * @param symbol_ The symbol of the token to set for this ERC20-comparable contract.
     */
    function initialize(string memory name_, string memory symbol_) public initializer {
        __ERC20_init(name_, symbol_);
        mintResult = true;

        // Only to provide the 100 % test coverage
        _authorizeUpgrade(address(0));
    }

    // -------------------- Functions --------------------------------

    /**
     * @dev Calls the appropriate internal function to mint needed amount of tokens for an account.
     * @param account The address of an account to mint for.
     * @param amount The amount of tokens to mint.
     */
    function mint(address account, uint256 amount) external returns (bool) {
        _mint(account, amount);
        return mintResult;
    }

    /**
     * @dev Executes the mint function ignoring the release time parameter.
     * @param account The address of a tokens recipient.
     * @param amount The amount of tokens to premint.
     * @param releaseTime The timestamp when the tokens will be released.
     */
    function premint(
        address account,
        uint256 amount,
        uint256 releaseTime,
        IERC20Mintable.PremintRestriction restriction
    ) external {
        emit MockPremint(account, amount, releaseTime, restriction);
    }

    /**
     * @dev Calls the appropriate internal function to burn needed amount of tokens.
     * @param amount The amount of tokens of this contract to burn.
     */
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    function setMintResult(bool _newMintResult) external {
        mintResult = _newMintResult;
    }

    // -------------------- Internal functions -----------------------

    /**
     * @dev The upgrade authorization function for UUPSProxy.
     */
    function _authorizeUpgrade(address newImplementation) internal pure override {
        newImplementation; // Suppresses a compiler warning about the unused variable
    }
}
