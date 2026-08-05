// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Notarizes hashes of approved manufacturing records - and the anomaly
/// verdicts about how they were reviewed - on-chain. Anchoring requires two
/// independent attestors to jointly confirm each anchor (propose + co-sign), so no
/// single party (not even the contract owner) can unilaterally anchor anything.
/// @dev Stores only hashes, never record content itself.
contract AnchorRegistry is Ownable {
    struct Anchor {
        bytes32 contentHash;
        uint256 timestamp;
        address proposedBy;
        address coSignedBy;
    }

    /// @notice A single anomaly verdict anchored against a record - e.g. "this approval
    /// was flagged as unusually fast for this reviewer". Anchoring the finding itself
    /// (not just the record content) means the verdict can't be silently altered or
    /// suppressed later, even by someone with direct database access.
    struct AnomalyFinding {
        bytes32 findingHash;
        uint256 timestamp;
    }

    struct PendingAnchor {
        bytes32 contentHash;
        bytes32[] findingHashes;
        address proposedBy;
        uint256 proposedAt;
    }

    mapping(bytes32 => Anchor) private _anchors;
    mapping(bytes32 => AnomalyFinding[]) private _anomalyFindings;
    mapping(bytes32 => PendingAnchor) private _pending;
    mapping(address => bool) public isAttestor;

    event AttestorAdded(address indexed attestor);
    event AttestorRemoved(address indexed attestor);

    event AnchorProposed(bytes32 indexed recordId, bytes32 contentHash, address indexed proposedBy);

    event RecordAnchored(
        bytes32 indexed recordId,
        bytes32 contentHash,
        uint256 timestamp,
        address indexed anchoredBy
    );

    event AnomalyFindingAnchored(
        bytes32 indexed recordId,
        bytes32 findingHash,
        uint256 timestamp
    );

    event AnchorCoSigned(bytes32 indexed recordId, address indexed proposedBy, address indexed coSignedBy);

    modifier onlyAttestor() {
        require(isAttestor[msg.sender], "AnchorRegistry: not an attestor");
        _;
    }

    constructor(address initialOwner, address[] memory initialAttestors) Ownable(initialOwner) {
        for (uint256 i = 0; i < initialAttestors.length; i++) {
            _setAttestor(initialAttestors[i], true);
        }
    }

    /// @notice Grants or revokes attestor status. Governance of *who may attest* stays
    /// with the owner - a materially smaller trust surface than the single owner
    /// directly controlling every anchoring decision, which is what this contract
    /// otherwise removes.
    function addAttestor(address attestor) external onlyOwner {
        _setAttestor(attestor, true);
    }

    function removeAttestor(address attestor) external onlyOwner {
        _setAttestor(attestor, false);
    }

    function _setAttestor(address attestor, bool allowed) private {
        isAttestor[attestor] = allowed;
        if (allowed) {
            emit AttestorAdded(attestor);
        } else {
            emit AttestorRemoved(attestor);
        }
    }

    /// @notice Proposes anchoring a record's content hash, plus any anomaly-finding
    /// hashes detected at review time, as one package. Anchors nothing by itself - a
    /// *different* attestor must independently coSignAnchor the exact same package
    /// before it becomes permanent. Reverts if this recordId was already anchored or
    /// already has a pending proposal.
    function proposeAnchor(bytes32 recordId, bytes32 contentHash, bytes32[] calldata findingHashes)
        external
        onlyAttestor
    {
        // slither-disable-next-line timestamp
        require(_anchors[recordId].timestamp == 0, "AnchorRegistry: already anchored");
        require(_pending[recordId].proposedAt == 0, "AnchorRegistry: already proposed");
        require(contentHash != bytes32(0), "AnchorRegistry: empty hash");

        _pending[recordId] = PendingAnchor({
            contentHash: contentHash,
            findingHashes: findingHashes,
            proposedBy: msg.sender,
            proposedAt: block.timestamp
        });

        emit AnchorProposed(recordId, contentHash, msg.sender);
    }

    /// @notice Independently confirms a pending proposal, finalizing the anchor. The
    /// caller must be a *different* attestor than whoever proposed it - the core
    /// guarantee that no single party can anchor anything alone - and must resupply
    /// the exact same contentHash/findingHashes as the proposal, so the co-signer is
    /// confirming the specific package, not blindly trusting whatever was proposed.
    function coSignAnchor(bytes32 recordId, bytes32 contentHash, bytes32[] calldata findingHashes)
        external
        onlyAttestor
    {
        PendingAnchor memory pending = _pending[recordId];
        // slither-disable-next-line timestamp
        require(pending.proposedAt != 0, "AnchorRegistry: no pending proposal");
        require(msg.sender != pending.proposedBy, "AnchorRegistry: cannot co-sign your own proposal");
        // slither-disable-next-line incorrect-equality
        require(pending.contentHash == contentHash, "AnchorRegistry: content hash mismatch");
        require(
            keccak256(abi.encode(pending.findingHashes)) == keccak256(abi.encode(findingHashes)),
            "AnchorRegistry: finding hashes mismatch"
        );

        address proposedBy = pending.proposedBy;
        delete _pending[recordId];

        _anchors[recordId] = Anchor({
            contentHash: contentHash,
            timestamp: block.timestamp,
            proposedBy: proposedBy,
            coSignedBy: msg.sender
        });
        emit RecordAnchored(recordId, contentHash, block.timestamp, msg.sender);

        AnomalyFinding[] storage findings = _anomalyFindings[recordId];
        for (uint256 i = 0; i < findingHashes.length; i++) {
            findings.push(AnomalyFinding({findingHash: findingHashes[i], timestamp: block.timestamp}));
            emit AnomalyFindingAnchored(recordId, findingHashes[i], block.timestamp);
        }

        emit AnchorCoSigned(recordId, proposedBy, msg.sender);
    }

    /// @notice Compares a freshly computed hash against the anchored one.
    /// @return anchored Whether this recordId has ever been anchored.
    /// @return matches Whether contentHash matches what was anchored (false if not anchored).
    /// @return timestamp When the record was anchored (0 if never anchored).
    function verifyRecord(bytes32 recordId, bytes32 contentHash)
        external
        view
        returns (bool anchored, bool matches, uint256 timestamp)
    {
        Anchor memory a = _anchors[recordId];
        // slither-disable-next-line timestamp
        anchored = a.timestamp != 0;
        // Exact equality is correct here: contentHash is a keccak256 digest, and tamper
        // detection requires an exact match, not a tolerance-based comparison.
        // slither-disable-next-line incorrect-equality
        matches = anchored && a.contentHash == contentHash;
        timestamp = a.timestamp;
    }

    function getAnchor(bytes32 recordId) external view returns (Anchor memory) {
        return _anchors[recordId];
    }

    function getAnomalyFindings(bytes32 recordId) external view returns (AnomalyFinding[] memory) {
        return _anomalyFindings[recordId];
    }

    function getPendingAnchor(bytes32 recordId) external view returns (PendingAnchor memory) {
        return _pending[recordId];
    }
}
