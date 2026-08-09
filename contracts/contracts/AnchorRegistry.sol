// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Notarizes hashes of approved manufacturing records - and the anomaly
/// verdicts about how they were reviewed - on-chain. Anchoring requires a
/// configurable M of the N registered attestors to jointly confirm each anchor
/// (propose + confirm), so no single party (not even the contract owner) can
/// unilaterally anchor anything - and no subset smaller than M can either. At the
/// smallest valid configuration (M=2) this behaves exactly like a fixed two-party
/// propose/co-sign scheme; the reference deployment uses exactly that.
/// Control of the attestor set itself is likewise not unilateral: adding a new
/// attestor requires two distinct existing attestors to agree (the owner has no
/// say at all in who becomes trusted), and removing one requires the owner and a
/// distinct attestor to agree (so neither the owner alone nor a same-sized bloc of
/// attestors can silently expand or censor the trusted set). Note this add/remove
/// governance threshold stays fixed at two regardless of the configured M for
/// anchoring - a deliberate, disclosed scope boundary, not an oversight.
/// @dev Stores only hashes, never record content itself.
contract AnchorRegistry is Ownable {
    struct Anchor {
        bytes32 contentHash;
        uint256 timestamp;
        address proposedBy;
        /// @dev The final (Mth) confirmer only - not an exhaustive list of every
        /// attestor who confirmed. See getConfirmers for the full ordered set.
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

    /// @notice Every attestor who has confirmed a given recordId, in confirmation
    /// order (proposer first). Never cleared after finalization - permanently
    /// capped at exactly `requiredConfirmations` entries per recordId (a new
    /// confirmation is only ever accepted while a pending proposal exists, and
    /// finalizing deletes the pending entry), so this is bounded storage, not
    /// unbounded growth. See getConfirmers.
    mapping(bytes32 => address[]) private _confirmers;
    mapping(bytes32 => mapping(address => bool)) private _hasConfirmed;

    /// @notice Number of active attestors. Removal is blocked from dropping this to
    /// `requiredConfirmations` or below: below that floor, no anchor could ever be
    /// finalized again (not enough distinct attestors left to ever gather M
    /// confirmations), and since requiredConfirmations is itself required to be at
    /// least 2, this also always covers the earlier concern that admitting a new
    /// attestor needs two distinct *existing* attestors to agree.
    uint256 public attestorCount;

    /// @notice How many distinct attestor confirmations (the proposer counts as
    /// the first) are required to finalize an anchor. Fixed at deployment,
    /// deliberately not owner- or governance-changeable after the fact - changing
    /// it post-deployment would itself be a new centralized control point over an
    /// already-anchored trust model.
    uint256 public immutable requiredConfirmations;

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

    /// @notice Emitted for every confirmation (including the proposer's implicit
    /// first confirmation and the finalizing Mth one) - unlike AnchorProposed and
    /// RecordAnchored/AnchorCoSigned, this fires for intermediate confirmations too
    /// (relevant once requiredConfirmations > 2), so an off-chain watcher doesn't
    /// need to poll getConfirmers to know a confirmation just landed.
    event AnchorConfirmed(bytes32 indexed recordId, address indexed confirmedBy, uint256 confirmationsCount);

    modifier onlyAttestor() {
        require(isAttestor[msg.sender], "AnchorRegistry: not an attestor");
        _;
    }

    constructor(address initialOwner, address[] memory initialAttestors, uint256 requiredConfirmations_)
        Ownable(initialOwner)
    {
        require(requiredConfirmations_ >= 2, "AnchorRegistry: too few required confirmations");
        require(initialAttestors.length >= requiredConfirmations_, "AnchorRegistry: not enough initial attestors");

        for (uint256 i = 0; i < initialAttestors.length; i++) {
            _setAttestor(initialAttestors[i], true);
        }

        // Re-check against the *actual* distinct count, not just array length -
        // _setAttestor is idempotent, so a duplicate address in initialAttestors
        // would otherwise pass the length check above while leaving attestorCount
        // too low to ever reach requiredConfirmations, permanently deadlocking the
        // contract (no anchor could ever be finalized again).
        require(attestorCount >= requiredConfirmations_, "AnchorRegistry: not enough distinct initial attestors");

        requiredConfirmations = requiredConfirmations_;
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
        require(attestorCount > requiredConfirmations, "AnchorRegistry: would drop below minimum attestor count");

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
    /// hashes detected at review time, as one package. Anchors nothing by itself -
    /// requiredConfirmations - 1 more *distinct* attestors must each independently
    /// coSignAnchor the exact same package before it becomes permanent (at the
    /// reference deployment's requiredConfirmations=2, that's exactly one more, the
    /// same fixed two-party scheme as before). Reverts if this recordId was already
    /// anchored or already has a pending proposal.
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
        _confirmers[recordId].push(msg.sender);
        _hasConfirmed[recordId][msg.sender] = true;

        emit AnchorProposed(recordId, contentHash, msg.sender);
        emit AnchorConfirmed(recordId, msg.sender, 1);
    }

    /// @notice Independently confirms a pending proposal. The caller must be a
    /// *different* attestor than whoever proposed it, and must not have already
    /// confirmed this same proposal - the core guarantee that no single party (and
    /// no party more than once) can move an anchor toward finalization alone - and
    /// must resupply the exact same contentHash/findingHashes as the proposal, so
    /// each confirmer is confirming the specific package, not blindly trusting
    /// whatever was proposed. Finalizes the anchor, atomically with any bundled
    /// anomaly findings, once requiredConfirmations distinct attestors (including
    /// the original proposer) have confirmed - at the reference deployment's
    /// requiredConfirmations=2, that's this same first call, exactly as before.
    function coSignAnchor(bytes32 recordId, bytes32 contentHash, bytes32[] calldata findingHashes)
        external
        onlyAttestor
    {
        PendingAnchor memory pending = _pending[recordId];
        // slither-disable-next-line timestamp
        require(pending.proposedAt != 0, "AnchorRegistry: no pending proposal");
        require(msg.sender != pending.proposedBy, "AnchorRegistry: cannot co-sign your own proposal");
        require(!_hasConfirmed[recordId][msg.sender], "AnchorRegistry: already confirmed");
        // slither-disable-next-line incorrect-equality
        require(pending.contentHash == contentHash, "AnchorRegistry: content hash mismatch");
        require(
            keccak256(abi.encode(pending.findingHashes)) == keccak256(abi.encode(findingHashes)),
            "AnchorRegistry: finding hashes mismatch"
        );

        _hasConfirmed[recordId][msg.sender] = true;
        _confirmers[recordId].push(msg.sender);
        uint256 confirmationsCount = _confirmers[recordId].length;
        emit AnchorConfirmed(recordId, msg.sender, confirmationsCount);

        if (confirmationsCount < requiredConfirmations) {
            return;
        }

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

    /// @notice Every attestor who has confirmed this recordId, in confirmation
    /// order (proposer first) - the full ordered set that Anchor.coSignedBy alone
    /// doesn't capture, since that field only names the final confirmer. Works
    /// both while a proposal is still pending (partial list) and after it has
    /// finalized (permanent, complete list - never cleared).
    function getConfirmers(bytes32 recordId) external view returns (address[] memory) {
        return _confirmers[recordId];
    }

    function getPendingAttestorAdd(address candidate) external view returns (PendingAttestorAdd memory) {
        return _pendingAdd[candidate];
    }

    function getPendingAttestorRemoval(address target) external view returns (PendingAttestorRemoval memory) {
        return _pendingRemoval[target];
    }
}
