const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("E2E: Full Flow", function () {
  let agentRegistry, taskEscrow, mockUsdc, reputationOracle;
  let owner, agentOwner, requester, feeRecipient;

  const metadataCID = "QmE2ETestMetadataCID";
  const capabilityHashes = [ethers.keccak256(ethers.toUtf8Bytes("data-analysis"))];
  const basePriceUsdc = 5000000n; // 5 USDC
  const taskAmount = 5000000n; // 5 USDC
  const deadline = Math.floor(Date.now() / 1000) + 86400;
  const agreementHash = ethers.keccak256(ethers.toUtf8Bytes("e2e-agreement"));

  function taskId(label) {
    return ethers.keccak256(ethers.toUtf8Bytes(label));
  }

  beforeEach(async function () {
    [owner, agentOwner, requester, feeRecipient] = await ethers.getSigners();

    // Deploy all contracts
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    mockUsdc = await MockUSDC.deploy();
    await mockUsdc.waitForDeployment();

    const ReputationOracle = await ethers.getContractFactory("ReputationOracle");
    reputationOracle = await ReputationOracle.deploy();
    await reputationOracle.waitForDeployment();

    const AgentRegistry = await ethers.getContractFactory("AgentRegistry");
    agentRegistry = await AgentRegistry.deploy();
    await agentRegistry.waitForDeployment();

    const TaskEscrow = await ethers.getContractFactory("TaskEscrow");
    taskEscrow = await TaskEscrow.deploy(
      await mockUsdc.getAddress(),
      await agentRegistry.getAddress(),
      feeRecipient.address
    );
    await taskEscrow.waitForDeployment();

    // Set trust relationships
    await agentRegistry.setTrustedContract(await taskEscrow.getAddress(), true);
    await reputationOracle.setTrustedCaller(owner.address, true);

    // Mint USDC to requester
    await mockUsdc.mint(requester.address, 100000000n); // 100 USDC
    await mockUsdc.connect(requester).approve(await taskEscrow.getAddress(), 100000000n);
  });

  it("should complete full flow: register -> deposit -> release -> verify balances", async function () {
    // Step 1: Register agent
    const registerTx = await agentRegistry
      .connect(agentOwner)
      .register(agentOwner.address, metadataCID, capabilityHashes, basePriceUsdc, true);
    await registerTx.wait();

    const agent = await agentRegistry.getAgent(1);
    expect(agent.agentId).to.equal(1);
    expect(agent.isActive).to.equal(true);
    expect(agent.reputationScore).to.equal(400);
    console.log("  [1] Agent registered with ID:", agent.agentId.toString());

    // Step 2: Verify agent appears in capability search
    const agents = await agentRegistry.getAgentsByCapability(capabilityHashes[0]);
    expect(agents.length).to.equal(1);
    expect(agents[0]).to.equal(1);
    console.log("  [2] Agent found by capability search");

    // Step 3: Deposit funds into escrow
    const tid = taskId("e2e-task-1");
    const requesterBalanceBefore = await mockUsdc.balanceOf(requester.address);

    const depositTx = await taskEscrow
      .connect(requester)
      .deposit(tid, taskAmount, agentOwner.address, deadline, agreementHash);
    await depositTx.wait();

    const requesterBalanceAfterDeposit = await mockUsdc.balanceOf(requester.address);
    expect(requesterBalanceBefore - requesterBalanceAfterDeposit).to.equal(taskAmount);
    console.log("  [3] Funds deposited into escrow:", taskAmount.toString(), "units");

    // Step 4: Release funds (requester approves task completion)
    const providerBalanceBefore = await mockUsdc.balanceOf(agentOwner.address);
    const feeRecipientBalanceBefore = await mockUsdc.balanceOf(feeRecipient.address);

    const releaseTx = await taskEscrow.connect(requester).release(tid);
    await releaseTx.wait();

    // Step 5: Verify balances
    const expectedFee = (taskAmount * 50n) / 10000n; // 0.5%
    const expectedPayout = taskAmount - expectedFee;

    const providerBalanceAfter = await mockUsdc.balanceOf(agentOwner.address);
    const feeRecipientBalanceAfter = await mockUsdc.balanceOf(feeRecipient.address);

    expect(providerBalanceAfter - providerBalanceBefore).to.equal(expectedPayout);
    expect(feeRecipientBalanceAfter - feeRecipientBalanceBefore).to.equal(expectedFee);

    console.log("  [4] Funds released:");
    console.log("      Provider received:", expectedPayout.toString());
    console.log("      Platform fee:", expectedFee.toString());

    // Step 6: Verify task status is Released
    const task = await taskEscrow.tasks(tid);
    expect(task.status).to.equal(2); // Released
    console.log("  [5] Task status confirmed: Released");

    // Step 7: Submit reputation rating via oracle
    await reputationOracle.submitRating(1, 480);
    const avgScore = await reputationOracle.getAverageScore(1);
    expect(avgScore).to.equal(480);
    console.log("  [6] Reputation rating submitted. Average score:", avgScore.toString());

    // Step 8: Verify rating history
    const history = await reputationOracle.getRatingHistory(1);
    expect(history.length).to.equal(1);
    expect(history[0]).to.equal(480);
    console.log("  [7] Rating history verified");
  });
});
