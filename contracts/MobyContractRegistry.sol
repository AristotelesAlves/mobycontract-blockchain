// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DerivacaoDeChave} from "./lib/DerivacaoDeChave.sol";
import {AuditoriaDePrivacidade} from "./lib/AuditoriaDePrivacidade.sol";
import {IRegistroDeParticipantes} from "./lib/IRegistroDeParticipantes.sol";

/**
 * Ledger imutavel de contratos de locacao do MobyContract.
 *
 * Nao existe funcao de remocao nem de sobrescrita: o unico caminho que altera
 * a leitura de um hash e `registrarCorrecaoAncoragem`, que e append-only e
 * nao toca no armazenamento. O que esta gravado, permanece.
 *
 * A chain guarda pseudonimo (locatarioHash, imovelHash, documentoModeloHash),
 * nunca o identificador de negocio em claro.
 */
contract MobyContractRegistry {
    enum StatusContrato {
        NaoAssinado,
        ParcialmenteAssinado,
        Assinado
    }

    enum TipoHash {
        Nenhum,
        PDF,
        ImagemDigitalizada
    }

    enum Canal {
        Assinatura,
        Aditivo,
        Vistoria
    }

    struct Registro {
        bytes32 id;
        bytes32 deterministicHash;
        bytes32 deterministicHashV2;
        bytes32 contratoHash;
        bytes32 locatarioHash;
        bytes32 imovelHash;
        bytes32 documentoModeloHash;
        address registroPor;
        uint64 registradoEm;
        uint32 bloco;
        uint32 prazoVigenciaDias;
        uint16 indiceReajuste;
        StatusContrato status;
        TipoHash tipoHash;
        address[] partes;
    }

    struct Aditivo {
        bytes32 id;
        bytes32 contratoId;
        bytes32 aditivoHash;
        bytes32 tipoObjetoHash;
        address registradoPor;
        uint64 registradoEm;
        uint32 bloco;
    }

    struct Vistoria {
        bytes32 id;
        bytes32 contratoId;
        bytes32 imovelHash;
        bytes32 vistoriaHash;
        address registradoPor;
        uint64 registradoEm;
        uint32 bloco;
        uint8 tipoRelacao;
    }

    address public admin;

    address public controladorDeAcesso;

    mapping(address => bool) public registradores;
    mapping(address => bool) public papelRevogado;

    mapping(bytes32 => Registro) private _contratos;
    mapping(bytes32 => bool) private _contratosExiste;
    mapping(bytes32 => Aditivo) private _aditivos;
    mapping(bytes32 => bool) private _aditivosExiste;
    mapping(bytes32 => Vistoria) private _vistorias;
    mapping(bytes32 => bool) private _vistoriasExiste;

    mapping(bytes32 => mapping(address => bool)) private _assinaturas;

    mapping(address => bytes32[]) private _contratosDoRegistrador;
    mapping(address => bytes32[]) private _contratosDaParte;
    mapping(bytes32 => bytes32[]) private _aditivosDoContrato;
    mapping(bytes32 => bytes32[]) private _vistoriasDoContrato;
    mapping(bytes32 => bytes32[]) private _vistoriasDoImovel;
    mapping(bytes32 => address[]) private _partesDoContrato;

    uint256 public totalContratos;
    uint256 public totalAditivos;
    uint256 public totalVistorias;
    uint256 public totalAssinaturas;

    uint256 public constant CHAIN_ID_ESPERADO = 80002;

    event ContratoRegistrado(
        bytes32 indexed id,
        bytes32 deterministicHash,
        bytes32 deterministicHashV2,
        bytes32 contratoHash,
        bytes32 locatarioHash,
        bytes32 imovelHash,
        address indexed registroPor,
        uint32 bloco,
        StatusContrato status
    );
    event AssinaturaRegistrada(bytes32 indexed id, address indexed parte, Canal indexed canal, uint32 bloco, uint64 data, StatusContrato status);
    event AditivoRegistrado(bytes32 indexed id, bytes32 indexed contratoId, bytes32 aditivoHash, address indexed registradoPor, uint32 bloco);
    event VistoriaRegistrada(bytes32 indexed id, bytes32 indexed imovelHash, bytes32 indexed contratoId, address registradoPor, bytes32 vistoriaHash, uint8 tipoRelacao, uint32 bloco);
    event RegistradorConcedido(address indexed conta, address indexed concedente);
    event RegistradorRevogado(address indexed conta, address indexed concedente);
    event CorrecaoAncoragem(bytes32 indexed id, bytes32 hashAnterior, bytes32 hashCorrigido, address indexed executadoPor);
    event ControladorDeAcessoDefinido(address indexed controlador, address indexed por);

    error E_UNAUTHORIZED(address conta);
    error E_NAO_PARTICIPANTE(address conta);
    error E_ROLE_REVOKED(address conta);
    error E_CONTRACT_EXISTS(bytes32 id);
    error E_UNKNOWN_CONTRACT(bytes32 id);
    error E_ALREADY_SIGNED(bytes32 id, address parte);
    error E_REQUIRED_PARTY(bytes32 id, address parte);
    error E_NO_HASH(bytes32 hash);
    error E_EMPTY_PARTIES();
    error E_EMPTY_ID();
    error E_VISTORIA_EXISTS(bytes32 id);
    error E_UNKNOWN_VISTORIA(bytes32 id);
    error E_UNKNOWN_ADITIVO(bytes32 id);
    error E_INVALID_VISTORIA_TYPE(uint8 tipo);
    error E_INVALID_REAJUSTE(uint16 indice);

    modifier somenteAdmin() {
        if (msg.sender != admin) revert E_UNAUTHORIZED(msg.sender);
        _;
    }

    modifier somenteRegistrador() {
        if (papelRevogado[msg.sender]) revert E_ROLE_REVOKED(msg.sender);
        if (msg.sender != admin && !registradores[msg.sender]) revert E_UNAUTHORIZED(msg.sender);
        if (controladorDeAcesso != address(0) && !IRegistroDeParticipantes(controladorDeAcesso).podeAncorar(msg.sender)) {
            revert E_NAO_PARTICIPANTE(msg.sender);
        }
        _;
    }

    modifier naoNulo(bytes32 valor) {
        if (valor == bytes32(0)) revert E_NO_HASH(valor);
        _;
    }

    modifier naoVazio(string calldata valor) {
        if (bytes(valor).length == 0) revert E_EMPTY_ID();
        _;
    }

    constructor() {
        admin = msg.sender;
        emit RegistradorConcedido(msg.sender, msg.sender);
    }

    function concederRegistrador(address conta) external somenteAdmin {
        if (conta == address(0)) revert E_UNAUTHORIZED(conta);
        registradores[conta] = true;
        papelRevogado[conta] = false;
        emit RegistradorConcedido(conta, msg.sender);
    }

    function revogarRegistrador(address conta) external somenteAdmin {
        registradores[conta] = false;
        papelRevogado[conta] = true;
        emit RegistradorRevogado(conta, msg.sender);
    }

    function definirControladorDeAcesso(address controlador) external somenteAdmin {
        controladorDeAcesso = controlador;
        emit ControladorDeAcessoDefinido(controlador, msg.sender);
    }

    function registrarCorrecaoAncoragem(bytes32 id, bytes32 hashCorrigido) external somenteAdmin naoNulo(id) naoNulo(hashCorrigido) {
        if (!_contratosExiste[id]) revert E_UNKNOWN_CONTRACT(id);
        emit CorrecaoAncoragem(id, _contratos[id].deterministicHashV2, hashCorrigido, msg.sender);
    }

    function registrarContrato(
        string calldata contratoIdBruto,
        bytes32 deterministicHash,
        bytes32 deterministicHashV2,
        bytes32 contratoHash,
        bytes32 locatarioHash,
        bytes32 imovelHash,
        TipoHash tipoHash,
        uint32 prazoVigenciaDias,
        uint16 indiceReajuste,
        bytes32 documentoModeloHash,
        address[] calldata partes
    ) external somenteRegistrador naoVazio(contratoIdBruto) returns (bytes32 id) {
        if (partes.length == 0) revert E_EMPTY_PARTIES();
        if (contratoHash == bytes32(0)) revert E_NO_HASH(contratoHash);
        if (locatarioHash == bytes32(0)) revert E_NO_HASH(locatarioHash);
        if (imovelHash == bytes32(0)) revert E_NO_HASH(imovelHash);
        if (indiceReajuste > 3) revert E_INVALID_REAJUSTE(indiceReajuste);

        id = DerivacaoDeChave.deContrato(contratoIdBruto);
        if (_contratosExiste[id]) revert E_CONTRACT_EXISTS(id);

        _gravarContrato(
            id,
            deterministicHash,
            deterministicHashV2,
            contratoHash,
            locatarioHash,
            imovelHash,
            documentoModeloHash,
            tipoHash,
            prazoVigenciaDias,
            indiceReajuste,
            partes
        );

        emit ContratoRegistrado(id, deterministicHash, deterministicHashV2, contratoHash, locatarioHash, imovelHash, msg.sender, uint32(block.number), StatusContrato.NaoAssinado);
    }

    function registrarAssinatura(bytes32 id, address parte) external somenteRegistrador naoNulo(id) {
        if (!_contratosExiste[id]) revert E_UNKNOWN_CONTRACT(id);
        if (parte == address(0)) revert E_UNAUTHORIZED(parte);
        if (_assinaturas[id][parte]) revert E_ALREADY_SIGNED(id, parte);
        if (!_isParte(id, parte)) revert E_REQUIRED_PARTY(id, parte);

        _assinaturas[id][parte] = true;
        totalAssinaturas += 1;

        StatusContrato status = _atualizarStatus(_contratos[id]);
        emit AssinaturaRegistrada(id, parte, Canal.Assinatura, uint32(block.number), uint64(block.timestamp), status);
    }

    function registrarAditivo(string calldata aditivoIdBruto, bytes32 contratoId, bytes32 aditivoHash, bytes32 tipoObjetoHash) external somenteRegistrador naoVazio(aditivoIdBruto) naoNulo(contratoId) naoNulo(aditivoHash) returns (bytes32 id) {
        if (!_contratosExiste[contratoId]) revert E_UNKNOWN_CONTRACT(contratoId);

        id = DerivacaoDeChave.deAditivo(contratoId, aditivoIdBruto);
        if (_aditivosExiste[id]) revert E_CONTRACT_EXISTS(id);

        _aditivos[id] = Aditivo({id: id, contratoId: contratoId, aditivoHash: aditivoHash, tipoObjetoHash: tipoObjetoHash, registradoPor: msg.sender, registradoEm: uint64(block.timestamp), bloco: uint32(block.number)});

        _aditivosExiste[id] = true;
        totalAditivos += 1;
        _aditivosDoContrato[contratoId].push(id);

        emit AditivoRegistrado(id, contratoId, aditivoHash, msg.sender, uint32(block.number));
    }

    function registrarVistoria(string calldata vistoriaIdBruto, bytes32 contratoId, bytes32 imovelHash, bytes32 vistoriaHash, uint8 tipoRelacao) external somenteRegistrador naoVazio(vistoriaIdBruto) naoNulo(imovelHash) naoNulo(vistoriaHash) returns (bytes32 id) {
        if (tipoRelacao > 1) revert E_INVALID_VISTORIA_TYPE(tipoRelacao);
        if (tipoRelacao == 1 && !_contratosExiste[contratoId]) {
            revert E_UNKNOWN_CONTRACT(contratoId);
        }
        if (tipoRelacao != 1 && contratoId != bytes32(0)) {
            revert E_UNKNOWN_CONTRACT(contratoId);
        }

        id = DerivacaoDeChave.deVistoria(vistoriaIdBruto);
        if (_vistoriasExiste[id]) revert E_VISTORIA_EXISTS(id);

        _vistorias[id] = Vistoria({id: id, contratoId: contratoId, imovelHash: imovelHash, vistoriaHash: vistoriaHash, tipoRelacao: tipoRelacao, registradoPor: msg.sender, registradoEm: uint64(block.timestamp), bloco: uint32(block.number)});

        _vistoriasExiste[id] = true;
        totalVistorias += 1;
        _vistoriasDoImovel[imovelHash].push(id);
        if (contratoId != bytes32(0)) _vistoriasDoContrato[contratoId].push(id);

        emit VistoriaRegistrada(id, imovelHash, contratoId, msg.sender, vistoriaHash, tipoRelacao, uint32(block.number));
    }

    function consultarContrato(bytes32 id) external view returns (Registro memory) {
        if (!_contratosExiste[id]) revert E_UNKNOWN_CONTRACT(id);
        return _contratos[id];
    }

    function consultarAditivo(bytes32 id) external view returns (Aditivo memory) {
        if (!_aditivosExiste[id]) revert E_UNKNOWN_ADITIVO(id);
        return _aditivos[id];
    }

    function consultarVistoria(bytes32 id) external view returns (Vistoria memory) {
        if (!_vistoriasExiste[id]) revert E_UNKNOWN_VISTORIA(id);
        return _vistorias[id];
    }

    function existeContrato(bytes32 id) external view returns (bool) {
        return _contratosExiste[id];
    }

    function consultarAssinatura(bytes32 id, address parte) external view returns (bool) {
        return _assinaturas[id][parte];
    }

    function consultarPartes(bytes32 id) external view returns (address[] memory) {
        if (!_contratosExiste[id]) revert E_UNKNOWN_CONTRACT(id);
        return _partesDoContrato[id];
    }

    function consultarAditivos(bytes32 contratoId) external view returns (bytes32[] memory) {
        if (!_contratosExiste[contratoId]) revert E_UNKNOWN_CONTRACT(contratoId);
        return _aditivosDoContrato[contratoId];
    }

    function consultarVistoriasDoContrato(bytes32 contratoId) external view returns (bytes32[] memory) {
        if (!_contratosExiste[contratoId]) revert E_UNKNOWN_CONTRACT(contratoId);
        return _vistoriasDoContrato[contratoId];
    }

    function consultarVistoriasDoImovel(bytes32 imovelHash) external view returns (bytes32[] memory) {
        return _vistoriasDoImovel[imovelHash];
    }

    function contratosDoRegistrador(address conta) external view returns (bytes32[] memory) {
        return _contratosDoRegistrador[conta];
    }

    function contratosDaParte(address conta) external view returns (bytes32[] memory) {
        return _contratosDaParte[conta];
    }

    function verificarIntegridade(bytes32 id, bytes32 documentoHash) external view returns (bool integro, bytes32 hashAncorado) {
        if (!_contratosExiste[id]) revert E_UNKNOWN_CONTRACT(id);
        return _compararHash(_contratos[id].contratoHash, documentoHash);
    }

    function verificarIntegridadeAditivo(bytes32 aditivoId, bytes32 documentoHash) external view returns (bool integro, bytes32 hashAncorado) {
        if (!_aditivosExiste[aditivoId]) revert E_UNKNOWN_ADITIVO(aditivoId);
        return _compararHash(_aditivos[aditivoId].aditivoHash, documentoHash);
    }

    function verificarIntegridadeVistoria(bytes32 vistoriaId, bytes32 documentoHash) external view returns (bool integro, bytes32 hashAncorado) {
        if (!_vistoriasExiste[vistoriaId]) revert E_UNKNOWN_VISTORIA(vistoriaId);
        return _compararHash(_vistorias[vistoriaId].vistoriaHash, documentoHash);
    }

    function auditarPrivacidade(bytes32 id) external view returns (bool semPII, uint256 bytesDoContrato) {
        if (!_contratosExiste[id]) revert E_UNKNOWN_CONTRACT(id);
        bytes memory payload = _payloadAuditado(_contratos[id]);
        return (AuditoriaDePrivacidade.contemCpfOuEmail(payload) == false, payload.length);
    }

    function _gravarContrato(
        bytes32 id,
        bytes32 deterministicHash,
        bytes32 deterministicHashV2,
        bytes32 contratoHash,
        bytes32 locatarioHash,
        bytes32 imovelHash,
        bytes32 documentoModeloHash,
        TipoHash tipoHash,
        uint32 prazoVigenciaDias,
        uint16 indiceReajuste,
        address[] calldata partes
    ) private {
        Registro storage r = _contratos[id];
        r.id = id;
        r.deterministicHash = deterministicHash;
        r.deterministicHashV2 = deterministicHashV2;
        r.contratoHash = contratoHash;
        r.locatarioHash = locatarioHash;
        r.imovelHash = imovelHash;
        r.documentoModeloHash = documentoModeloHash;
        r.registroPor = msg.sender;
        r.registradoEm = uint64(block.timestamp);
        r.bloco = uint32(block.number);
        r.prazoVigenciaDias = prazoVigenciaDias;
        r.indiceReajuste = indiceReajuste;
        r.status = StatusContrato.NaoAssinado;
        r.tipoHash = tipoHash;
        r.partes = partes;

        _contratosExiste[id] = true;
        totalContratos += 1;
        _contratosDoRegistrador[msg.sender].push(id);

        for (uint256 i = 0; i < partes.length; i++) {
            if (partes[i] == address(0)) revert E_UNAUTHORIZED(address(0));
            _partesDoContrato[id].push(partes[i]);
            _contratosDaParte[partes[i]].push(id);
        }
    }

    function _payloadAuditado(Registro memory r) private pure returns (bytes memory) {
        return abi.encode(r.contratoHash, r.locatarioHash, r.imovelHash, r.deterministicHash, r.deterministicHashV2, r.documentoModeloHash, r.partes);
    }

    function _compararHash(bytes32 hashAncorado, bytes32 hashInformado) private pure returns (bool, bytes32) {
        return (hashAncorado == hashInformado, hashAncorado);
    }

    function _isParte(bytes32 id, address parte) private view returns (bool) {
        address[] storage lista = _partesDoContrato[id];
        for (uint256 i = 0; i < lista.length; i++) {
            if (lista[i] == parte) return true;
        }
        return false;
    }

    function _atualizarStatus(Registro storage r) private returns (StatusContrato) {
        uint256 total = r.partes.length;
        if (total == 0) return (r.status = StatusContrato.NaoAssinado);

        uint256 assinadas = 0;
        for (uint256 i = 0; i < total; i++) {
            if (_assinaturas[r.id][r.partes[i]]) assinadas++;
        }

        if (assinadas == 0) r.status = StatusContrato.NaoAssinado;
        else if (assinadas < total) r.status = StatusContrato.ParcialmenteAssinado;
        else r.status = StatusContrato.Assinado;

        return r.status;
    }
}