const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("AgentFund", function () {
  let fund, mockUsdc, agentRegistry;
  let owner, agentOwner, investor1, investor2, escrow;

  const capabilityHashes = [
    ethers.keccak256(ethers.toUtf8Bytes("text-generation")),
  ];
  const basePriceUsdc = 1000000n;
  const metadataCID = "QmTestCID";

  async function registerEligibleAgent() {
    // Register agent with enough reputation and tasks
    await agentRegistry.connect(agentOwner).register(
      agentOwner.address, metadataCID, capabilityHashes, basePriceUsdc, true
    );
    // Set trusted contract and boost reputation/tasks to meet thresholds
    await agentRegistry.connect(owner).setTrustedContract(owner.address, true);
    // reputation >= 420, totalTasks >= 20
    await agentRegistry.connect(owner).updateReputation(1, 450, false);
    for (let i = 0; i < 20; i++) {
      await agentRegistry.connect(owner).updateReputation(1, 450, true);
    }
  }

  beforeEach(async function () {
    [owner, agentOwner, investor1, investor2, escrow] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    mockUsdc = await MockUSDC.deploy();
    await mockUsdc.waitForDeployment();

    const AgentRegistry = await ethers.getContractFactory("AgentRegistry");
    agentRegistry = await AgentRegistry.deploy();
    await agentRegistry.waitForDeployment();

    const Fund = await ethers.getContractFactory("AgentFund");
    fund = await Fund.deploy(
      await mockUsdc.getAddress(),
      await agentRegistry.getAddress()
    );
    await fund.waitForDeployment();

    await fund.connect(owner).setEscrow(escrow.address);

    // Mint USDC to investors
    const mintAmount = 100000000n; // 100 USDC
    await mockUsdc.mint(investor1.address, mintAmount);
    await mockUsdc.mint(investor2.address, mintAmount);
    await mockUsdc.connect(investor1).approve(await fund.getAddress(), mintAmount);
    await mockUsdc.connect(investor2).approve(await fund.getAddress(), mintAmount);

    // Mint USDC to escrow for dividend distribution
    await mockUsdc.mint(escrow.address, 100000000n);
    await mockUsdc.connect(escrow).approve(await fund.getAddress(), 100000000n);

    await registerEligibleAgent();
  });

  // --- createFund ---
  describe("createFund", function () {
    it("should create a fund for an eligible agent", async function () {
      const tx = await fund.connect(agentOwner).createFund(1, 50000000n, 2000, 30);
      await expect(tx).to.emit(fund, "FundCreated").withArgs(1, 1, 50000000n, 2000);

      const f = await fund.getFund(1);
      expect(f.fundId).to.equal(1);
      expect(f.agentId).to.equal(1);
      expect(f.targetAmount).to.equal(50000000n);
      expect(f.investorShareBps).to.equal(2000);
      expect(f.raisedAmount).to.equal(0);
      expect(f.active).to.equal(true);
      expect(f.funded).to.equal(false);
    });

    it("should set correct deadline", async function () {
      await fund.connect(agentOwner).createFund(1, 50000000n, 2000, 30);
      const f = await fund.getFund(1);
      const expectedDeadline = f.createdAt + 30n * 24n * 60n * 60n;
      expect(f.deadline).to.equal(expectedDeadline);
    });

    it("should reject if caller is not agent owner", async function () {
      await expect(fund.connect(investor1).createFund(1, 50000000n, 2000, 30))
        .to.be.revertedWith("Not agent owner");
    });

    it("should reject if reputation is too low", async function () {
      // Register a new agent with low reputation
      await agentRegistry.connect(investor1).register(
        investor1.address, metadataCID, capabilityHashes, basePriceUsdc, true
      );
      // Default reputation is 400, need 420
      // Give enough tasks but low reputation
      await agentRegistry.connect(owner).updateReputation(2, 300, false);
      for (let i = 0; i < 20; i++) {
        await agentRegistry.connect(owner).updateReputation(2, 300, true);
      }
      await expect(fund.connect(investor1).createFund(2, 50000000n, 2000, 30))
        .to.be.revertedWith("Reputation too low (min 4.20)");
    });

    it("should reject if too few completed tasks", async function () {
      await agentRegistry.connect(investor1).register(
        investor1.address, metadataCID, capabilityHashes, basePriceUsdc, true
      );
      // High reputation but no tasks
      await agentRegistry.connect(owner).updateReputation(2, 450, false);
      await expect(fund.connect(investor1).createFund(2, 50000000n, 2000, 30))
        .to.be.revertedWith("Too few completed tasks (min 20)");
    });

    it("should reject duplicate fund for same agent", async function () {
      await fund.connect(agentOwner).createFund(1, 50000000n, 2000, 30);
      await expect(fund.connect(agentOwner).createFund(1, 50000000n, 2000, 30))
        .to.be.revertedWith("Already has active fund");
    });

    it("should reject investorShareBps of 0", async function () {
      await expect(fund.connect(agentOwner).createFund(1, 50000000n, 0, 30))
        .to.be.revertedWith("Share 0.01%-50%");
    });

    it("should reject investorShareBps above 5000", async function () {
      await expect(fund.connect(agentOwner).createFund(1, 50000000n, 5001, 30))
        .to.be.revertedWith("Share 0.01%-50%");
    });

    it("should accept investorShareBps boundary values", async function () {
      await fund.connect(agentOwner).createFund(1, 50000000n, 1, 30);
      const f = await fund.getFund(1);
      expect(f.investorShareBps).to.equal(1);
    });

    it("should reject zero target amount", async function () {
      await expect(fund.connect(agentOwner).createFund(1, 0, 2000, 30))
        .to.be.revertedWith("Target must be > 0");
    });

    it("should reject zero duration", async function () {
      await expect(fund.connect(agentOwner).createFund(1, 50000000n, 2000, 0))
        .to.be.revertedWith("Duration 1-365 days");
    });

    it("should reject duration above 365", async function () {
      await expect(fund.connect(agentOwner).createFund(1, 50000000n, 2000, 366))
        .to.be.revertedWith("Duration 1-365 days");
    });
  });

  // --- invest ---
  describe("invest", function () {
    beforeEach(async function () {
      await fund.connect(agentOwner).createFund(1, 10000000n, 2000, 30);
    });

    it("should accept an investment", async function () {
      const tx = await fund.connect(investor1).invest(1, 5000000n);
      await expect(tx).to.emit(fund, "Invested").withArgs(1, investor1.address, 5000000n);

      const f = await fund.getFund(1);
      expect(f.raisedAmount).to.equal(5000000n);

      const inv = await fund.getInvestment(1, investor1.address);
      expect(inv).to.equal(5000000n);
    });

    it("should track investor count", async function () {
      await fund.connect(investor1).invest(1, 3000000n);
      await fund.connect(investor2).invest(1, 2000000n);
      expect(await fund.getInvestorCount(1)).to.equal(2);
    });

    it("should not double-count investor on additional investment", async function () {
      await fund.connect(investor1).invest(1, 2000000n);
      await fund.connect(investor1).invest(1, 3000000n);
      expect(await fund.getInvestorCount(1)).to.equal(1);
      expect(await fund.getInvestment(1, investor1.address)).to.equal(5000000n);
    });

    it("should release funds to agent owner when target reached", async function () {
      const balBefore = await mockUsdc.balanceOf(agentOwner.address);
      const tx = await fund.connect(investor1).invest(1, 10000000n);
      await expect(tx).to.emit(fund, "FundFullyRaised").withArgs(1, 10000000n);

      const balAfter = await mockUsdc.balanceOf(agentOwner.address);
      expect(balAfter - balBefore).to.equal(10000000n);

      const f = await fund.getFund(1);
      expect(f.funded).to.equal(true);
    });

    it("should reject investment on inactive fund", async function () {
      await fund.connect(agentOwner).deactivateFund(1);
      await expect(fund.connect(investor1).invest(1, 1000000n))
        .to.be.revertedWith("Fund not active");
    });

    it("should reject investment after deadline", async function () {
      await time.increase(31 * 24 * 60 * 60);
      await expect(fund.connect(investor1).invest(1, 1000000n))
        .to.be.revertedWith("Fundraising ended");
    });

    it("should reject investment exceeding target", async function () {
      await expect(fund.connect(investor1).invest(1, 10000001n))
        .to.be.revertedWith("Exceeds target");
    });

    it("should reject zero investment", async function () {
      await expect(fund.connect(investor1).invest(1, 0))
        .to.be.revertedWith("Amount must be > 0");
    });

    it("should transfer USDC from investor to contract", async function () {
      const balBefore = await mockUsdc.balanceOf(investor1.address);
      await fund.connect(investor1).invest(1, 5000000n);
      const balAfter = await mockUsdc.balanceOf(investor1.address);
      expect(balBefore - balAfter).to.equal(5000000n);
    });
  });

  // --- distributeDividend ---
  describe("distributeDividend", function () {
    beforeEach(async function () {
      // Create and fully fund a fund
      await fund.connect(agentOwner).createFund(1, 10000000n, 2000, 30);
      await fund.connect(investor1).invest(1, 6000000n);
      await fund.connect(investor2).invest(1, 4000000n);
    });

    it("should distribute dividends proportionally", async function () {
      const taskRevenue = 5000000n; // 5 USDC
      // investorShareBps = 2000 (20%), so investorTotal = 1000000

      const bal1Before = await mockUsdc.balanceOf(investor1.address);
      const bal2Before = await mockUsdc.balanceOf(investor2.address);

      const tx = await fund.connect(escrow).distributeDividend(1, taskRevenue);
      await expect(tx).to.emit(fund, "DividendDistributed").withArgs(1, 1000000n, 2);

      const bal1After = await mockUsdc.balanceOf(investor1.address);
      const bal2After = await mockUsdc.balanceOf(investor2.address);

      // investor1: 6/10 of 1M = 600000
      // investor2: 4/10 of 1M = 400000
      expect(bal1After - bal1Before).to.equal(600000n);
      expect(bal2After - bal2Before).to.equal(400000n);
    });

    it("should track totalDividendsDistributed", async function () {
      await fund.connect(escrow).distributeDividend(1, 5000000n);
      const f = await fund.getFund(1);
      expect(f.totalDividendsDistributed).to.equal(1000000n);
    });

    it("should reject from non-escrow", async function () {
      await expect(fund.connect(investor1).distributeDividend(1, 5000000n))
        .to.be.revertedWith("Not escrow");
    });

    it("should silently return if no fund for agent", async function () {
      // agent 999 has no fund - should not revert
      await fund.connect(escrow).distributeDividend(999, 5000000n);
    });

    it("should silently return if fund is not funded yet", async function () {
      // Create a new agent with a fund that isn't fully raised
      await agentRegistry.connect(investor1).register(
        investor1.address, metadataCID, capabilityHashes, basePriceUsdc, true
      );
      await agentRegistry.connect(owner).updateReputation(2, 450, false);
      for (let i = 0; i < 20; i++) {
        await agentRegistry.connect(owner).updateReputation(2, 450, true);
      }
      await fund.connect(investor1).createFund(2, 50000000n, 2000, 30);
      // Fund 2 is not fully raised, so distributeDividend should do nothing
      await fund.connect(escrow).distributeDividend(2, 5000000n);
    });

    it("should silently return for zero revenue", async function () {
      await fund.connect(escrow).distributeDividend(1, 0);
    });
  });

  // --- refundExpiredFund ---
  describe("refundExpiredFund", function () {
    beforeEach(async function () {
      await fund.connect(agentOwner).createFund(1, 10000000n, 2000, 30);
      await fund.connect(investor1).invest(1, 3000000n);
      await fund.connect(investor2).invest(1, 2000000n);
    });

    it("should refund all investors after deadline", async function () {
      await time.increase(31 * 24 * 60 * 60);

      const bal1Before = await mockUsdc.balanceOf(investor1.address);
      const bal2Before = await mockUsdc.balanceOf(investor2.address);

      await fund.refundExpiredFund(1);

      const bal1After = await mockUsdc.balanceOf(investor1.address);
      const bal2After = await mockUsdc.balanceOf(investor2.address);

      expect(bal1After - bal1Before).to.equal(3000000n);
      expect(bal2After - bal2Before).to.equal(2000000n);
    });

    it("should deactivate fund and clear agentFundId", async function () {
      await time.increase(31 * 24 * 60 * 60);
      await fund.refundExpiredFund(1);

      const f = await fund.getFund(1);
      expect(f.active).to.equal(false);

      // Agent can create a new fund now
      await expect(fund.connect(agentOwner).createFund(1, 10000000n, 2000, 30))
        .to.not.be.reverted;
    });

    it("should reject refund before deadline", async function () {
      await expect(fund.refundExpiredFund(1))
        .to.be.revertedWith("Not expired yet");
    });

    it("should reject refund if fund is not active", async function () {
      await fund.connect(agentOwner).deactivateFund(1);
      await time.increase(31 * 24 * 60 * 60);
      await expect(fund.refundExpiredFund(1))
        .to.be.revertedWith("Fund not active");
    });

    it("should reject refund if already funded", async function () {
      // Fully fund it first
      await fund.connect(investor1).invest(1, 5000000n);
      await time.increase(31 * 24 * 60 * 60);
      await expect(fund.refundExpiredFund(1))
        .to.be.revertedWith("Already funded");
    });
  });

  // --- View functions ---
  describe("View functions", function () {
    beforeEach(async function () {
      await fund.connect(agentOwner).createFund(1, 10000000n, 2000, 30);
    });

    it("getFundByAgent should return fund for agent", async function () {
      const f = await fund.getFundByAgent(1);
      expect(f.fundId).to.equal(1);
    });

    it("getFundByAgent should revert for agent without fund", async function () {
      await expect(fund.getFundByAgent(999)).to.be.revertedWith("No fund for agent");
    });

    it("getInvestorShare should return share in bps", async function () {
      await fund.connect(investor1).invest(1, 6000000n);
      await fund.connect(investor2).invest(1, 4000000n);

      const share1 = await fund.getInvestorShare(1, investor1.address);
      const share2 = await fund.getInvestorShare(1, investor2.address);
      expect(share1).to.equal(6000);
      expect(share2).to.equal(4000);
    });

    it("getInvestorShare should return 0 when no raised amount", async function () {
      const share = await fund.getInvestorShare(1, investor1.address);
      expect(share).to.equal(0);
    });
  });

  // --- deactivateFund ---
  describe("deactivateFund", function () {
    beforeEach(async function () {
      await fund.connect(agentOwner).createFund(1, 10000000n, 2000, 30);
    });

    it("should allow agent owner to deactivate", async function () {
      const tx = await fund.connect(agentOwner).deactivateFund(1);
      await expect(tx).to.emit(fund, "FundDeactivated").withArgs(1);

      const f = await fund.getFund(1);
      expect(f.active).to.equal(false);
    });

    it("should allow contract owner to deactivate", async function () {
      await fund.connect(owner).deactivateFund(1);
      const f = await fund.getFund(1);
      expect(f.active).to.equal(false);
    });

    it("should reject deactivation from unauthorized address", async function () {
      await expect(fund.connect(investor1).deactivateFund(1))
        .to.be.revertedWith("Not authorized");
    });
  });

  // --- Admin ---
  describe("Admin", function () {
    it("should allow owner to set escrow", async function () {
      await fund.connect(owner).setEscrow(investor1.address);
      expect(await fund.escrowContract()).to.equal(investor1.address);
    });

    it("should reject setEscrow from non-owner", async function () {
      await expect(fund.connect(investor1).setEscrow(investor1.address))
        .to.be.revertedWith("Not owner");
    });
  });
});
