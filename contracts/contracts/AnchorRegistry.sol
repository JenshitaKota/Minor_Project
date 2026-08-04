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

    event RecordAnchored(
        bytes32 indexed recordId,
        bytes32 contentHash,
        uint256 timestamp,
        address indexed anchoredBy
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
}
