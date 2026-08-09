// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {AnchorRegistry} from "../contracts/AnchorRegistry.sol";

/// @dev Isolates all requiredConfirmations > 2 surface area, so the M=2/N=2 suite
/// in AnchorRegistry.t.sol stays completely untouched in both behavior and
/// asserted revert text - this file deploys its own N=3 registries.
contract AnchorRegistryMofNTest is Test {
    address public owner = address(0xA11CE);
    address public attestor1 = address(0xA771);
    address public attestor2 = address(0xA772);
    address public attestor3 = address(0xA773);
    address public stranger = address(0xBEEF);

    function emptyFindings() internal pure returns (bytes32[] memory) {
        return new bytes32[](0);
    }

    function _threeAttestors() internal view returns (address[] memory) {
        address[] memory attestors = new address[](3);
        attestors[0] = attestor1;
        attestors[1] = attestor2;
        attestors[2] = attestor3;
        return attestors;
    }

    function _deploy(uint256 requiredConfirmations) internal returns (AnchorRegistry) {
        return new AnchorRegistry(owner, _threeAttestors(), requiredConfirmations);
    }

    function testMofNFinalizesOnlyOnMthConfirmation() public {
        AnchorRegistry registry = _deploy(3);
        bytes32 recordId = keccak256("record-1");
        bytes32 contentHash = keccak256("content-v1");

        vm.prank(attestor1);
        registry.proposeAnchor(recordId, contentHash, emptyFindings());

        vm.prank(attestor2);
        registry.coSignAnchor(recordId, contentHash, emptyFindings());

        // Two of three confirmed - still pending, not yet anchored.
        AnchorRegistry.Anchor memory a = registry.getAnchor(recordId);
        assertEq(a.timestamp, 0);
        AnchorRegistry.PendingAnchor memory pending = registry.getPendingAnchor(recordId);
        assertEq(pending.proposedBy, attestor1);

        vm.prank(attestor3);
        registry.coSignAnchor(recordId, contentHash, emptyFindings());

        a = registry.getAnchor(recordId);
        assertEq(a.timestamp, block.timestamp);
        assertEq(a.contentHash, contentHash);
        pending = registry.getPendingAnchor(recordId);
        assertEq(pending.proposedBy, address(0));
    }

    function testMofNCoSignedByIsFinalConfirmerNotFirst() public {
        AnchorRegistry registry = _deploy(3);
        bytes32 recordId = keccak256("record-1");
        bytes32 contentHash = keccak256("content-v1");

        vm.prank(attestor1);
        registry.proposeAnchor(recordId, contentHash, emptyFindings());
        vm.prank(attestor2);
        registry.coSignAnchor(recordId, contentHash, emptyFindings());
        vm.prank(attestor3);
        registry.coSignAnchor(recordId, contentHash, emptyFindings());

        AnchorRegistry.Anchor memory a = registry.getAnchor(recordId);
        assertEq(a.proposedBy, attestor1);
        assertEq(a.coSignedBy, attestor3);
    }

    function testMofNGetConfirmersReturnsProposerFirstThenConfirmationOrder() public {
        AnchorRegistry registry = _deploy(3);
        bytes32 recordId = keccak256("record-1");
        bytes32 contentHash = keccak256("content-v1");

        vm.prank(attestor1);
        registry.proposeAnchor(recordId, contentHash, emptyFindings());

        address[] memory confirmers = registry.getConfirmers(recordId);
        assertEq(confirmers.length, 1);
        assertEq(confirmers[0], attestor1);

        vm.prank(attestor3);
        registry.coSignAnchor(recordId, contentHash, emptyFindings());

        confirmers = registry.getConfirmers(recordId);
        assertEq(confirmers.length, 2);
        assertEq(confirmers[0], attestor1);
        assertEq(confirmers[1], attestor3);
    }

    function testMofNGetConfirmersPersistsAfterFinalization() public {
        AnchorRegistry registry = _deploy(3);
        bytes32 recordId = keccak256("record-1");
        bytes32 contentHash = keccak256("content-v1");

        vm.prank(attestor1);
        registry.proposeAnchor(recordId, contentHash, emptyFindings());
        vm.prank(attestor2);
        registry.coSignAnchor(recordId, contentHash, emptyFindings());
        vm.prank(attestor3);
        registry.coSignAnchor(recordId, contentHash, emptyFindings());

        address[] memory confirmers = registry.getConfirmers(recordId);
        assertEq(confirmers.length, 3);
        assertEq(confirmers[0], attestor1);
        assertEq(confirmers[1], attestor2);
        assertEq(confirmers[2], attestor3);
    }

    function testMofNCannotConfirmTwice() public {
        AnchorRegistry registry = _deploy(3);
        bytes32 recordId = keccak256("record-1");
        bytes32 contentHash = keccak256("content-v1");

        vm.prank(attestor1);
        registry.proposeAnchor(recordId, contentHash, emptyFindings());

        vm.startPrank(attestor2);
        registry.coSignAnchor(recordId, contentHash, emptyFindings());

        vm.expectRevert("AnchorRegistry: already confirmed");
        registry.coSignAnchor(recordId, contentHash, emptyFindings());
        vm.stopPrank();
    }

    function testMofNProposerCannotConfirmOwnProposalEvenAfterOthersHaveConfirmed() public {
        AnchorRegistry registry = _deploy(3);
        bytes32 recordId = keccak256("record-1");
        bytes32 contentHash = keccak256("content-v1");

        vm.prank(attestor1);
        registry.proposeAnchor(recordId, contentHash, emptyFindings());
        vm.prank(attestor2);
        registry.coSignAnchor(recordId, contentHash, emptyFindings());

        vm.prank(attestor1);
        vm.expectRevert("AnchorRegistry: cannot co-sign your own proposal");
        registry.coSignAnchor(recordId, contentHash, emptyFindings());
    }

    /// @dev M=2 of N=3: the third attestor never acts at all, and the anchor still
    /// finalizes - proves the mechanism requires *some* M-sized subset, not a
    /// specific pair.
    function testMofNOnlySubsetOfAttestorsNeeded() public {
        AnchorRegistry registry = _deploy(2);
        bytes32 recordId = keccak256("record-1");
        bytes32 contentHash = keccak256("content-v1");

        vm.prank(attestor1);
        registry.proposeAnchor(recordId, contentHash, emptyFindings());
        vm.prank(attestor3);
        registry.coSignAnchor(recordId, contentHash, emptyFindings());

        AnchorRegistry.Anchor memory a = registry.getAnchor(recordId);
        assertEq(a.timestamp, block.timestamp);
        assertEq(a.coSignedBy, attestor3);
    }

    /// @dev Every distinct pairing among 3 attestors can finalize a 2-of-3 anchor -
    /// not just a hardcoded pair.
    function testMofNEveryPairingCanFinalize() public {
        address[3] memory attestors = [attestor1, attestor2, attestor3];

        for (uint256 i = 0; i < 3; i++) {
            for (uint256 j = 0; j < 3; j++) {
                if (i == j) continue;
                AnchorRegistry registry = _deploy(2);
                bytes32 recordId = keccak256(abi.encode("pairing", i, j));
                bytes32 contentHash = keccak256(abi.encode("content", i, j));

                vm.prank(attestors[i]);
                registry.proposeAnchor(recordId, contentHash, emptyFindings());
                vm.prank(attestors[j]);
                registry.coSignAnchor(recordId, contentHash, emptyFindings());

                (bool anchored, bool matches, ) = registry.verifyRecord(recordId, contentHash);
                assertTrue(anchored);
                assertTrue(matches);
            }
        }
    }

    function testMofNFloorBlocksRemovalAtExactlyRequiredConfirmations() public {
        AnchorRegistry registry = _deploy(3);
        assertEq(registry.attestorCount(), 3);

        vm.prank(owner);
        registry.proposeRemoveAttestor(attestor3);
        vm.prank(attestor1);

        vm.expectRevert("AnchorRegistry: would drop below minimum attestor count");
        registry.approveRemoveAttestor(attestor3);
    }

    function testMofNIntermediateConfirmationEmitsAnchorConfirmedNotFinalEvents() public {
        AnchorRegistry registry = _deploy(3);
        bytes32 recordId = keccak256("record-1");
        bytes32 contentHash = keccak256("content-v1");

        vm.prank(attestor1);
        registry.proposeAnchor(recordId, contentHash, emptyFindings());

        vm.recordLogs();
        vm.prank(attestor2);
        registry.coSignAnchor(recordId, contentHash, emptyFindings());

        Vm.Log[] memory entries = vm.getRecordedLogs();
        bool sawAnchorConfirmed = false;
        bool sawRecordAnchored = false;
        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].topics[0] == keccak256("AnchorConfirmed(bytes32,address,uint256)")) {
                sawAnchorConfirmed = true;
            }
            if (entries[i].topics[0] == keccak256("RecordAnchored(bytes32,bytes32,uint256,address)")) {
                sawRecordAnchored = true;
            }
        }
        assertTrue(sawAnchorConfirmed);
        assertFalse(sawRecordAnchored);
    }

    /// @dev Fuzz: for any 2-of-3 pairing of distinct attestor indices, propose +
    /// one confirmation always finalizes a matching anchor.
    function testFuzzMofNAnyPairFinalizes(bytes32 recordId, bytes32 contentHash, uint8 proposerIdx, uint8 confirmerIdx) public {
        vm.assume(contentHash != bytes32(0));
        address[3] memory attestors = [attestor1, attestor2, attestor3];
        uint256 pIdx = proposerIdx % 3;
        uint256 cIdx = confirmerIdx % 3;
        vm.assume(pIdx != cIdx);

        AnchorRegistry registry = _deploy(2);

        vm.prank(attestors[pIdx]);
        registry.proposeAnchor(recordId, contentHash, emptyFindings());
        vm.prank(attestors[cIdx]);
        registry.coSignAnchor(recordId, contentHash, emptyFindings());

        (bool anchored, bool matches, ) = registry.verifyRecord(recordId, contentHash);
        assertTrue(anchored);
        assertTrue(matches);
    }
}
