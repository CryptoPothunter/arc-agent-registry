// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ReputationOracle
 * @notice 链上信誉评分计算与存储
 */
contract ReputationOracle is Ownable {

    // #11, #12: struct matches doc spec with cumulativeScore, agentId, lastUpdated
    struct ReputationRecord {
        uint256 agentId;
        uint256 cumulativeScore;  // 累计评分总和（×100）
        uint256 ratingCount;
        uint256 lastUpdated;      // #11: added lastUpdated
    }

    mapping(uint256 => ReputationRecord) public reputations;

    // 评分历史（用于前端展示趋势）
    mapping(uint256 => uint256[]) public ratingHistory;

    event RatingSubmitted(
        uint256 indexed agentId,
        uint256 rating,
        uint256 newAvgScore,
        address rater
    );

    mapping(address => bool) public trustedCallers;

    modifier onlyTrusted() {
        require(trustedCallers[msg.sender], "Not trusted");
        _;
    }

    constructor() Ownable(msg.sender) {}

    // #13: renamed from setTrustedCaller to setTrusted
    function setTrusted(address addr, bool v) external onlyOwner {
        trustedCallers[addr] = v;
    }

    /**
     * @notice 提交评分（只有 TaskEscrow 可以调用）
     * @param agentId Agent ID
     * @param rating 1-500 (代表 0.01 - 5.00 分)
     */
    function submitRating(uint256 agentId, uint256 rating) external onlyTrusted {
        require(rating >= 100 && rating <= 500, "Rating 1.00-5.00");

        ReputationRecord storage record = reputations[agentId];
        record.agentId = agentId;
        record.cumulativeScore += rating;
        record.ratingCount++;
        record.lastUpdated = block.timestamp;  // #11: set lastUpdated

        ratingHistory[agentId].push(rating);

        uint256 avgScore = record.cumulativeScore / record.ratingCount;
        emit RatingSubmitted(agentId, rating, avgScore, msg.sender);
    }

    function getAverageScore(uint256 agentId) external view returns (uint256) {
        ReputationRecord memory record = reputations[agentId];
        if (record.ratingCount == 0) return 400; // 默认 4.00
        return record.cumulativeScore / record.ratingCount;
    }

    function getRatingHistory(uint256 agentId) external view returns (uint256[] memory) {
        return ratingHistory[agentId];
    }

    function getReputationRecord(uint256 agentId) external view returns (ReputationRecord memory) {
        return reputations[agentId];
    }
}
