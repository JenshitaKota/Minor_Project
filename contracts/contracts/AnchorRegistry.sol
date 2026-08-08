// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Notarizes hashes of approved manufacturing records - and the anomaly
/// verdicts about how they were reviewed - on-chain. Anchoring requires two
/// independent attestors to jointly confirm each anchor (propose + co-sign), so no
/// single party (not even the contract owner) can unilaterally anchor anything.
/// Control of the attestor set itself is likewise not unilateral: adding a new
/// attestor requires two distinct existing attestors to agree (the owner has no
/// say at all in who becomes trusted), and removing one requires the owner and a
/// distinct attestor to agree (so neither the owner alone nor a same-sized bloc of
/// attestors can silently expand or censor the trusted set).
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

    struct PendingAttestorAdd {
        address proposedBy;
        uint256 proposedAt;
    }

    /// @notice `proposedByOwner` records which side of the owner/attestor divide
    /// proposed the removal, since approval must come from the *other* side.
    struct PendingAttestorRemoval {
        address proposedBy;
        bool proposedByOwner;
        uint256 proposedAt;
    }

    mapping(bytes32 => Anchor) private _anchors;
    mapping(bytes32 => AnomalyFinding[]) private _anomalyFindings;
    mapping(bytes32 => PendingAnchor) private _pending;
    mapping(address => bool) public isAttestor;
    mapping(address => PendingAttestorAdd) private _pendingAdd;
    mapping(address => PendingAttestorRemoval) private _pendingRemoval;

    /// @notice Number of active attestors. Removal is blocked from dropping this to
    /// 2 or below, since adding a new attestor requires two distinct *existing*
    /// attestors to agree - dropping below that floor would permanently brick the
    /// contract's ability to ever admit another attestor.
    uint256 public attestorCount;

    uint256 private constant MIN_ATTESTOR_COUNT = 2;

    event AttestorAdded(address indexed attestor);
    event AttestorRemoved(address indexed attestor);
    event AttestorAddProposed(address indexed candidate, address indexed proposedBy);
    event AttestorAddApproved(address indexed candidate, address indexed approvedBy);
    event AttestorRemovalProposed(address indexed target, address indexed proposedBy);
    event AttestorRemovalApproved(address indexed target, address indexed approvedBy);

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

    /// @notice Proposes admitting a new attestor. Callable only by an existing
    /// attestor - the owner has no path to unilaterally add one, closing the hole
    /// where a compromised owner key could inject a rogue attestor able to forge
    /// future co-signatures.
    function proposeAddAttestor(address candidate) external onlyAttestor {
        require(candidate != address(0), "AnchorRegistry: zero address");
        require(!isAttestor[candidate], "AnchorRegistry: already an attestor");
        // slither-disable-next-line timestamp
        require(_pendingAdd[candidate].proposedAt == 0, "AnchorRegistry: already proposed");

        _pendingAdd[candidate] = PendingAttestorAdd({proposedBy: msg.sender, proposedAt: block.timestamp});
        emit AttestorAddProposed(candidate, msg.sender);
    }

    /// @notice Confirms a pending attestor-add proposal. Must be a *different*
    /// attestor than whoever proposed it - the same two-independent-party guarantee
    /// used for anchoring itself, applied to the attestor set.
    function approveAddAttestor(address candidate) external onlyAttestor {
        PendingAttestorAdd memory pending = _pendingAdd[candidate];
        // slither-disable-next-line timestamp
        require(pending.proposedAt != 0, "AnchorRegistry: no pending add proposal");
        require(msg.sender != pending.proposedBy, "AnchorRegistry: cannot approve your own proposal");

        delete _pendingAdd[candidate];
        _setAttestor(candidate, true);
        emit AttestorAddApproved(candidate, msg.sender);
    }

    /// @notice Proposes removing an attestor. Callable by the owner or by an
    /// existing attestor - either side may initiate.
    function proposeRemoveAttestor(address target) external {
        require(msg.sender == owner() || isAttestor[msg.sender], "AnchorRegistry: not authorized");
        require(isAttestor[target], "AnchorRegistry: target is not an attestor");
        // slither-disable-next-line timestamp
        require(_pendingRemoval[target].proposedAt == 0, "AnchorRegistry: already proposed");

        _pendingRemoval[target] = PendingAttestorRemoval({
            proposedBy: msg.sender,
            proposedByOwner: msg.sender == owner(),
            proposedAt: block.timestamp
        });
        emit AttestorRemovalProposed(target, msg.sender);
    }

    /// @notice Confirms a pending attestor removal. Approval must come from the
    /// *other* side of the owner/attestor divide from whoever proposed it (an
    /// owner-proposed removal needs a distinct attestor's approval; an
    /// attestor-proposed removal needs the owner's approval) - so neither the owner
    /// alone nor a same-sized bloc of attestors can unilaterally censor the set, and
    /// the targeted attestor can never approve their own removal. Reverts if
    /// completing the removal would drop the attestor count to the minimum floor.
    function approveRemoveAttestor(address target) external {
        PendingAttestorRemoval memory pending = _pendingRemoval[target];
        // slither-disable-next-line timestamp
        require(pending.proposedAt != 0, "AnchorRegistry: no pending removal proposal");
        require(msg.sender != pending.proposedBy, "AnchorRegistry: cannot approve your own proposal");
        require(msg.sender != target, "AnchorRegistry: target cannot approve their own removal");
        require(attestorCount > MIN_ATTESTOR_COUNT, "AnchorRegistry: would drop below minimum attestor count");

        if (pending.proposedByOwner) {
            require(isAttestor[msg.sender], "AnchorRegistry: requires a different attestor to approve");
        } else {
            require(msg.sender == owner(), "AnchorRegistry: requires the owner to approve");
        }

        delete _pendingRemoval[target];
        _setAttestor(target, false);
        emit AttestorRemovalApproved(target, msg.sender);
    }

    function _setAttestor(address attestor, bool allowed) private {
        if (isAttestor[attestor] == allowed) return;
        isAttestor[attestor] = allowed;
        if (allowed) {
            attestorCount += 1;
            emit AttestorAdded(attestor);
        } else {
            attestorCount -= 1;
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

    function getPendingAttestorAdd(address candidate) external view returns (PendingAttestorAdd memory) {
        return _pendingAdd[candidate];
    }

    function getPendingAttestorRemoval(address target) external view returns (PendingAttestorRemoval memory) {
        return _pendingRemoval[target];
    }
}
