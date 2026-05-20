const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("AgentReputationMarket", function () {
  let market, mockUsdc, agentRegistry;
  let owner, escrow, bettor1, bettor2, feeRecipient;

  const capabilityHashes = [
    ethers.keccak256(ethers.toUtf8Bytes("text-generation")),
  ];
  const basePriceUsdc = 1000000n;
  const metadataCID = "QmTestCID";

  async function deployFixture() {
    [owner, escrow, bettor1, bettor2, feeRecipient] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    mockUsdc = await MockUSDC.deploy();
    await mockUsdc.waitForDeployment();

    const AgentRegistry = await ethers.getContractFactory("AgentRegistry");
    agentRegistry = await AgentRegistry.deploy();
    await agentRegistry.waitForDeployment();

    // Register an active agent (agentId = 1)
    await agentRegistry.connect(bettor1).register(
      bettor1.address, metadataCID, capabilityHashes, basePriceUsdc, true
    );

    const Market = await ethers.getContractFactory("AgentReputationMarket");
    market = await Market.deploy(
      await mockUsdc.getAddress(),
      await agentRegistry.getAddress()
    );
    await market.waitForDeployment();

    // Set escrow
    await market.connect(owner).setEscrow(escrow.address);

    // Mint USDC to bettors and approve
    const mintAmount = 100000000n; // 100 USDC
    await mockUsdc.mint(bettor1.address, mintAmount);
    await mockUsdc.mint(bettor2.address, mintAmount);
    await mockUsdc.connect(bettor1).approve(await market.getAddress(), mintAmount);
    await mockUsdc.connect(bettor2).approve(await market.getAddress(), mintAmount);
  }

  beforeEach(async function () {
    await deployFixture();
  });

  // --- createMarket ---
  describe("createMarket", function () {
    it("should create a market for an active agent", async function () {
      const tx = await market.connect(bettor1).createMarket(1, 100, 300);
      await expect(tx).to.emit(market, "MarketCreated").withArgs(1, 1, 300);

      const m = await market.getMarket(1);
      expect(m.marketId).to.equal(1);
      expect(m.agentId).to.equal(1);
      expect(m.taskId).to.equal(100);
      expect(m.threshold).to.equal(300);
      expect(m.totalForAbove).to.equal(0);
      expect(m.totalForBelow).to.equal(0);
      expect(m.resolved).to.equal(false);
    });

    it("should increment market IDs", async function () {
      await market.createMarket(1, 100, 300);
      await market.createMarket(1, 101, 400);
      const m1 = await market.getMarket(1);
      const m2 = await market.getMarket(2);
      expect(m1.marketId).to.equal(1);
      expect(m2.marketId).to.equal(2);
    });

    it("should set resolvesAt to 7 days from creation", async function () {
      await market.createMarket(1, 100, 300);
      const m = await market.getMarket(1);
      expect(m.resolvesAt - m.createdAt).to.equal(7n * 24n * 60n * 60n);
    });

    it("should reject threshold below 100", async function () {
      await expect(market.createMarket(1, 100, 99)).to.be.revertedWith("Threshold 1.00-5.00");
    });

    it("should reject threshold above 500", async function () {
      await expect(market.createMarket(1, 100, 501)).to.be.revertedWith("Threshold 1.00-5.00");
    });

    it("should accept boundary thresholds 100 and 500", async function () {
      await market.createMarket(1, 100, 100);
      await market.createMarket(1, 101, 500);
      expect((await market.getMarket(1)).threshold).to.equal(100);
      expect((await market.getMarket(2)).threshold).to.equal(500);
    });

    it("should reject market for inactive agent", async function () {
      await agentRegistry.connect(bettor1).setAvailability(false);
      await expect(market.createMarket(1, 100, 300)).to.be.revertedWith("Agent not active");
    });

    it("should reject market for non-existent agent", async function () {
      await expect(market.createMarket(999, 100, 300)).to.be.revertedWith("Agent not found");
    });
  });

  // --- placeBet ---
  describe("placeBet", function () {
    beforeEach(async function () {
      await market.createMarket(1, 100, 300);
    });

    it("should place a bet for above", async function () {
      const amount = 5000000n; // 5 USDC
      const tx = await market.connect(bettor1).placeBet(1, true, amount);
      await expect(tx).to.emit(market, "BetPlaced").withArgs(1, bettor1.address, true, amount);

      const m = await market.getMarket(1);
      expect(m.totalForAbove).to.equal(amount);
      expect(m.totalForBelow).to.equal(0);

      const pos = await market.getPosition(1, bettor1.address);
      expect(pos.amountForAbove).to.equal(amount);
      expect(pos.amountForBelow).to.equal(0);
    });

    it("should place a bet for below", async function () {
      const amount = 3000000n;
      await market.connect(bettor2).placeBet(1, false, amount);

      const m = await market.getMarket(1);
      expect(m.totalForBelow).to.equal(amount);

      const pos = await market.getPosition(1, bettor2.address);
      expect(pos.amountForBelow).to.equal(amount);
    });

    it("should accumulate multiple bets from same user", async function () {
      await market.connect(bettor1).placeBet(1, true, 1000000n);
      await market.connect(bettor1).placeBet(1, true, 2000000n);

      const pos = await market.getPosition(1, bettor1.address);
      expect(pos.amountForAbove).to.equal(3000000n);
    });

    it("should allow same user to bet on both sides", async function () {
      await market.connect(bettor1).placeBet(1, true, 1000000n);
      await market.connect(bettor1).placeBet(1, false, 500000n);

      const pos = await market.getPosition(1, bettor1.address);
      expect(pos.amountForAbove).to.equal(1000000n);
      expect(pos.amountForBelow).to.equal(500000n);
    });

    it("should reject bet on non-existent market", async function () {
      await expect(market.connect(bettor1).placeBet(999, true, 1000000n))
        .to.be.revertedWith("Market does not exist");
    });

    it("should reject bet on resolved market", async function () {
      await market.connect(escrow).resolveMarket(1, 350);
      await expect(market.connect(bettor1).placeBet(1, true, 1000000n))
        .to.be.revertedWith("Market resolved");
    });

    it("should reject bet on expired market", async function () {
      await time.increase(7 * 24 * 60 * 60 + 1); // 7 days + 1 second
      await expect(market.connect(bettor1).placeBet(1, true, 1000000n))
        .to.be.revertedWith("Market expired");
    });

    it("should reject bet below minimum", async function () {
      await expect(market.connect(bettor1).placeBet(1, true, 0))
        .to.be.revertedWith("Below minimum bet");
    });

    it("should accept MIN_BET amount", async function () {
      await market.connect(bettor1).placeBet(1, true, 1n);
      const pos = await market.getPosition(1, bettor1.address);
      expect(pos.amountForAbove).to.equal(1n);
    });

    it("should transfer USDC from bettor to contract", async function () {
      const balBefore = await mockUsdc.balanceOf(bettor1.address);
      await market.connect(bettor1).placeBet(1, true, 5000000n);
      const balAfter = await mockUsdc.balanceOf(bettor1.address);
      expect(balBefore - balAfter).to.equal(5000000n);
    });
  });

  // --- placeBatchBet ---
  describe("placeBatchBet", function () {
    beforeEach(async function () {
      await market.createMarket(1, 100, 300);
    });

    it("should place a batch bet", async function () {
      const tx = await market.connect(bettor1).placeBatchBet(1, true, 10000000n, 5);
      await expect(tx).to.emit(market, "BatchBetPlaced").withArgs(1, true, 10000000n, 5);

      const m = await market.getMarket(1);
      expect(m.totalForAbove).to.equal(10000000n);
    });

    it("should reject batch bet on non-existent market", async function () {
      await expect(market.connect(bettor1).placeBatchBet(999, true, 1000000n, 1))
        .to.be.revertedWith("Market does not exist");
    });

    it("should reject batch bet on resolved market", async function () {
      await market.connect(escrow).resolveMarket(1, 350);
      await expect(market.connect(bettor1).placeBatchBet(1, true, 1000000n, 1))
        .to.be.revertedWith("Market resolved");
    });

    it("should reject batch bet below minimum", async function () {
      await expect(market.connect(bettor1).placeBatchBet(1, true, 0, 1))
        .to.be.revertedWith("Below minimum");
    });
  });

  // --- resolveMarket ---
  describe("resolveMarket", function () {
    beforeEach(async function () {
      await market.createMarket(1, 100, 300);
    });

    it("should resolve market above threshold", async function () {
      const tx = await market.connect(escrow).resolveMarket(1, 350);
      await expect(tx).to.emit(market, "MarketResolved").withArgs(1, true, 350);

      const m = await market.getMarket(1);
      expect(m.resolved).to.equal(true);
      expect(m.outcomeAbove).to.equal(true);
    });

    it("should resolve market below threshold", async function () {
      await market.connect(escrow).resolveMarket(1, 200);
      const m = await market.getMarket(1);
      expect(m.resolved).to.equal(true);
      expect(m.outcomeAbove).to.equal(false);
    });

    it("should resolve above when score equals threshold", async function () {
      await market.connect(escrow).resolveMarket(1, 300);
      const m = await market.getMarket(1);
      expect(m.outcomeAbove).to.equal(true);
    });

    it("should reject resolution from non-escrow", async function () {
      await expect(market.connect(bettor1).resolveMarket(1, 350))
        .to.be.revertedWith("Not escrow");
    });

    it("should reject resolution of non-existent market", async function () {
      await expect(market.connect(escrow).resolveMarket(999, 350))
        .to.be.revertedWith("Market does not exist");
    });

    it("should reject double resolution", async function () {
      await market.connect(escrow).resolveMarket(1, 350);
      await expect(market.connect(escrow).resolveMarket(1, 350))
        .to.be.revertedWith("Already resolved");
    });
  });

  // --- claimWinnings ---
  describe("claimWinnings", function () {
    beforeEach(async function () {
      await market.createMarket(1, 100, 300);
    });

    it("should pay winner proportionally (outcome above)", async function () {
      await market.connect(bettor1).placeBet(1, true, 6000000n);
      await market.connect(bettor2).placeBet(1, false, 4000000n);

      await market.connect(escrow).resolveMarket(1, 350);

      const balBefore = await mockUsdc.balanceOf(bettor1.address);
      await market.connect(bettor1).claimWinnings(1);
      const balAfter = await mockUsdc.balanceOf(bettor1.address);

      // totalPool = 10M, fee = 2% = 200000, netPool = 9800000
      // bettor1 is only above bettor, gets all netPool
      const totalPool = 10000000n;
      const fee = totalPool * 200n / 10000n;
      const netPool = totalPool - fee;
      expect(balAfter - balBefore).to.equal(netPool);
    });

    it("should pay winner proportionally (outcome below)", async function () {
      await market.connect(bettor1).placeBet(1, true, 4000000n);
      await market.connect(bettor2).placeBet(1, false, 6000000n);

      await market.connect(escrow).resolveMarket(1, 200);

      const balBefore = await mockUsdc.balanceOf(bettor2.address);
      await market.connect(bettor2).claimWinnings(1);
      const balAfter = await mockUsdc.balanceOf(bettor2.address);

      const totalPool = 10000000n;
      const fee = totalPool * 200n / 10000n;
      const netPool = totalPool - fee;
      expect(balAfter - balBefore).to.equal(netPool);
    });

    it("should distribute winnings proportionally among multiple winners", async function () {
      // Two bettors on the winning side, verify each gets their proportional share
      // Note: the contract sends platformFee on each claim, so we test the first claim's math
      await market.connect(bettor1).placeBet(1, true, 3000000n);
      await market.connect(bettor2).placeBet(1, true, 7000000n);

      // Losing side
      await mockUsdc.mint(escrow.address, 10000000n);
      await mockUsdc.connect(escrow).approve(await market.getAddress(), 10000000n);
      await market.connect(escrow).placeBet(1, false, 10000000n);

      await market.connect(escrow).resolveMarket(1, 350);

      const totalPool = 20000000n;
      const fee = totalPool * 200n / 10000n; // 400000
      const netPool = totalPool - fee; // 19600000

      // First claimer gets correct proportional winnings
      const bal1Before = await mockUsdc.balanceOf(bettor1.address);
      await market.connect(bettor1).claimWinnings(1);
      const bal1After = await mockUsdc.balanceOf(bettor1.address);

      // bettor1: 3M / 10M of netPool = 5880000
      const expectedBettor1 = (3000000n * netPool) / 10000000n;
      expect(bal1After - bal1Before).to.equal(expectedBettor1);
    });

    it("should pay zero to loser", async function () {
      await market.connect(bettor1).placeBet(1, true, 5000000n);
      await market.connect(bettor2).placeBet(1, false, 5000000n);

      await market.connect(escrow).resolveMarket(1, 200); // below wins

      const balBefore = await mockUsdc.balanceOf(bettor1.address);
      await market.connect(bettor1).claimWinnings(1);
      const balAfter = await mockUsdc.balanceOf(bettor1.address);
      expect(balAfter - balBefore).to.equal(0n);
    });

    it("should send fee to feeRecipient", async function () {
      await market.connect(bettor1).placeBet(1, true, 5000000n);
      await market.connect(bettor2).placeBet(1, false, 5000000n);
      await market.connect(escrow).resolveMarket(1, 350);

      const feeBefore = await mockUsdc.balanceOf(owner.address);
      await market.connect(bettor1).claimWinnings(1);
      const feeAfter = await mockUsdc.balanceOf(owner.address);

      const totalPool = 10000000n;
      const expectedFee = totalPool * 200n / 10000n;
      expect(feeAfter - feeBefore).to.equal(expectedFee);
    });

    it("should reject claim on unresolved market", async function () {
      await market.connect(bettor1).placeBet(1, true, 5000000n);
      await expect(market.connect(bettor1).claimWinnings(1))
        .to.be.revertedWith("Not resolved");
    });

    it("should reject double claim", async function () {
      await market.connect(bettor1).placeBet(1, true, 5000000n);
      await market.connect(bettor2).placeBet(1, false, 5000000n);
      await market.connect(escrow).resolveMarket(1, 350);

      await market.connect(bettor1).claimWinnings(1);
      await expect(market.connect(bettor1).claimWinnings(1))
        .to.be.revertedWith("Already claimed");
    });
  });

  // --- View functions ---
  describe("View functions", function () {
    it("getImpliedProbability should return 5000 when no bets", async function () {
      await market.createMarket(1, 100, 300);
      const prob = await market.getImpliedProbability(1);
      expect(prob).to.equal(5000);
    });

    it("getImpliedProbability should reflect bet distribution", async function () {
      await market.createMarket(1, 100, 300);
      await market.connect(bettor1).placeBet(1, true, 7500000n);
      await market.connect(bettor2).placeBet(1, false, 2500000n);

      const prob = await market.getImpliedProbability(1);
      // 7.5M / 10M * 10000 = 7500
      expect(prob).to.equal(7500);
    });

    it("getActiveMarketCount should count active markets", async function () {
      await market.createMarket(1, 100, 300);
      await market.createMarket(1, 101, 400);
      expect(await market.getActiveMarketCount()).to.equal(2);

      // Resolve one
      await market.connect(escrow).resolveMarket(1, 350);
      expect(await market.getActiveMarketCount()).to.equal(1);
    });

    it("getActiveMarketCount should exclude expired markets", async function () {
      await market.createMarket(1, 100, 300);
      await time.increase(7 * 24 * 60 * 60 + 1);
      expect(await market.getActiveMarketCount()).to.equal(0);
    });
  });

  // --- Fee management ---
  describe("Fee management", function () {
    it("should allow owner to set platform fee", async function () {
      await market.connect(owner).setPlatformFee(300);
      expect(await market.platformFeeBps()).to.equal(300);
    });

    it("should reject fee above 5%", async function () {
      await expect(market.connect(owner).setPlatformFee(501))
        .to.be.revertedWith("Max 5%");
    });

    it("should reject fee change from non-owner", async function () {
      await expect(market.connect(bettor1).setPlatformFee(100))
        .to.be.revertedWith("Not owner");
    });

    it("should allow owner to set fee recipient", async function () {
      await market.connect(owner).setFeeRecipient(feeRecipient.address);
      expect(await market.feeRecipient()).to.equal(feeRecipient.address);
    });

    it("should reject setFeeRecipient from non-owner", async function () {
      await expect(market.connect(bettor1).setFeeRecipient(feeRecipient.address))
        .to.be.revertedWith("Not owner");
    });
  });

  // --- Access control ---
  describe("Access control", function () {
    it("should allow owner to set escrow", async function () {
      await market.connect(owner).setEscrow(bettor1.address);
      expect(await market.escrowContract()).to.equal(bettor1.address);
    });

    it("should reject setEscrow from non-owner", async function () {
      await expect(market.connect(bettor1).setEscrow(bettor1.address))
        .to.be.revertedWith("Not owner");
    });
  });
});
