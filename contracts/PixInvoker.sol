// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import { IERC20Mintable } from "./interfaces/IERC20Mintable.sol";
import { IERC20Restrictable } from "./interfaces/IERC20Restrictable.sol";
import { IERC20Freezable } from "./interfaces/IERC20Freezable.sol";

import { IPixHookable } from "./interfaces/IPixHookable.sol";
import { IPixHookableTypes } from "./interfaces/IPixHookable.sol";
import { IPixCashier } from "./interfaces/IPixCashier.sol";
import { IPixHook } from "./interfaces/IPixHook.sol";
import { IPixInvoker } from "./interfaces/IPixInvoker.sol";
import { PixInvokerStorage } from "./PixInvokerStorage.sol";

/**
 * @title PixInvoker
 * @dev Manages hook registrations and invokes hooks for Pix Cashier operations.
 * @author Cloudwalk Inc.
 */
contract PixInvoker is
    PixInvokerStorage,
    Initializable,
    AccessControlUpgradeable,
    UUPSUpgradeable,
    IPixInvoker,
    IPixHook,
    IPixHookableTypes
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
        __PixInvoker_init();
    }

    /**
     * @dev Internal initializer of the upgradable contract.
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable.
     */
    function __PixInvoker_init() internal onlyInitializing {
        __AccessControl_init_unchained();
        __UUPSUpgradeable_init_unchained();
        __PixInvoker_init_unchained();
    }

    /**
     * @dev Unchained initializer of the upgradable contract.
     * See details https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable.
     */
    function __PixInvoker_init_unchained() internal onlyInitializing {
        _grantRole(OWNER_ROLE, msg.sender);
        _setRoleAdmin(ADMIN_ROLE, OWNER_ROLE);
        _setRoleAdmin(PIX_ROLE, OWNER_ROLE);
    }

    /**
     * @dev Registers a transaction and invokes Pix Cashier for cash-in operations.
     * @param txId The unique identifier of the transaction.
     */
    function registerTxAndInvokeDefaultPixCashIn(
        uint256 hookKind,
        address callableContract,
        bytes32 txId,
        HookData memory data
    ) external onlyRole(ADMIN_ROLE) {
        //TODO revert if kind != default cashIn ??

        _registerCashInHooks(txId, callableContract, hookKind, data);

        IPixCashier(_pix).cashIn(data.account, data.amount, txId);
    }

    /**
     * @dev Registers a transaction and invokes Pix Cashier for premint cash-in operations.
     * @param hookKind The kind of hook to be registered.
     * @param callableContract The address of the contract where the hook is implemented.
     * @param txId The unique identifier of the transaction.
     * @param data The hook data associated with the transaction.
     */
    function registerTxAndInvokePremintCashIn(
        uint256 hookKind,
        address callableContract,
        bytes32 txId,
        HookData memory data
    ) external onlyRole(ADMIN_ROLE) {
        if (data.releaseTime == 0 || data.releaseTime <= block.timestamp) {
            revert InvalidSubmittedData();
        }

        _registerCashInHooks(txId, callableContract, hookKind, data);

        IPixCashier(_pix).cashInPremint(data.account, data.amount, txId, data.releaseTime);
    }

    /**
     * @dev Registers a transaction and invokes Pix Cashier for cash-out request operations.
     * @param hookKind The kind of hook to be registered.
     * @param callableContract The address of the contract where the hook is implemented.
     * @param txId The unique identifier of the transaction.
     * @param data The hook data associated with the transaction.
     */
    function registerTxAndInvokeCashOutRequest(
        uint256 hookKind,
        address callableContract,
        bytes32 txId,
        HookData memory data
    ) external onlyRole(ADMIN_ROLE) {
        _registerCashOutHooks(txId, callableContract, hookKind, data);

        IPixCashier(_pix).requestCashOutFrom(data.account, data.amount, txId);
    }

    /**
     * @dev Registers a transaction and invokes Pix Cashier for cash-out confirmation operations.
     * @param hookKind The kind of hook to be registered.
     * @param callableContract The address of the contract where the hook is implemented.
     * @param txId The unique identifier of the transaction.
     * @param data The hook data associated with the transaction.
     */
    function registerTxAndInvokeCashOutConfirmation(
        uint256 hookKind,
        address callableContract,
        bytes32 txId,
        HookData memory data
    ) external onlyRole(ADMIN_ROLE) {
        _registerCashOutHooks(txId, callableContract, hookKind, data);

        IPixCashier(_pix).confirmCashOut(txId);
    }

    /**
     * @dev Registers a transaction and invokes Pix Cashier for cash-out reversal operations.
     * @param hookKind The kind of hook to be registered.
     * @param callableContract The address of the contract where the hook is implemented.
     * @param txId The unique identifier of the transaction.
     * @param data The hook data associated with the transaction.
     */
    function registerTxAndInvokeCashOutReversal(
        uint256 hookKind,
        address callableContract,
        bytes32 txId,
        HookData memory data
    ) external onlyRole(ADMIN_ROLE) {
        _registerCashOutHooks(txId, callableContract, hookKind, data);

        IPixCashier(_pix).reverseCashOut(txId);
    }

    /**
     * @dev Registers cash-in hooks for a transaction.
     * @param txId The unique identifier of the transaction.
     * @param newCallableContract The address of the new callable contract.
     * @param newHookFlags The flags indicating the hook types to register.
     * @param data The hook data to associate with the transaction.
     */
    function registerCashInHooks(
        bytes32 txId,
        address newCallableContract,
        uint256 newHookFlags,
        HookData memory data
    ) external onlyRole(ADMIN_ROLE) {
        _registerCashInHooks(txId, newCallableContract, newHookFlags, data);
    }

    /**
     * @dev Registers cash-out hooks for a transaction.
     * @param txId The unique identifier of the transaction.
     * @param newCallableContract The address of the new callable contract.
     * @param newHookFlags The flags indicating the hook types to register.
     * @param data The hook data to associate with the transaction.
     */
    function registerCashOutHooks(
        bytes32 txId,
        address newCallableContract,
        uint256 newHookFlags,
        HookData memory data
    ) external onlyRole(ADMIN_ROLE) {
        _registerCashOutHooks(txId, newCallableContract, newHookFlags, data);
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
     * @dev Handles cash-in hooks invoked by the Pix contract.
     * @param hookIndex The index of the hook kind.
     * @param txId The unique identifier of the transaction.
     * @param hookFlags The flags indicating the hook types.
     */
    function onPixCashInHook(uint256 hookIndex, bytes32 txId, uint256 hookFlags) external onlyRole(PIX_ROLE) {
        HookData memory _data = _registeredCashInHookData[txId];

        if (_data.goal == HookGoal.Restrict) {
            IERC20Restrictable(_token).restrictionIncrease(_data.account, _data.restrictionPurpose, _data.amount);
        } else if (_data.goal == HookGoal.Freeze) {
            IERC20Freezable(_token).freeze(_data.account, _data.amount);
        } else if (_data.goal == HookGoal.Premint) {
            IERC20Mintable(_token).premintIncrease(_data.account, _data.amount, _data.releaseTime);
        }
    }

    /**
     * @dev Handles cash-out hooks invoked by the Pix contract.
     * @param hookIndex The index of the hook kind.
     * @param txId The unique identifier of the transaction.
     * @param hookFlags The flags indicating the hook types.
     */
    function onPixCashOutHook(uint256 hookIndex, bytes32 txId, uint256 hookFlags) external onlyRole(PIX_ROLE) {
        HookData memory _data = _registeredCashOutHookData[txId];

        if (_data.goal == HookGoal.Restrict) {
            IERC20Restrictable(_token).restrictionDecrease(_data.account, _data.restrictionPurpose, _data.amount);
        } else if (_data.goal == HookGoal.Premint) {
            IERC20Mintable(_token).premintDecrease(_data.account, _data.amount, _data.releaseTime);
        }
    }

    function _registerCashInHooks(
        bytes32 txId,
        address newCallableContract,
        uint256 newHookFlags,
        HookData memory data
    ) internal {
        if (newCallableContract == address(0)) {
            revert ZeroAddress();
        }

        _registeredCashInHookData[txId] = data;

        IPixHookable(_pix).registerCashInHooks(txId, newCallableContract, newHookFlags);

        emit HookDataSubmitted(txId, data);
    }

    function _registerCashOutHooks(
        bytes32 txId,
        address newCallableContract,
        uint256 newHookFlags,
        HookData memory data
    ) internal {
        if (newCallableContract == address(0)) {
            revert ZeroAddress();
        }

        _registeredCashOutHookData[txId] = data;

        IPixHookable(_pix).registerCashOutHooks(txId, newCallableContract, newHookFlags);

        emit HookDataSubmitted(txId, data);
    }

    /// @dev temporary only for compatibility
    function onPixHook(uint256 hookIndex, bytes32 txId, uint256 hookFlags) external {}

    /**
     * @dev Authorizes upgrade to a new implementation contract.
     * @param newImplementation The address of the new implementation contract.
     */
    function _authorizeUpgrade(address newImplementation) internal onlyRole(OWNER_ROLE) override {}
}
