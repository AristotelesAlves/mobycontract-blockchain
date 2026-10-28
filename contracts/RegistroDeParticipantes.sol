// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * Quem participa do consorcio MobyContract.
 *
 * Nao ha cadastro aberto: so uma governanca ativa habilita membros. Cada membro
 * tem um papel (governanca, registrador ou parte) e uma situacao (ativo, inativo
 * ou ex-cliente). Cliente que sai da rede passa a `ExCliente`: deixa de ancorar,
 * mas o historico que ja gravou permanece e continua legivel.
 *
 * Este contrato apenas responde "quem pode escrever". O que cada um pode LER e
 * decidido fora da chain (servico de leitura), porque na EVM qualquer conta
 * autorizada le todo o estado publico via eth_call.
 */
contract RegistroDeParticipantes {
    enum Papel {
        Nenhum,
        Governanca,
        Registrador,
        Parte
    }

    enum Situacao {
        Inativo,
        Ativo,
        ExCliente
    }

    struct Participante {
        Papel papel;
        Situacao situacao;
        uint64 desde;
        uint64 ate;
        bool existe;
    }

    mapping(address => Participante) private _participantes;
    address[] private _enderecos;
    uint256 private _governancaAtiva;

    event ParticipanteHabilitado(address indexed endereco, Papel papel, uint64 desde);
    event ParticipanteEncerrado(address indexed endereco, Situacao situacao, uint64 ate);
    event GovernancaConcedida(address indexed endereco, address indexed concedente);
    event GovernancaRevogada(address indexed endereco, address indexed concedente);

    error E_SEM_GOVERNANCA(address conta);
    error E_ENDERECO_ZERADO();
    error E_PAPEL_INVALIDO();
    error E_PARTICIPANTE_DESCONHECIDO(address conta);
    error E_JA_INATIVO(address conta);
    error E_GOVERNANCA_MINIMA();

    modifier apenasGovernanca() {
        Participante storage p = _participantes[msg.sender];
        if (p.papel != Papel.Governanca || p.situacao != Situacao.Ativo) revert E_SEM_GOVERNANCA(msg.sender);
        _;
    }

    constructor() {
        _definir(msg.sender, Papel.Governanca, Situacao.Ativo);
        emit GovernancaConcedida(msg.sender, msg.sender);
    }

    function habilitar(address conta, Papel papel) external apenasGovernanca {
        if (conta == address(0)) revert E_ENDERECO_ZERADO();
        if (papel != Papel.Registrador && papel != Papel.Parte) revert E_PAPEL_INVALIDO();

        _definir(conta, papel, Situacao.Ativo);
        emit ParticipanteHabilitado(conta, papel, uint64(block.timestamp));
    }

    function concederGovernanca(address conta) external apenasGovernanca {
        if (conta == address(0)) revert E_ENDERECO_ZERADO();

        _definir(conta, Papel.Governanca, Situacao.Ativo);
        emit GovernancaConcedida(conta, msg.sender);
    }

    function revogarGovernanca(address conta) external apenasGovernanca {
        if (_participantes[conta].papel != Papel.Governanca) revert E_PARTICIPANTE_DESCONHECIDO(conta);
        if (_governancaAtiva <= 1) revert E_GOVERNANCA_MINIMA();

        _participantes[conta].papel = Papel.Nenhum;
        _participantes[conta].situacao = Situacao.Inativo;
        _participantes[conta].ate = uint64(block.timestamp);
        _governancaAtiva -= 1;

        emit GovernancaRevogada(conta, msg.sender);
        emit ParticipanteEncerrado(conta, Situacao.Inativo, uint64(block.timestamp));
    }

    function tornarExCliente(address conta) external apenasGovernanca {
        _encerrar(conta, Situacao.ExCliente);
    }

    function encerrar(address conta) external apenasGovernanca {
        _encerrar(conta, Situacao.Inativo);
    }

    function reativar(address conta) external apenasGovernanca {
        Participante storage p = _participantes[conta];
        if (!p.existe || p.papel == Papel.Nenhum) revert E_PARTICIPANTE_DESCONHECIDO(conta);

        p.situacao = Situacao.Ativo;
        p.ate = 0;

        emit ParticipanteHabilitado(conta, p.papel, uint64(block.timestamp));
    }

    function papelDe(address conta) external view returns (Papel papel, Situacao situacao) {
        Participante storage p = _participantes[conta];
        return (p.papel, p.situacao);
    }

    function estaAtivo(address conta) external view returns (bool) {
        Participante storage p = _participantes[conta];
        return p.existe && p.situacao == Situacao.Ativo;
    }

    function podeAncorar(address conta) external view returns (bool) {
        Participante storage p = _participantes[conta];
        if (!p.existe || p.situacao != Situacao.Ativo) return false;
        return p.papel == Papel.Governanca || p.papel == Papel.Registrador;
    }

    function totalParticipantes() external view returns (uint256) {
        return _enderecos.length;
    }

    function enderecos() external view returns (address[] memory) {
        return _enderecos;
    }

    function _encerrar(address conta, Situacao situacao) private {
        Participante storage p = _participantes[conta];
        if (!p.existe) revert E_PARTICIPANTE_DESCONHECIDO(conta);
        if (p.papel == Papel.Governanca) revert E_GOVERNANCA_MINIMA();
        if (p.situacao != Situacao.Ativo) revert E_JA_INATIVO(conta);

        p.situacao = situacao;
        p.ate = uint64(block.timestamp);

        emit ParticipanteEncerrado(conta, situacao, p.ate);
    }

    function _definir(address conta, Papel papel, Situacao situacao) private {
        Participante storage p = _participantes[conta];

        if (!p.existe) {
            p.existe = true;
            _enderecos.push(conta);
        }

        if (p.papel == Papel.Governanca && papel != Papel.Governanca) _governancaAtiva -= 1;
        if (papel == Papel.Governanca && p.papel != Papel.Governanca) _governancaAtiva += 1;

        p.papel = papel;
        p.situacao = situacao;
        p.desde = uint64(block.timestamp);
        p.ate = 0;
    }
}
