const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("TaskEscrow", function () {
  let taskEscrow, mockUsdc, agentRegistry;
  let owner, requester, provider, feeRecipient;

  const depositAmount = 1000000n; // 1 USDC
  const deadline = Math.floor(Date.now() / 1000) + 86400; // 24h from now
  const agreementHash = ethers.keccak256(ethers.toUtf8Bytes("task-agreement-v1"));

  function taskId(label) {
    return ethers.keccak256(ethers.toUtf8Bytes(label));
  }

  beforeEach(async function () {
    [owner, requester, provider, feeRecipient] = await ethers.getSigners();

    // Deploy MockUSDC
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    mockUsdc = await MockUSDC.deploy();
    await mockUsdc.waitForDeployment();

    // Deploy AgentRegistry
    const AgentRegistry = await ethers.getContractFactory("AgentRegistry");
    agentRegistry = await AgentRegistry.deploy();
    await agentRegistry.waitForDeployment();

    // Deploy TaskEscrow
    const TaskEscrow = await ethers.getContractFactory("TaskEscrow");
    taskEscrow = await TaskEscrow.deploy(
      await mockUsdc.getAddress(),
      await agentRegistry.getAddress(),
      feeRecipient.address
    );
    await taskEscrow.waitForDeployment();

    // Mint USDC to requester and approve escrow
    await mockUsdc.mint(requester.address, 10000000n); // 10 USDC
    await mockUsdc.connect(requester).approve(await taskEscrow.getAddress(), 10000000n);
  });

  describe("Deposit", function () {
    it("should lock funds for a task", async function () {
      const tid = taskId("task-1");

      await expect(
        taskEscrow.connect(requester).deposit(tid, depositAmount, provider.address, deadline, agreementHash)
      )
        .to.emit(taskEscrow, "FundsLocked")
        .withArgs(tid, requester.address, provider.address, depositAmount);

      const task = await taskEscrow.tasks(tid);
      expect(task.requester).to.equal(requester.address);
      expect(task.provider).to.equal(provider.address);
      expect(task.amount).to.equal(depositAmount);
      expect(task.status).to.equal(1); // Locked
    });

    it("should reject duplicate task IDs", async function () {
      const tid = taskId("task-dup");
      await taskEscrow.connect(requester).deposit(tid, depositAmount, provider.address, deadline, agreementHash);

      await expect(
        taskEscrow.connect(requester).deposit(tid, depositAmount, provider.address, deadline, agreementHash)
      ).to.be.revertedWith("TaskEscrow: task already exists");
    });

    it("should reject zero amount", async function () {
      const tid = taskId("task-zero");
      await expect(
        taskEscrow.connect(requester).deposit(tid, 0, provider.address, deadline, agreementHash)
      ).to.be.revertedWith("TaskEscrow: zero amount");
    });

    it("should reject zero provider address", async function () {
      const tid = taskId("task-noprov");
      await expect(
        taskEscrow.connect(requester).deposit(tid, depositAmount, ethers.ZeroAddress, deadline, agreementHash)
      ).to.be.revertedWith("TaskEscrow: zero provider");
    });

    it("should reject deadline in the past", async function () {
      const tid = taskId("task-past");
      const pastDeadline = Math.floor(Date.now() / 1000) - 3600;
      await expect(
        taskEscrow.connect(requester).deposit(tid, depositAmount, provider.address, pastDeadline, agreementHash)
      ).to.be.revertedWith("TaskEscrow: deadline in the past");
    });
  });

  describe("Release", function () {
    it("should release funds with correct fee calculation", async function () {
      const tid = taskId("task-release");
      await taskEscrow.connect(requester).deposit(tid, depositAmount, provider.address, deadline, agreementHash);

      const providerBalanceBefore = await mockUsdc.balanceOf(provider.address);
      const feeRecipientBalanceBefore = await mockUsdc.balanceOf(feeRecipient.address);

      // 0.5% fee = 5000 (of 1000000)
      const expectedFee = (depositAmount * 50n) / 10000n;
      const expectedPayout = depositAmount - expectedFee;

      await expect(taskEscrow.connect(requester).release(tid))
        .to.emit(taskEscrow, "FundsReleased")
        .withArgs(tid, provider.address, expectedPayout, expectedFee);

      const providerBalanceAfter = await mockUsdc.balanceOf(provider.address);
      const feeRecipientBalanceAfter = await mockUsdc.balanceOf(feeRecipient.address);

      expect(providerBalanceAfter - providerBalanceBefore).to.equal(expectedPayout);
      expect(feeRecipientBalanceAfter - feeRecipientBalanceBefore).to.equal(expectedFee);
    });

    it("should reject release from non-requester", async function () {
      const tid = taskId("task-noauth");
      await taskEscrow.connect(requester).deposit(tid, depositAmount, provider.address, deadline, agreementHash);

      await expect(taskEscrow.connect(provider).release(tid)).to.be.revertedWith(
        "TaskEscrow: only requester can release"
      );
    });

    it("should reject release of non-locked task", async function () {
      const tid = taskId("task-empty");
      await expect(taskEscrow.connect(requester).release(tid)).to.be.revertedWith("TaskEscrow: task not locked");
    });
  });

  describe("Refund on Timeout", function () {
    it("should refund after deadline", async function () {
      const tid = taskId("task-refund");
      const shortDeadline = (await time.latest()) + 60; // 60 seconds from now

      await taskEscrow
        .connect(requester)
        .deposit(tid, depositAmount, provider.address, shortDeadline, agreementHash);

      // Advance time past deadline
      await time.increase(120);

      const balanceBefore = await mockUsdc.balanceOf(requester.address);

      await expect(taskEscrow.connect(requester).refundOnTimeout(tid))
        .to.emit(taskEscrow, "FundsRefunded")
        .withArgs(tid, requester.address, depositAmount);

      const balanceAfter = await mockUsdc.balanceOf(requester.address);
      expect(balanceAfter - balanceBefore).to.equal(depositAmount);
    });

    it("should reject refund before deadline", async function () {
      const tid = taskId("task-early");
      await taskEscrow.connect(requester).deposit(tid, depositAmount, provider.address, deadline, agreementHash);

      await expect(taskEscrow.connect(requester).refundOnTimeout(tid)).to.be.revertedWith(
        "TaskEscrow: deadline not passed"
      );
    });
  });

  describe("Dispute", function () {
    it("should allow requester to dispute", async function () {
      const tid = taskId("task-dispute-req");
      await taskEscrow.connect(requester).deposit(tid, depositAmount, provider.address, deadline, agreementHash);

      await expect(taskEscrow.connect(requester).dispute(tid))
        .to.emit(taskEscrow, "DisputeRaised")
        .withArgs(tid, requester.address);

      const task = await taskEscrow.tasks(tid);
      expect(task.status).to.equal(3); // Disputed
    });

    it("should allow provider to dispute", async function () {
      const tid = taskId("task-dispute-prov");
      await taskEscrow.connect(requester).deposit(tid, depositAmount, provider.address, deadline, agreementHash);

      await expect(taskEscrow.connect(provider).dispute(tid))
        .to.emit(taskEscrow, "DisputeRaised")
        .withArgs(tid, provider.address);
    });

    it("should reject dispute from third party", async function () {
      const tid = taskId("task-dispute-third");
      await taskEscrow.connect(requester).deposit(tid, depositAmount, provider.address, deadline, agreementHash);

      await expect(taskEscrow.connect(owner).dispute(tid)).to.be.revertedWith(
        "TaskEscrow: only requester or provider can dispute"
      );
    });
  });
});
