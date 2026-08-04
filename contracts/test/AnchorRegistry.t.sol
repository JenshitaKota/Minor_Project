// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AnchorRegistry} from "../contracts/AnchorRegistry.sol";

contract AnchorRegistryTest is Test {
    AnchorRegistry public registry;
    address public owner = address(0xA11CE);
    address public stranger = address(0xBEEF);

    function setUp() public {
        registry = new AnchorRegistry(owner);
    }

    function testAnchorRecordStoresHashAndTimestamp() public {
        bytes32 recordId = keccak256("batch-001/record-1");
        bytes32 contentHash = keccak256("record content v1");

        vm.warp(1_700_000_000);
        vm.prank(owner);
        registry.anchorRecord(recordId, contentHash);

        AnchorRegistry.Anchor memory a = registry.getAnchor(recordId);
        assertEq(a.contentHash, contentHash);
        assertEq(a.timestamp, 1_700_000_000);
        assertEq(a.anchoredBy, owner);
    }

    function testVerifyMatchesUnmodifiedRecord() public {
        bytes32 recordId = keccak256("batch-001/record-1");
        bytes32 contentHash = keccak256("record content v1");

        vm.prank(owner);
        registry.anchorRecord(recordId, contentHash);

        (bool anchored, bool matches, uint256 timestamp) = registry.verifyRecord(recordId, contentHash);
        assertTrue(anchored);
        assertTrue(matches);
        assertGt(timestamp, 0);
    }

    function testVerifyFailsForTamperedRecord() public {
        bytes32 recordId = keccak256("batch-001/record-1");
        bytes32 originalHash = keccak256("record content v1");
        bytes32 tamperedHash = keccak256("record content v1 - edited after approval");

        vm.prank(owner);
        registry.anchorRecord(recordId, originalHash);

        (bool anchored, bool matches, ) = registry.verifyRecord(recordId, tamperedHash);
        assertTrue(anchored);
        assertFalse(matches);
    }

    function testVerifyUnanchoredRecordReturnsFalse() public view {
        bytes32 recordId = keccak256("never-anchored");
        (bool anchored, bool matches, uint256 timestamp) = registry.verifyRecord(recordId, keccak256("anything"));
        assertFalse(anchored);
        assertFalse(matches);
        assertEq(timestamp, 0);
    }

    function testCannotReanchorExistingRecordId() public {
        bytes32 recordId = keccak256("batch-001/record-1");

        vm.startPrank(owner);
        registry.anchorRecord(recordId, keccak256("v1"));

        vm.expectRevert("AnchorRegistry: already anchored");
        registry.anchorRecord(recordId, keccak256("v2 - trying to overwrite"));
        vm.stopPrank();
    }

    function testCannotAnchorEmptyHash() public {
        vm.prank(owner);
        vm.expectRevert("AnchorRegistry: empty hash");
        registry.anchorRecord(keccak256("some-record"), bytes32(0));
    }

    function testNonOwnerCannotAnchor() public {
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", stranger)
        );
        registry.anchorRecord(keccak256("some-record"), keccak256("some-hash"));
    }

    /// @dev Fuzz: for ANY recordId/hash pair, anchoring once then verifying with the
    /// same hash must always report a match, regardless of input values.
    function testFuzzAnchorThenVerifyAlwaysMatches(bytes32 recordId, bytes32 contentHash) public {
        vm.assume(contentHash != bytes32(0));

        vm.prank(owner);
        registry.anchorRecord(recordId, contentHash);

        (bool anchored, bool matches, ) = registry.verifyRecord(recordId, contentHash);
        assertTrue(anchored);
        assertTrue(matches);
    }

    /// @dev Fuzz: verifying against any hash other than the anchored one must never match.
    function testFuzzTamperedHashNeverMatches(bytes32 recordId, bytes32 originalHash, bytes32 tamperedHash) public {
        vm.assume(originalHash != bytes32(0));
        vm.assume(originalHash != tamperedHash);

        vm.prank(owner);
        registry.anchorRecord(recordId, originalHash);

        (, bool matches, ) = registry.verifyRecord(recordId, tamperedHash);
        assertFalse(matches);
    }

    /// @dev Fuzz: re-anchoring the same recordId must always revert, no matter the hashes.
    function testFuzzReanchorAlwaysReverts(bytes32 recordId, bytes32 firstHash, bytes32 secondHash) public {
        vm.assume(firstHash != bytes32(0));
        vm.assume(secondHash != bytes32(0));

        vm.startPrank(owner);
        registry.anchorRecord(recordId, firstHash);

        vm.expectRevert("AnchorRegistry: already anchored");
        registry.anchorRecord(recordId, secondHash);
        vm.stopPrank();
    }

    function testAnchorAnomalyFindingStoresHashAndTimestamp() public {
        bytes32 recordId = keccak256("batch-001/record-1");
        bytes32 findingHash = keccak256("fast-approval finding v1");

        vm.warp(1_700_000_000);
        vm.prank(owner);
        registry.anchorAnomalyFinding(recordId, findingHash);

        AnchorRegistry.AnomalyFinding[] memory findings = registry.getAnomalyFindings(recordId);
        assertEq(findings.length, 1);
        assertEq(findings[0].findingHash, findingHash);
        assertEq(findings[0].timestamp, 1_700_000_000);
    }

    function testAnchorAnomalyFindingAccumulatesMultipleDistinctFindings() public {
        bytes32 recordId = keccak256("batch-001/record-1");
        bytes32 fastApprovalFinding = keccak256("fast-approval finding");
        bytes32 offHoursFinding = keccak256("off-hours-approval finding");

        vm.startPrank(owner);
        registry.anchorAnomalyFinding(recordId, fastApprovalFinding);
        registry.anchorAnomalyFinding(recordId, offHoursFinding);
        vm.stopPrank();

        AnchorRegistry.AnomalyFinding[] memory findings = registry.getAnomalyFindings(recordId);
        assertEq(findings.length, 2);
        assertEq(findings[0].findingHash, fastApprovalFinding);
        assertEq(findings[1].findingHash, offHoursFinding);
    }

    function testCannotAnchorDuplicateAnomalyFinding() public {
        bytes32 recordId = keccak256("batch-001/record-1");
        bytes32 findingHash = keccak256("fast-approval finding");

        vm.startPrank(owner);
        registry.anchorAnomalyFinding(recordId, findingHash);

        vm.expectRevert("AnchorRegistry: finding already anchored");
        registry.anchorAnomalyFinding(recordId, findingHash);
        vm.stopPrank();
    }

    function testCannotAnchorEmptyAnomalyFindingHash() public {
        vm.prank(owner);
        vm.expectRevert("AnchorRegistry: empty finding hash");
        registry.anchorAnomalyFinding(keccak256("some-record"), bytes32(0));
    }

    function testNonOwnerCannotAnchorAnomalyFinding() public {
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", stranger)
        );
        registry.anchorAnomalyFinding(keccak256("some-record"), keccak256("some-finding"));
    }

    function testGetAnomalyFindingsReturnsEmptyForUnanchoredRecord() public view {
        AnchorRegistry.AnomalyFinding[] memory findings = registry.getAnomalyFindings(keccak256("never-anchored"));
        assertEq(findings.length, 0);
    }

    /// @dev Fuzz: anchoring one finding then reading it back must always return exactly
    /// that hash, regardless of recordId/findingHash values.
    function testFuzzAnchorAnomalyFindingThenReadBackAlwaysMatches(bytes32 recordId, bytes32 findingHash) public {
        vm.assume(findingHash != bytes32(0));

        vm.prank(owner);
        registry.anchorAnomalyFinding(recordId, findingHash);

        AnchorRegistry.AnomalyFinding[] memory findings = registry.getAnomalyFindings(recordId);
        assertEq(findings.length, 1);
        assertEq(findings[0].findingHash, findingHash);
    }

    /// @dev Fuzz: re-anchoring the same finding hash for the same record must always
    /// revert, no matter the values.
    function testFuzzDuplicateAnomalyFindingAlwaysReverts(bytes32 recordId, bytes32 findingHash) public {
        vm.assume(findingHash != bytes32(0));

        vm.startPrank(owner);
        registry.anchorAnomalyFinding(recordId, findingHash);

        vm.expectRevert("AnchorRegistry: finding already anchored");
        registry.anchorAnomalyFinding(recordId, findingHash);
        vm.stopPrank();
    }
}
