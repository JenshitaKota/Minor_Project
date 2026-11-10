// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AnchorRegistry} from "../contracts/AnchorRegistry.sol";

/// @dev Covers cancelAnchorProposal - recovering a recordId whose pending proposal
/// will never gather its confirmations.
contract AnchorRegistryCancelTest is Test {
    address public owner = address(0xA11CE);
    address public attestor1 = address(0xA771);
    address public attestor2 = address(0xA772);
    address public attestor3 = address(0xA773);
    address public stranger = address(0xBEEF);

    bytes32 public recordId = keccak256("record-1");
    bytes32 public staleHash = keccak256("content-stale");
    bytes32 public freshHash = keccak256("content-fresh");

    function emptyFindings() internal pure returns (bytes32[] memory) {
        return new bytes32[](0);
    }

    function _deploy(uint256 requiredConfirmations) internal returns (AnchorRegistry) {
        address[] memory attestors = new address[](3);
        attestors[0] = attestor1;
        attestors[1] = attestor2;
        attestors[2] = attestor3;
        return new AnchorRegistry(owner, attestors, requiredConfirmations);
    }

    function _proposeStale(AnchorRegistry registry) internal {
        vm.prank(attestor1);
        registry.proposeAnchor(recordId, staleHash, emptyFindings());
    }

    function testProposerCanWithdrawAndReproposeCorrectedPackage() public {
        AnchorRegistry registry = _deploy(2);
        _proposeStale(registry);

        vm.prank(attestor1);
        registry.cancelAnchorProposal(recordId);
        assertEq(registry.getPendingAnchor(recordId).proposedAt, 0);
        assertEq(registry.getConfirmers(recordId).length, 0);

        vm.prank(attestor1);
        registry.proposeAnchor(recordId, freshHash, emptyFindings());
        vm.prank(attestor2);
        registry.coSignAnchor(recordId, freshHash, emptyFindings());

        (bool anchored, bool matches,) = registry.verifyRecord(recordId, freshHash);
        assertTrue(anchored);
        assertTrue(matches);
    }

    function testCancelEmitsFullWithdrawnPackage() public {
        AnchorRegistry registry = _deploy(2);
        bytes32[] memory findings = new bytes32[](2);
        findings[0] = keccak256("finding-fast-approval");
        findings[1] = keccak256("finding-off-hours");
        vm.prank(attestor1);
        registry.proposeAnchor(recordId, staleHash, findings);

        // Checks every topic and the data - the withdrawn findings must be recoverable
        // from the log, or cancelling could silently suppress them.
        vm.expectEmit(true, true, true, true);
        emit AnchorRegistry.AnchorProposalCancelled(recordId, attestor1, staleHash, findings);
        vm.prank(attestor1);
        registry.cancelAnchorProposal(recordId);
    }

    function testCoSignAfterCancelReverts() public {
        AnchorRegistry registry = _deploy(2);
        _proposeStale(registry);
        vm.prank(attestor1);
        registry.cancelAnchorProposal(recordId);

        vm.prank(attestor2);
        vm.expectRevert("AnchorRegistry: no pending proposal");
        registry.coSignAnchor(recordId, staleHash, emptyFindings());
    }

    function testOtherAttestorCannotCancelBeforeExpiry() public {
        AnchorRegistry registry = _deploy(2);
        _proposeStale(registry);

        vm.warp(block.timestamp + registry.PROPOSAL_EXPIRY() - 1);
        vm.prank(attestor2);
        vm.expectRevert("AnchorRegistry: proposal not expired");
        registry.cancelAnchorProposal(recordId);
    }

    function testOtherAttestorCanCancelAfterExpiry() public {
        AnchorRegistry registry = _deploy(2);
        _proposeStale(registry);

        vm.warp(block.timestamp + registry.PROPOSAL_EXPIRY());
        vm.prank(attestor2);
        registry.cancelAnchorProposal(recordId);
        assertEq(registry.getPendingAnchor(recordId).proposedAt, 0);
    }

    function testNonAttestorCannotCancel() public {
        AnchorRegistry registry = _deploy(2);
        _proposeStale(registry);
        vm.warp(block.timestamp + registry.PROPOSAL_EXPIRY());

        vm.prank(stranger);
        vm.expectRevert("AnchorRegistry: not an attestor");
        registry.cancelAnchorProposal(recordId);

        vm.prank(owner);
        vm.expectRevert("AnchorRegistry: not an attestor");
        registry.cancelAnchorProposal(recordId);
    }

    function testCannotCancelWithNothingPending() public {
        AnchorRegistry registry = _deploy(2);
        vm.prank(attestor1);
        vm.expectRevert("AnchorRegistry: no pending proposal");
        registry.cancelAnchorProposal(recordId);
    }

    function testCannotCancelFinalizedAnchor() public {
        AnchorRegistry registry = _deploy(2);
        _proposeStale(registry);
        vm.prank(attestor2);
        registry.coSignAnchor(recordId, staleHash, emptyFindings());

        vm.prank(attestor1);
        vm.expectRevert("AnchorRegistry: no pending proposal");
        registry.cancelAnchorProposal(recordId);

        (bool anchored, bool matches,) = registry.verifyRecord(recordId, staleHash);
        assertTrue(anchored);
        assertTrue(matches);
    }

    /// At M=3 a partial confirmation exists when the proposal is cancelled - the
    /// replacement must start from zero, and the earlier confirmer must be free to
    /// confirm the new package rather than be rejected as "already confirmed".
    function testCancelClearsPartialConfirmationsAtMofN() public {
        AnchorRegistry registry = _deploy(3);
        _proposeStale(registry);
        vm.prank(attestor2);
        registry.coSignAnchor(recordId, staleHash, emptyFindings());
        assertEq(registry.getConfirmers(recordId).length, 2);

        vm.prank(attestor1);
        registry.cancelAnchorProposal(recordId);
        assertEq(registry.getConfirmers(recordId).length, 0);

        vm.prank(attestor1);
        registry.proposeAnchor(recordId, freshHash, emptyFindings());
        vm.prank(attestor2);
        registry.coSignAnchor(recordId, freshHash, emptyFindings());
        vm.prank(attestor3);
        registry.coSignAnchor(recordId, freshHash, emptyFindings());

        address[] memory confirmers = registry.getConfirmers(recordId);
        assertEq(confirmers.length, 3);
        assertEq(confirmers[0], attestor1);
        assertEq(confirmers[1], attestor2);
        assertEq(confirmers[2], attestor3);
        (bool anchored, bool matches,) = registry.verifyRecord(recordId, freshHash);
        assertTrue(anchored);
        assertTrue(matches);
    }
}
