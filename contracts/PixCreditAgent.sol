// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import { IERC20Restrictable } from "./interfaces/IERC20Restrictable.sol";
import { ILendingMarket } from "./interfaces/ILendingMarket.sol";

import { IPixHookable } from "./interfaces/IPixHookable.sol";
import { IPixHookableTypes } from "./interfaces/IPixHookable.sol";
import { IPixCreditAgent } from "./interfaces/IPixCreditAgent.sol";
import { IPixHook } from "./interfaces/IPixHook.sol";
import { PixCreditAgentStorage } from "./PixCreditAgentStorage.sol";

/**
 * @title PixCreditAgent
 * @dev Facilitates credit operations within the Pix ecosystem.
 */
contract PixCreditAgent is
    PixCreditAgentStorage,
    Initializable,
    AccessControlUpgradeable,
    UUPSUpgradeable,
    IPixCreditAgent,
    IPixHook
{
    /// @dev The role of this contract owner.
    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");

    /// @dev The role of this contract admin.
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    /// @dev The role of the Pix contract.
    bytes32 public constant PIX_ROLE = keccak256("PIX_ROLE");

    /**
     * @dev Initializer of the upgradable contract.
     */
    function initialize() initializer public {
        __PixCreditAgent_init();
    }

    /**
     * @dev Internal initializer of the upgradable contract.
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable.
     */
    function __PixCreditAgent_init() internal onlyInitializing {
        __AccessControl_init_unchained();
        __UUPSUpgradeable_init_unchained();
        __PixCreditAgent_init_unchained();
    }

    /**
     * @dev Unchained initializer of the upgradable contract.
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable.
     */
    function __PixCreditAgent_init_unchained() internal onlyInitializing {
        _grantRole(OWNER_ROLE, msg.sender);
        _setRoleAdmin(ADMIN_ROLE, OWNER_ROLE);
        _setRoleAdmin(PIX_ROLE, OWNER_ROLE);
    }

    /**
     * @dev Prepares pix cash-in operation hook.
     * @param txId The transaction ID.
     * @param data The data associated with the transaction and hooks.
     * @param hookFlags The flags for hooks.
     */
    function preparePixCashIn(bytes32 txId, HookData memory data, uint256 hookFlags) external onlyRole(ADMIN_ROLE) {
        if (data.account == address(0)) {
            revert ZeroAddress();
        }
        if (data.amount == 0) {
            revert ZeroAmount();
        }

        _registeredCashInTxId[txId] = HookData({
            amount : data.amount,
            account : data.account,
            goal : data.goal,
            invoked : false,
            purpose : data.purpose,
            loanId : data.loanId
        });

        IPixHookable(_pix).registerCashInHooks(txId, address(this), hookFlags);
        emit PixCashInPrepared(txId, data, hookFlags);
    }

    /**
     * @dev Prepares pix cash-out operation hook.
     * @param txId The transaction ID.
     * @param data The data associated with the transaction and hooks.
     * @param hookFlags The flags for hooks.
     */
    function preparePixCashOut(bytes32 txId, HookData memory data, uint256 hookFlags) external onlyRole(ADMIN_ROLE) {
        if (data.account == address(0)) {
            revert ZeroAddress();
        }
        if (data.amount == 0) {
            revert ZeroAmount();
        }

        _registeredCashOutTxId[txId] = HookData({
            amount : data.amount,
            account : data.account,
            goal : data.goal,
            invoked : false,
            purpose : data.purpose,
            loanId : data.loanId
        });

        IPixHookable(_pix).registerCashInHooks(txId, address(this), hookFlags);
        emit PixCashOutPrepared(txId, data, hookFlags);
    }

    /**
     * @dev Executes cash-in hooks.
     * @param hookIndex The index of the hook.
     * @param txId The transaction ID.
     * @param hookFlags The flags for hooks.
     */
    function onPixCashInHook(uint256 hookIndex, bytes32 txId, uint256 hookFlags) external onlyRole(PIX_ROLE) {
        HookData storage data = _registeredCashInTxId[txId];
        if (data.account == address(0)) {
            revert TransactionIdNotRegistered();
        }
        if (data.invoked) {
            revert TransactionIdAlreadyInvoked();
        }

        if (data.goal == HookGoal.Restrict) {
            // TODO consider making purpose constant or global configurable variable
            IERC20Restrictable(_token).restrictionIncrease(data.account, data.purpose, data.amount);
        } else if (data.goal == HookGoal.Revoke) {
            // TODO consider if there are scenarios when it is needed in case of cash-in
            ILendingMarket(_market).revokeLoan(data.loanId);
        } else {
            revert InvalidConfiguredGoal();
        }

        data.invoked = true;
        emit HookInvoked(txId, data.goal);
    }

    /**
     * @dev Executes cash-out hooks.
     * @param hookIndex The index of the hook.
     * @param txId The transaction ID.
     * @param hookFlags The flags for hooks.
     */
    function onPixCashOutHook(uint256 hookIndex, bytes32 txId, uint256 hookFlags) external onlyRole(PIX_ROLE) {
        HookData storage data = _registeredCashOutTxId[txId];
        if (data.account == address(0)) {
            revert TransactionIdNotRegistered();
        }
        if (data.invoked) {
            revert TransactionIdAlreadyInvoked();
        }

        if (data.goal == HookGoal.Restrict) {
            IERC20Restrictable(_token).restrictionDecrease(data.account, data.purpose, data.amount);
        } else if (data.goal == HookGoal.Revoke) {
            ILendingMarket(_market).revokeLoan(data.loanId);
        } else {
            revert InvalidConfiguredGoal();
        }

        data.invoked = true;
        emit HookInvoked(txId, data.goal);
    }

    /**
     * @dev Configures the address of the Pix contract.
     * @param pix The address of the Pix contract.
     */
    function configurePixAddress(address pix) external onlyRole(OWNER_ROLE) {
        if (pix == address(0)) {
            revert ZeroAddress();
        }
        if (pix == _pix) {
            revert AlreadyConfigured();
        }

        emit PixAddressConfigured(pix, _pix);

        _pix = pix;
    }

    /**
     * @dev Configures the address of the token contract.
     * @param token The address of the token contract.
     */
    function configureTokenAddress(address token) external onlyRole(OWNER_ROLE) {
        if (token == address(0)) {
            revert ZeroAddress();
        }
        if (token == _token) {
            revert AlreadyConfigured();
        }

        emit TokenAddressConfigured(token, _token);

        _token = token;
    }

    /**
     * @dev Configures the address of the lending market contract.
     * @param market The address of the lending market contract.
     */
    function configureMarketAddress(address market) external onlyRole(OWNER_ROLE) {
        if (market == address(0)) {
            revert ZeroAddress();
        }
        if (market == _market) {
            revert AlreadyConfigured();
        }

        emit MarketAddressConfigured(market, _market);

        _market = market;
    }

    /// @dev temporary only for compatibility
    function onPixHook(uint256 hookIndex, bytes32 txId, uint256 hookFlags) external {}

    /**
     * @dev Authorizes upgrade to a new implementation contract.
     * @param newImplementation The address of the new implementation contract.
     */
    function _authorizeUpgrade(address newImplementation) internal onlyRole(OWNER_ROLE) override {}
}
