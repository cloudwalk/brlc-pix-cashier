// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

interface IPixCashierErrors {
    enum Error {
        None,
        ZeroTokenAddress,
        ZeroAccount,
        ZeroAmount,
        ZeroTxId,
        EmptyTransactionIdsArray,
        TokenMintingFailure,
        AmountExcess,
        CashInAlreadyExecuted,
        InappropriateCashInStatus,
        InappropriateCashOutStatus,
        InappropriateCashOutAccount,
        InappropriatePremintReleaseTime
    }
}
