// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * Regra unica da chave on-chain:
 *   contrato/vistoria: keccak256(idBruto)
 *   aditivo: keccak256(chaveContrato ++ 0x1f ++ idAditivoBruto)
 *
 * O separador 0x1f evita a colisao de ("AB","C") com ("A","BC").
 * Espelha src/chaves.ts, que produz as mesmas chaves fora da chain.
 */
library DerivacaoDeChave {
    bytes1 private constant SEP = 0x1f;

    function deContrato(string calldata identificador) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(bytes(identificador)));
    }

    function deVistoria(string calldata identificador) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(bytes(identificador)));
    }

    function deAditivo(bytes32 chaveContrato, string calldata identificadorAditivo) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(chaveContrato, SEP, bytes(identificadorAditivo)));
    }
}