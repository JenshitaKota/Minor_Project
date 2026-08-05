// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AnchorRegistry} from "../contracts/AnchorRegistry.sol";

contract AnchorRegistryTest is Test {
    AnchorRegistry public registry;
    address public owner = address(0xA11CE);
    address public attestor1 = address(0xA771);
    address public attestor2 = address(0xA772);
    address public stranger = address(0xBEEF);

    function setUp() public {
        address[] memory attestors = new address[](2);
        attestors[0] = attestor1;
        attestors[1] = attestor2;
        registry = new AnchorRegistry(owner, attestors);
    }

    function emptyFindings() internal pure returns (bytes32[] memory) {
        return new bytes32[](0);
    }

    function oneFinding(bytes32 findingHash) internal pure returns (bytes32[] memory) {
        bytes32[] memory findings = new bytes32[](1);
        findings[0] = findingHash;
        return findings;
    }

    function testProposeThenCoSignAnchorsRecordAndFindings() public {
        bytes32 recordId = keccak256("batch-001/record-1");
        bytes32 contentHash = keccak256("record content v1");
        bytes32[] memory findings = oneFinding(keccak256("fast-approval finding"));

        vm.warp(1_700_000_000);
        vm.prank(attestor1);
        registry.proposeAnchor(recordId, contentHash, findings);

        vm.prank(attestor2);
        registry.coSignAnchor(recordId, contentHash, findings);

        AnchorRegistry.Anchor memory a = registry.getAnchor(recordId);
        assertEq(a.contentHash, contentHash);
        assertEq(a.timestamp, 1_700_000_000);
        assertEq(a.proposedBy, attestor1);
        assertEq(a.coSignedBy, attestor2);

        AnchorRegistry.AnomalyFinding[] memory anchoredFindings = registry.getAnomalyFindings(recordId);
        assertEq(anchoredFindings.length, 1);
        assertEq(anchoredFindings[0].findingHash, findings[0]);
        assertEq(anchoredFindings[0].timestamp, 1_700_000_000);
    }

    function testProposeAnchorWithNoFindingsWorks() public {
        bytes32 recordId = keccak256("batch-001/record-1");
        bytes32 contentHash = keccak256("record content v1");

        vm.prank(attestor1);
        registry.proposeAnchor(recordId, contentHash, emptyFindings());
        vm.prank(attestor2);
        registry.coSignAnchor(recordId, contentHash, emptyFindings());

        (bool anchored, bool matches, ) = registry.verifyRecord(recordId, contentHash);
        assertTrue(anchored);
        assertTrue(matches);
        assertEq(registry.getAnomalyFindings(recordId).length, 0);
    }

    function testCannotCoSignOwnProposal() public {
        bytes32 recordId = keccak256("batch-001/record-1");
        bytes32 contentHash = keccak256("record content v1");

        vm.startPrank(attestor1);
        registry.proposeAnchor(recordId, contentHash, emptyFindings());

        vm.expectRevert("AnchorRegistry: cannot co-sign your own proposal");
        registry.coSignAnchor(recordId, contentHash, emptyFindings());
        vm.stopPrank();
    }

    function testCannotCoSignWithMismatchedContentHash() public {
        bytes32 recordId = keccak256("batch-001/record-1");

        vm.prank(attestor1);
        registry.proposeAnchor(recordId, keccak256("v1"), emptyFindings());

        vm.prank(attestor2);
        vm.expectRevert("AnchorRegistry: content hash mismatch");
        registry.coSignAnchor(recordId, keccak256("v2 - different from proposal"), emptyFindings());
    }

    function testCannotCoSignWithMismatchedFindingHashes() public {
        bytes32 recordId = keccak256("batch-001/record-1");
        bytes32 contentHash = keccak256("v1");

        vm.prank(attestor1);
        registry.proposeAnchor(recordId, contentHash, oneFinding(keccak256("fast-approval")));

        vm.prank(attestor2);
        vm.expectRevert("AnchorRegistry: finding hashes mismatch");
        registry.coSignAnchor(recordId, contentHash, oneFinding(keccak256("off-hours-approval")));
    }

    function testCannotCoSignWithoutPendingProposal() public {
        vm.prank(attestor1);
        vm.expectRevert("AnchorRegistry: no pending proposal");
        registry.coSignAnchor(keccak256("never-proposed"), keccak256("anything"), emptyFindings());
    }

    function testCannotProposeWhenAlreadyAnchored() public {
        bytes32 recordId = keccak256("batch-001/record-1");
        bytes32 contentHash = keccak256("v1");

        vm.prank(attestor1);
        registry.proposeAnchor(recordId, contentHash, emptyFindings());
        vm.prank(attestor2);
        registry.coSignAnchor(recordId, contentHash, emptyFindings());

        vm.prank(attestor1);
        vm.expectRevert("AnchorRegistry: already anchored");
        registry.proposeAnchor(recordId, keccak256("v2"), emptyFindings());
    }

    function testCannotProposeWhenAlreadyPending() public {
        bytes32 recordId = keccak256("batch-001/record-1");

        vm.prank(attestor1);
        registry.proposeAnchor(recordId, keccak256("v1"), emptyFindings());

        vm.prank(attestor2);
        vm.expectRevert("AnchorRegistry: already proposed");
        registry.proposeAnchor(recordId, keccak256("v2"), emptyFindings());
    }

    function testCannotProposeEmptyHash() public {
        vm.prank(attestor1);
        vm.expectRevert("AnchorRegistry: empty hash");
        registry.proposeAnchor(keccak256("some-record"), bytes32(0), emptyFindings());
    }

    function testNonAttestorCannotPropose() public {
        vm.prank(stranger);
        vm.expectRevert("AnchorRegistry: not an attestor");
        registry.proposeAnchor(keccak256("some-record"), keccak256("some-hash"), emptyFindings());
    }

    function testNonAttestorCannotCoSign() public {
        bytes32 recordId = keccak256("batch-001/record-1");
        vm.prank(attestor1);
        registry.proposeAnchor(recordId, keccak256("v1"), emptyFindings());

        vm.prank(stranger);
        vm.expectRevert("AnchorRegistry: not an attestor");
        registry.coSignAnchor(recordId, keccak256("v1"), emptyFindings());
    }

    function testGetPendingAnchorReturnsEmptyForUnknownRecord() public view {
        AnchorRegistry.PendingAnchor memory pending = registry.getPendingAnchor(keccak256("never-proposed"));
        assertEq(pending.proposedAt, 0);
        assertEq(pending.proposedBy, address(0));
    }

    function testVerifyUnanchoredRecordReturnsFalse() public view {
        (bool anchored, bool matches, uint256 timestamp) = registry.verifyRecord(keccak256("never-anchored"), keccak256("anything"));
        assertFalse(anchored);
        assertFalse(matches);
        assertEq(timestamp, 0);
    }

    function testVerifyFailsForTamperedRecord() public {
        bytes32 recordId = keccak256("batch-001/record-1");
        bytes32 originalHash = keccak256("record content v1");
        bytes32 tamperedHash = keccak256("record content v1 - edited after approval");

        vm.prank(attestor1);
        registry.proposeAnchor(recordId, originalHash, emptyFindings());
        vm.prank(attestor2);
        registry.coSignAnchor(recordId, originalHash, emptyFindings());

        (bool anchored, bool matches, ) = registry.verifyRecord(recordId, tamperedHash);
        assertTrue(anchored);
        assertFalse(matches);
    }

    function testOwnerCanAddAndRemoveAttestor() public {
        address newAttestor = address(0xA773);
        assertFalse(registry.isAttestor(newAttestor));

        vm.prank(owner);
        registry.addAttestor(newAttestor);
        assertTrue(registry.isAttestor(newAttestor));

        vm.prank(owner);
        registry.removeAttestor(newAttestor);
        assertFalse(registry.isAttestor(newAttestor));
    }

    function testNonOwnerCannotAddAttestor() public {
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", stranger)
        );
        registry.addAttestor(stranger);
    }

    /// @dev Fuzz: for ANY recordId/hash pair, proposing then co-signing from a
    /// different attestor must always result in a matching anchor.
    function testFuzzProposeThenCoSignAlwaysMatches(bytes32 recordId, bytes32 contentHash) public {
        vm.assume(contentHash != bytes32(0));

        vm.prank(attestor1);
        registry.proposeAnchor(recordId, contentHash, emptyFindings());
        vm.prank(attestor2);
        registry.coSignAnchor(recordId, contentHash, emptyFindings());

        (bool anchored, bool matches, ) = registry.verifyRecord(recordId, contentHash);
        assertTrue(anchored);
        assertTrue(matches);
    }

    /// @dev Fuzz: the same attestor can never co-sign its own proposal, for any
    /// recordId/hash pair.
    function testFuzzCannotCoSignOwnProposal(bytes32 recordId, bytes32 contentHash) public {
        vm.assume(contentHash != bytes32(0));

        vm.startPrank(attestor1);
        registry.proposeAnchor(recordId, contentHash, emptyFindings());

        vm.expectRevert("AnchorRegistry: cannot co-sign your own proposal");
        registry.coSignAnchor(recordId, contentHash, emptyFindings());
        vm.stopPrank();
    }

    /// @dev Fuzz: verifying against any hash other than the anchored one must never match.
    function testFuzzTamperedHashNeverMatches(bytes32 recordId, bytes32 originalHash, bytes32 tamperedHash) public {
        vm.assume(originalHash != bytes32(0));
        vm.assume(originalHash != tamperedHash);

        vm.prank(attestor1);
        registry.proposeAnchor(recordId, originalHash, emptyFindings());
        vm.prank(attestor2);
        registry.coSignAnchor(recordId, originalHash, emptyFindings());

        (, bool matches, ) = registry.verifyRecord(recordId, tamperedHash);
        assertFalse(matches);
    }
}
