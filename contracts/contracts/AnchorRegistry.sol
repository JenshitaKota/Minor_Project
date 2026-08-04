// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Notarizes hashes of approved manufacturing records on-chain.
/// @dev Stores only a hash per record, never the record content itself.
contract AnchorRegistry is Ownable {
    struct Anchor {
        bytes32 contentHash;
        uint256 timestamp;
        address anchoredBy;
    }

    mapping(bytes32 => Anchor) private _anchors;

    /// @notice A single anomaly verdict anchored against a record - e.g. "this approval
    /// was flagged as unusually fast for this reviewer". Anchoring the finding itself
    /// (not just the record content) means the verdict can't be silently altered or
    /// suppressed later, even by someone with direct database access.
    struct AnomalyFinding {
        bytes32 findingHash;
        uint256 timestamp;
    }

    mapping(bytes32 => AnomalyFinding[]) private _anomalyFindings;

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

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @notice Anchors a record's content hash. Reverts if this recordId was already anchored,
    /// so an approved record can never be silently re-pointed to a different hash.
    function anchorRecord(bytes32 recordId, bytes32 contentHash) external onlyOwner {
        // block.timestamp is never exactly 0 on any real chain, and miners can only shift
        // it by seconds - irrelevant for a one-time "has this ever been set" flag.
        // slither-disable-next-line timestamp
        require(_anchors[recordId].timestamp == 0, "AnchorRegistry: already anchored");
        require(contentHash != bytes32(0), "AnchorRegistry: empty hash");

        _anchors[recordId] = Anchor({
            contentHash: contentHash,
            timestamp: block.timestamp,
            anchoredBy: msg.sender
        });

        emit RecordAnchored(recordId, contentHash, block.timestamp, msg.sender);
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

    /// @notice Anchors an anomaly verdict (e.g. a fast-approval or off-hours-approval
    /// finding) against a record. A record may accumulate several distinct findings;
    /// re-anchoring the exact same finding hash reverts, making this idempotent against
    /// retries.
    function anchorAnomalyFinding(bytes32 recordId, bytes32 findingHash) external onlyOwner {
        require(findingHash != bytes32(0), "AnchorRegistry: empty finding hash");

        AnomalyFinding[] storage findings = _anomalyFindings[recordId];
        for (uint256 i = 0; i < findings.length; i++) {
            // slither-disable-next-line incorrect-equality
            require(findings[i].findingHash != findingHash, "AnchorRegistry: finding already anchored");
        }

        findings.push(AnomalyFinding({findingHash: findingHash, timestamp: block.timestamp}));

        emit AnomalyFindingAnchored(recordId, findingHash, block.timestamp);
    }

    function getAnomalyFindings(bytes32 recordId) external view returns (AnomalyFinding[] memory) {
        return _anomalyFindings[recordId];
    }
}
