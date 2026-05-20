/**
 * #38: ReputationOracle contract tests.
 * Tests rating submission, average score calculation, trusted caller access, and history.
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ReputationOracle", function () {
  let oracle, owner, trusted, untrusted;

  beforeEach(async function () {
    [owner, trusted, untrusted] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("ReputationOracle");
    oracle = await Factory.deploy();
    await oracle.waitForDeployment();

    // Set trusted caller
    await oracle.setTrusted(trusted.address, true);
  });

  describe("Trusted Caller Management", function () {
    it("should allow owner to set trusted callers", async function () {
      expect(await oracle.trustedCallers(trusted.address)).to.equal(true);
    });

    it("should allow owner to revoke trusted status", async function () {
      await oracle.setTrusted(trusted.address, false);
      expect(await oracle.trustedCallers(trusted.address)).to.equal(false);
    });

    it("should reject non-owner setting trusted callers", async function () {
      await expect(
        oracle.connect(untrusted).setTrusted(untrusted.address, true)
      ).to.be.revertedWithCustomError(oracle, "OwnableUnauthorizedAccount");
    });
  });

  describe("Rating Submission", function () {
    it("should accept valid ratings from trusted callers", async function () {
      await expect(oracle.connect(trusted).submitRating(1, 450))
        .to.emit(oracle, "RatingSubmitted")
        .withArgs(1, 450, 450, trusted.address);
    });

    it("should reject ratings below 100", async function () {
      await expect(
        oracle.connect(trusted).submitRating(1, 50)
      ).to.be.revertedWith("Rating 1.00-5.00");
    });

    it("should reject ratings above 500", async function () {
      await expect(
        oracle.connect(trusted).submitRating(1, 501)
      ).to.be.revertedWith("Rating 1.00-5.00");
    });

    it("should reject submissions from untrusted callers", async function () {
      await expect(
        oracle.connect(untrusted).submitRating(1, 400)
      ).to.be.revertedWith("Not trusted");
    });

    it("should correctly update cumulative score and rating count", async function () {
      await oracle.connect(trusted).submitRating(1, 400);
      await oracle.connect(trusted).submitRating(1, 500);

      const record = await oracle.getReputationRecord(1);
      expect(record.agentId).to.equal(1);
      expect(record.cumulativeScore).to.equal(900);
      expect(record.ratingCount).to.equal(2);
    });

    it("should set lastUpdated timestamp", async function () {
      await oracle.connect(trusted).submitRating(1, 400);
      const record = await oracle.getReputationRecord(1);
      expect(record.lastUpdated).to.be.greaterThan(0);
    });
  });

  describe("Average Score Calculation", function () {
    it("should return default 400 for agents with no ratings", async function () {
      const avg = await oracle.getAverageScore(99);
      expect(avg).to.equal(400);
    });

    it("should correctly calculate average after single rating", async function () {
      await oracle.connect(trusted).submitRating(1, 450);
      const avg = await oracle.getAverageScore(1);
      expect(avg).to.equal(450);
    });

    it("should correctly calculate average after multiple ratings", async function () {
      await oracle.connect(trusted).submitRating(1, 400);
      await oracle.connect(trusted).submitRating(1, 500);
      await oracle.connect(trusted).submitRating(1, 300);
      const avg = await oracle.getAverageScore(1);
      expect(avg).to.equal(400); // (400+500+300)/3 = 400
    });
  });

  describe("Rating History", function () {
    it("should track rating history for an agent", async function () {
      await oracle.connect(trusted).submitRating(1, 400);
      await oracle.connect(trusted).submitRating(1, 450);
      await oracle.connect(trusted).submitRating(1, 350);

      const history = await oracle.getRatingHistory(1);
      expect(history.length).to.equal(3);
      expect(history[0]).to.equal(400);
      expect(history[1]).to.equal(450);
      expect(history[2]).to.equal(350);
    });

    it("should return empty array for agent with no ratings", async function () {
      const history = await oracle.getRatingHistory(99);
      expect(history.length).to.equal(0);
    });
  });

  describe("Multi-Agent Isolation", function () {
    it("should maintain separate records for different agents", async function () {
      await oracle.connect(trusted).submitRating(1, 500);
      await oracle.connect(trusted).submitRating(2, 200);

      expect(await oracle.getAverageScore(1)).to.equal(500);
      expect(await oracle.getAverageScore(2)).to.equal(200);
    });
  });
});
