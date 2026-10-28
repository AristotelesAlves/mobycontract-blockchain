// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Contrato consultado pelo ledger para saber quem pode ancorar.
interface IRegistroDeParticipantes {
    function podeAncorar(address conta) external view returns (bool);

    function estaAtivo(address conta) external view returns (bool);
}
