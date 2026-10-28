// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * Rede de seguranca executavel contra dado pessoal nao ofuscado na ancora.
 *
 * Procura duas formas com padrao reconhecivel: arroba e sequencia de 11
 * digitos (formatacao de CPF). Heuristica, nao prova: nao detecta nome nem
 * identificador sem padrao. Serve para tornar visivel um erro de integracao
 * antes da ancora irreversivel, nao substitui o pseudonimo.
 */
library AuditoriaDePrivacidade {
    bytes1 private constant ARROBA = "@";
    bytes1 private constant ZERO = 0x30;
    bytes1 private constant NOVE = 0x39;
    uint256 private constant TAMANHO_DO_CPF = 11;

    function contemCpfOuEmail(bytes memory payload) internal pure returns (bool) {
        uint256 tamanho = payload.length;

        for (uint256 i = 0; i < tamanho; i++) {
            bytes1 caractere = payload[i];
            if (caractere == ARROBA) return true;
            if (caractere >= ZERO && caractere <= NOVE && i + TAMANHO_DO_CPF < tamanho && _temCpfEm(payload, i)) {
                return true;
            }
        }

        return false;
    }

    function _temCpfEm(bytes memory payload, uint256 inicio) private pure returns (bool) {
        uint256 digitos = 1;

        for (uint256 deslocamento = 1; deslocamento < TAMANHO_DO_CPF; deslocamento++) {
            bytes1 digito = payload[inicio + deslocamento];
            if (digito < ZERO || digito > NOVE) return false;
            digitos++;
        }

        return digitos >= TAMANHO_DO_CPF;
    }
}