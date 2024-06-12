// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

contract PixMappingV2Test is UUPSUpgradeable {
    enum CashInStatus {
        Nonexistent,
        Executed,
        PremintExecuted
    }

    struct CashInOperationV2 {
        CashInStatus status;
        address account;
        uint256 amount;
    }

    error AlreadyExists();

    uint256 public operationCount;
    mapping(bytes32 => CashInOperationV2) public cashInOperations;

    uint256 public operationCount2;
    mapping(bytes32 => CashInOperationV2) public cashInOperations2;

    uint256 public operationCount3;
    mapping(bytes32 => CashInOperationV2) public cashInOperations3;

    uint256 public operationCount4;
    mapping(bytes32 => CashInOperationV2) public cashInOperations4;

    uint256 public operationCount5;
    mapping(bytes32 => CashInOperationV2) public cashInOperations5;

    function writeWithValidation1(bytes32[] memory ids, CashInOperationV2[] memory operations) external {
        operationCount += ids.length;
        for (uint256 i; i < operations.length; i++) {
            if (cashInOperations[ids[i]].status != CashInStatus.Nonexistent) {
                revert AlreadyExists();
            }
            cashInOperations[ids[i]] = operations[i];
        }
    }

    function writeWithValidation2(bytes32[] memory ids, CashInOperationV2[] memory operations) external {
        operationCount += ids.length;
        for (uint256 i; i < operations.length; i++) {
            CashInOperationV2 memory operation = cashInOperations[ids[i]];
            if (operation.status != CashInStatus.Nonexistent) {
                revert AlreadyExists();
            }
            cashInOperations[ids[i]] = operations[i];
        }
    }

    function writeWithValidation3(bytes32[] memory ids, CashInOperationV2[] memory operations) external {
        operationCount += ids.length;
        for (uint256 i; i < operations.length; i++) {
            CashInOperationV2 storage operation = cashInOperations[ids[i]];
            if (operation.status != CashInStatus.Nonexistent) {
                revert AlreadyExists();
            }
            cashInOperations[ids[i]] = operations[i];
        }
    }

    function writeWithValidation4(bytes32[] memory ids, CashInOperationV2[] memory operations) external {
        operationCount += ids.length;
        for (uint256 i; i < operations.length; i++) {
            CashInOperationV2 storage operation = cashInOperations[ids[i]];
            if (operation.status != CashInStatus.Nonexistent) {
                revert AlreadyExists();
            }
            operation.status = operations[i].status;
            operation.account = operations[i].account;
            operation.amount = operations[i].amount;
        }
    }

    function writeWithoutValidation1(bytes32[] memory ids, CashInOperationV2[] memory operations) external {
        operationCount += ids.length;
        for (uint256 i; i < operations.length; i++) {
            cashInOperations[ids[i]] = operations[i];
        }
    }

    function writeWithoutValidation2(bytes32[] memory ids, CashInOperationV2[] memory operations) external {
        operationCount2 += ids.length;
        for (uint256 i; i < operations.length; i++) {
            cashInOperations2[ids[i]] = operations[i];
        }
    }

    function writeWithoutValidation3(bytes32[] memory ids, CashInOperationV2[] memory operations) external {
        operationCount3 += ids.length;
        for (uint256 i; i < operations.length; i++) {
            cashInOperations3[ids[i]] = operations[i];
        }
    }

    function writeWithoutValidation4(bytes32[] memory ids, CashInOperationV2[] memory operations) external {
        operationCount4 += ids.length;
        for (uint256 i; i < operations.length; i++) {
            cashInOperations4[ids[i]] = operations[i];
        }
    }

    function writeWithoutValidation5(bytes32[] memory ids, CashInOperationV2[] memory operations) external {
        operationCount5 += ids.length;
        for (uint256 i; i < operations.length; i++) {
            cashInOperations5[ids[i]] = operations[i];
        }
    }

    function _authorizeUpgrade(address newImplementation) internal view override { }
}

contract PixMappingV3Test is UUPSUpgradeable {
    enum CashInStatus {
        Nonexistent,
        Executed,
        PremintExecuted
    }

    struct CashInOperationV3 {
        CashInStatus status;
        address account;
        uint64 amount;
    }

    error AlreadyExists();

    uint256 public operationCount;
    mapping(bytes32 => CashInOperationV3) public cashInOperations;

    uint256 public operationCount2;
    mapping(bytes32 => CashInOperationV3) public cashInOperations2;

    uint256 public operationCount3;
    mapping(bytes32 => CashInOperationV3) public cashInOperations3;

    uint256 public operationCount4;
    mapping(bytes32 => CashInOperationV3) public cashInOperations4;

    uint256 public operationCount5;
    mapping(bytes32 => CashInOperationV3) public cashInOperations5;

    function writeWithValidation1(bytes32[] memory ids, CashInOperationV3[] memory operations) external {
        operationCount += ids.length;
        for (uint256 i; i < operations.length; i++) {
            if (cashInOperations[ids[i]].status != CashInStatus.Nonexistent) {
                revert AlreadyExists();
            }
            cashInOperations[ids[i]] = operations[i];
        }
    }

    function writeWithValidation2(bytes32[] memory ids, CashInOperationV3[] memory operations) external {
        operationCount += ids.length;
        for (uint256 i; i < operations.length; i++) {
            CashInOperationV3 memory operation = cashInOperations[ids[i]];
            if (operation.status != CashInStatus.Nonexistent) {
                revert AlreadyExists();
            }
            cashInOperations[ids[i]] = operations[i];
        }
    }

    function writeWithValidation3(bytes32[] memory ids, CashInOperationV3[] memory operations) external {
        operationCount += ids.length;
        for (uint256 i; i < operations.length; i++) {
            CashInOperationV3 storage operation = cashInOperations[ids[i]];
            if (operation.status != CashInStatus.Nonexistent) {
                revert AlreadyExists();
            }
            cashInOperations[ids[i]] = operations[i];
        }
    }

    function writeWithValidation4(bytes32[] memory ids, CashInOperationV3[] memory operations) external {
        operationCount += ids.length;
        for (uint256 i; i < operations.length; i++) {
            CashInOperationV3 storage operation = cashInOperations[ids[i]];
            if (operation.status != CashInStatus.Nonexistent) {
                revert AlreadyExists();
            }
            operation.status = operations[i].status;
            operation.account = operations[i].account;
            operation.amount = operations[i].amount;
        }
    }

    function writeWithoutValidation1(bytes32[] memory ids, CashInOperationV3[] memory operations) external {
        operationCount += ids.length;
        for (uint256 i; i < operations.length; i++) {
            cashInOperations[ids[i]] = operations[i];
        }
    }

    function writeWithoutValidation2(bytes32[] memory ids, CashInOperationV3[] memory operations) external {
        operationCount2 += ids.length;
        for (uint256 i; i < operations.length; i++) {
            cashInOperations2[ids[i]] = operations[i];
        }
    }

    function writeWithoutValidation3(bytes32[] memory ids, CashInOperationV3[] memory operations) external {
        operationCount3 += ids.length;
        for (uint256 i; i < operations.length; i++) {
            cashInOperations3[ids[i]] = operations[i];
        }
    }

    function writeWithoutValidation4(bytes32[] memory ids, CashInOperationV3[] memory operations) external {
        operationCount4 += ids.length;
        for (uint256 i; i < operations.length; i++) {
            cashInOperations4[ids[i]] = operations[i];
        }
    }

    function writeWithoutValidation5(bytes32[] memory ids, CashInOperationV3[] memory operations) external {
        operationCount5 += ids.length;
        for (uint256 i; i < operations.length; i++) {
            cashInOperations5[ids[i]] = operations[i];
        }
    }

    function _authorizeUpgrade(address newImplementation) internal view override { }
}