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

    uint256 private constant CASH_OUT_REQUEST_AFTER_HOOK_FLAG =
        1 << uint256(IPixHookableTypes.HookKind.CashOutRequestAfter);
    uint256 private constant CASH_OUT_REVERSE_AFTER_HOOK_FLAG =
        1 << uint256(IPixHookableTypes.HookKind.CashOutReversalAfter);
    uint256 private constant ALL_HOOK_FLAGS = CASH_OUT_REQUEST_AFTER_HOOK_FLAG + CASH_OUT_REVERSE_AFTER_HOOK_FLAG;


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
     * @inheritdoc IPixCreditAgent
     */
    function preparePixCredit(bytes32 pixTxId, uint256 loanId) external onlyRole(ADMIN_ROLE) {
        if (pixTxId == bytes32(0)) {
            revert PixTxIdZero();
        }
        if (loanId == 0) {
            revert LoanIdZero();
        }
        if (uint256(_pixCredits[pixTxId].status) > uint256(PixCreditStatus.Prepared)) {
            revert PixCreditInAction(_pixCredits[pixTxId].status);
        }

        IPixHookable(_pix).registerCashOutHooks(pixTxId, address(this), ALL_HOOK_FLAGS);

        _pixCredits[pixTxId] = PixCredit({
            loanId: loanId,
            account: address(0),
            amount: 0,
            status: PixCreditStatus.Prepared
        });

        emit PixCreditPrepared(pixTxId, loanId);
    }

    /**
     * @dev Executes cash-in hooks.
     * @param hookIndex The index of the hook.
     * @param txId The transaction ID.
     * @param hookFlags The flags for hooks.
     */
    function onPixCashInHook(uint256 hookIndex, bytes32 txId, uint256 hookFlags) external onlyRole(PIX_ROLE) view  {
        hookIndex;
        txId;
        hookFlags;
        // do nothing
    }

    /**
     * @dev Executes cash-out hooks.
     * @param hookIndex The index of the hook.
     * @param txId The transaction ID.
     * @param hookFlags The flags for hooks.
     */
    function onPixCashOutHook(uint256 hookIndex, bytes32 txId, uint256 hookFlags) external onlyRole(PIX_ROLE) view {
        hookFlags;
        if ((1 << hookIndex) == CASH_OUT_REQUEST_AFTER_HOOK_FLAG) {
            _processPixRequesting(txId);
        } else if ((1 << hookIndex) == CASH_OUT_REVERSE_AFTER_HOOK_FLAG) {
            _processPixReversing(txId);
        }
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

    /// @dev TODO
    function _processPixRequesting(bytes32 pixTxId) internal pure {
        pixTxId;
    }

    /// @dev TODO
    function _processPixReversing(bytes32 pixTxId) internal pure {
        pixTxId;
    }
}
