// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

contract ReputationOracle is Ownable {
    struct ReputationRecord {
        uint256 totalScore;
        uint256 ratingCount;
        uint256 averageScore;
    }

    // agentId => ReputationRecord
    mapping(uint256 => ReputationRecord) public reputations;
    // agentId => rating[]
    mapping(uint256 => uint256[]) public ratingHistory;
    // trusted callers
    mapping(address => bool) public trustedCallers;

    event RatingSubmitted(uint256 indexed agentId, uint256 rating, uint256 newAverage);

    modifier onlyTrusted() {
        require(trustedCallers[msg.sender], "ReputationOracle: caller is not trusted");
        _;
    }

    constructor() Ownable(msg.sender) {}

    function setTrustedCaller(address _caller, bool _trusted) external onlyOwner {
        trustedCallers[_caller] = _trusted;
    }

    function submitRating(uint256 agentId, uint256 rating) external onlyTrusted {
        require(rating >= 100 && rating <= 500, "ReputationOracle: rating out of range (100-500)");

        ReputationRecord storage record = reputations[agentId];
        record.totalScore += rating;
        record.ratingCount += 1;
        record.averageScore = record.totalScore / record.ratingCount;

        ratingHistory[agentId].push(rating);

        emit RatingSubmitted(agentId, rating, record.averageScore);
    }

    function getAverageScore(uint256 agentId) external view returns (uint256) {
        ReputationRecord storage record = reputations[agentId];
        if (record.ratingCount == 0) {
            return 400; // default score
        }
        return record.averageScore;
    }

    function getRatingHistory(uint256 agentId) external view returns (uint256[] memory) {
        return ratingHistory[agentId];
    }

    function getReputationRecord(uint256 agentId) external view returns (ReputationRecord memory) {
        return reputations[agentId];
    }
}
