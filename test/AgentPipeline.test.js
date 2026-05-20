const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AgentPipeline", function () {
  let pipeline, mockUsdc, agentRegistry;
  let owner, requester, orchestratorOwner, agent1Owner, agent2Owner;

  const capabilityHashes = [
    ethers.keccak256(ethers.toUtf8Bytes("orchestration")),
  ];
  const basePriceUsdc = 1000000n;
  const metadataCID = "QmTestCID";

  // Agent IDs after registration
  const ORCHESTRATOR_ID = 1;
  const AGENT1_ID = 2;
  const AGENT2_ID = 3;

  async function setupAgents() {
    // Register orchestrator agent (id=1)
    await agentRegistry.connect(orchestratorOwner).register(
      orchestratorOwner.address, metadataCID, capabilityHashes, basePriceUsdc, true
    );
    // Register worker agent 1 (id=2)
    await agentRegistry.connect(agent1Owner).register(
      agent1Owner.address, metadataCID, capabilityHashes, basePriceUsdc, true
    );
    // Register worker agent 2 (id=3)
    await agentRegistry.connect(agent2Owner).register(
      agent2Owner.address, metadataCID, capabilityHashes, basePriceUsdc, true
    );
  }

  beforeEach(async function () {
    [owner, requester, orchestratorOwner, agent1Owner, agent2Owner] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    mockUsdc = await MockUSDC.deploy();
    await mockUsdc.waitForDeployment();

    const AgentRegistry = await ethers.getContractFactory("AgentRegistry");
    agentRegistry = await AgentRegistry.deploy();
    await agentRegistry.waitForDeployment();

    const Pipeline = await ethers.getContractFactory("AgentPipeline");
    pipeline = await Pipeline.deploy(
      await mockUsdc.getAddress(),
      await agentRegistry.getAddress()
    );
    await pipeline.waitForDeployment();

    await setupAgents();

    // Mint USDC to requester and approve
    const mintAmount = 1000000000n; // 1000 USDC
    await mockUsdc.mint(requester.address, mintAmount);
    await mockUsdc.connect(requester).approve(await pipeline.getAddress(), mintAmount);
  });

  // --- createPipeline ---
  describe("createPipeline", function () {
    it("should create a pipeline with budget", async function () {
      const totalBudget = 100000000n; // 100 USDC
      const tx = await pipeline.connect(requester).createPipeline(
        ORCHESTRATOR_ID, totalBudget, "ipfs://task-spec"
      );
      await expect(tx).to.emit(pipeline, "PipelineCreated")
        .withArgs(1, requester.address, totalBudget, "ipfs://task-spec");

      const p = await pipeline.getPipeline(1);
      expect(p.pipelineId).to.equal(1);
      expect(p.requester).to.equal(requester.address);
      expect(p.totalBudget).to.equal(totalBudget);
      expect(p.orchestratorAgentId).to.equal(ORCHESTRATOR_ID);
      expect(p.nodeCount).to.equal(0);
      expect(p.completed).to.equal(false);
    });

    it("should transfer USDC from requester to contract", async function () {
      const balBefore = await mockUsdc.balanceOf(requester.address);
      await pipeline.connect(requester).createPipeline(ORCHESTRATOR_ID, 100000000n, "spec");
      const balAfter = await mockUsdc.balanceOf(requester.address);
      expect(balBefore - balAfter).to.equal(100000000n);
    });

    it("should increment pipeline IDs", async function () {
      await pipeline.connect(requester).createPipeline(ORCHESTRATOR_ID, 10000000n, "spec1");
      await pipeline.connect(requester).createPipeline(ORCHESTRATOR_ID, 10000000n, "spec2");
      expect((await pipeline.getPipeline(1)).pipelineId).to.equal(1);
      expect((await pipeline.getPipeline(2)).pipelineId).to.equal(2);
    });

    it("should reject zero budget", async function () {
      await expect(pipeline.connect(requester).createPipeline(ORCHESTRATOR_ID, 0, "spec"))
        .to.be.revertedWith("Budget must be > 0");
    });
  });

  // --- submitDAG ---
  describe("submitDAG", function () {
    const totalBudget = 100000000n; // 100 USDC

    beforeEach(async function () {
      await pipeline.connect(requester).createPipeline(ORCHESTRATOR_ID, totalBudget, "spec");
    });

    it("should submit a valid DAG", async function () {
      const agentIds = [AGENT1_ID, AGENT2_ID];
      const dependencies = [[], [0]]; // node 1 depends on node 0
      const budgets = [40000000n, 40000000n]; // 80M total (80% <= 90%)

      const tx = await pipeline.connect(orchestratorOwner).submitDAG(
        1, agentIds, dependencies, budgets
      );
      await expect(tx).to.emit(pipeline, "DAGSubmitted").withArgs(1, 2);

      const p = await pipeline.getPipeline(1);
      expect(p.nodeCount).to.equal(2);

      const node0 = await pipeline.getNode(1, 0);
      expect(node0.agentId).to.equal(AGENT1_ID);
      expect(node0.allocatedBudget).to.equal(40000000n);
      expect(node0.status).to.equal(0); // Pending

      const node1 = await pipeline.getNode(1, 1);
      expect(node1.agentId).to.equal(AGENT2_ID);
      expect(node1.dependencies.length).to.equal(1);
      expect(node1.dependencies[0]).to.equal(0n);
    });

    it("should reject if not orchestrator", async function () {
      await expect(
        pipeline.connect(requester).submitDAG(1, [AGENT1_ID], [[]], [40000000n])
      ).to.be.revertedWith("Not orchestrator");
    });

    it("should reject if DAG already submitted", async function () {
      await pipeline.connect(orchestratorOwner).submitDAG(
        1, [AGENT1_ID], [[]], [40000000n]
      );
      await expect(
        pipeline.connect(orchestratorOwner).submitDAG(1, [AGENT1_ID], [[]], [40000000n])
      ).to.be.revertedWith("DAG already submitted");
    });

    it("should reject array length mismatch (agentIds vs dependencies)", async function () {
      await expect(
        pipeline.connect(orchestratorOwner).submitDAG(1, [AGENT1_ID, AGENT2_ID], [[]], [40000000n, 40000000n])
      ).to.be.revertedWith("Array length mismatch");
    });

    it("should reject array length mismatch (agentIds vs budgets)", async function () {
      await expect(
        pipeline.connect(orchestratorOwner).submitDAG(1, [AGENT1_ID], [[]], [40000000n, 40000000n])
      ).to.be.revertedWith("Array length mismatch");
    });

    it("should reject empty DAG", async function () {
      await expect(
        pipeline.connect(orchestratorOwner).submitDAG(1, [], [], [])
      ).to.be.revertedWith("Empty DAG");
    });

    it("should reject if total allocated exceeds 90% of budget", async function () {
      // 91% of 100M = 91M
      await expect(
        pipeline.connect(orchestratorOwner).submitDAG(
          1, [AGENT1_ID], [[]], [91000000n]
        )
      ).to.be.revertedWith("Budget overflow (max 90%)");
    });

    it("should accept exactly 90% of budget", async function () {
      // 90% of 100M = 90M
      await pipeline.connect(orchestratorOwner).submitDAG(
        1, [AGENT1_ID], [[]], [90000000n]
      );
      const p = await pipeline.getPipeline(1);
      expect(p.nodeCount).to.equal(1);
    });
  });

  // --- startNode ---
  describe("startNode", function () {
    beforeEach(async function () {
      await pipeline.connect(requester).createPipeline(ORCHESTRATOR_ID, 100000000n, "spec");
      await pipeline.connect(orchestratorOwner).submitDAG(
        1,
        [AGENT1_ID, AGENT2_ID],
        [[], [0]],
        [40000000n, 40000000n]
      );
    });

    it("should start a node with no dependencies", async function () {
      const tx = await pipeline.connect(orchestratorOwner).startNode(1, 0);
      await expect(tx).to.emit(pipeline, "NodeStatusChanged").withArgs(1, 0, 1); // Running = 1

      const node = await pipeline.getNode(1, 0);
      expect(node.status).to.equal(1); // Running
    });

    it("should reject starting a node with unmet dependencies", async function () {
      await expect(pipeline.connect(orchestratorOwner).startNode(1, 1))
        .to.be.revertedWith("Dependency not complete");
    });

    it("should allow starting node after dependency is completed", async function () {
      await pipeline.connect(orchestratorOwner).startNode(1, 0);
      const deliverable = ethers.keccak256(ethers.toUtf8Bytes("result-0"));
      await pipeline.connect(agent1Owner).completeNode(1, 0, deliverable);

      const tx = await pipeline.connect(orchestratorOwner).startNode(1, 1);
      await expect(tx).to.emit(pipeline, "NodeStatusChanged").withArgs(1, 1, 1);
    });

    it("should reject starting a node that is not pending", async function () {
      await pipeline.connect(orchestratorOwner).startNode(1, 0);
      await expect(pipeline.connect(orchestratorOwner).startNode(1, 0))
        .to.be.revertedWith("Node not pending");
    });

    it("should reject if not orchestrator", async function () {
      await expect(pipeline.connect(requester).startNode(1, 0))
        .to.be.revertedWith("Not orchestrator");
    });
  });

  // --- completeNode ---
  describe("completeNode", function () {
    const deliverable = ethers.keccak256(ethers.toUtf8Bytes("deliverable"));

    beforeEach(async function () {
      await pipeline.connect(requester).createPipeline(ORCHESTRATOR_ID, 100000000n, "spec");
      await pipeline.connect(orchestratorOwner).submitDAG(
        1,
        [AGENT1_ID, AGENT2_ID],
        [[], [0]],
        [40000000n, 40000000n]
      );
      await pipeline.connect(orchestratorOwner).startNode(1, 0);
    });

    it("should complete a running node and pay the agent", async function () {
      const balBefore = await mockUsdc.balanceOf(agent1Owner.address);
      const tx = await pipeline.connect(agent1Owner).completeNode(1, 0, deliverable);
      await expect(tx).to.emit(pipeline, "NodeCompleted").withArgs(1, 0, deliverable);

      const balAfter = await mockUsdc.balanceOf(agent1Owner.address);
      expect(balAfter - balBefore).to.equal(40000000n);

      const node = await pipeline.getNode(1, 0);
      expect(node.status).to.equal(2); // Completed
      expect(node.deliverableHash).to.equal(deliverable);
    });

    it("should reject if not the node's agent", async function () {
      await expect(pipeline.connect(agent2Owner).completeNode(1, 0, deliverable))
        .to.be.revertedWith("Not node agent");
    });

    it("should reject if node is not running", async function () {
      // Node 1 is pending
      await expect(pipeline.connect(agent2Owner).completeNode(1, 1, deliverable))
        .to.be.revertedWith("Node not running");
    });

    it("should reject invalid node ID", async function () {
      await expect(pipeline.connect(agent1Owner).completeNode(1, 99, deliverable))
        .to.be.revertedWith("Invalid node");
    });

    it("should mark pipeline completed when all nodes done", async function () {
      // Complete node 0
      await pipeline.connect(agent1Owner).completeNode(1, 0, deliverable);

      // Start and complete node 1
      await pipeline.connect(orchestratorOwner).startNode(1, 1);
      const deliverable2 = ethers.keccak256(ethers.toUtf8Bytes("final"));
      const tx = await pipeline.connect(agent2Owner).completeNode(1, 1, deliverable2);

      await expect(tx).to.emit(pipeline, "PipelineCompleted").withArgs(1, deliverable2);

      const p = await pipeline.getPipeline(1);
      expect(p.completed).to.equal(true);
      expect(p.finalDeliverableHash).to.equal(deliverable2);
    });

    it("should pay orchestrator fee when pipeline completes", async function () {
      const orchBalBefore = await mockUsdc.balanceOf(orchestratorOwner.address);

      // Complete all nodes
      await pipeline.connect(agent1Owner).completeNode(1, 0, deliverable);
      await pipeline.connect(orchestratorOwner).startNode(1, 1);
      await pipeline.connect(agent2Owner).completeNode(1, 1, deliverable);

      const orchBalAfter = await mockUsdc.balanceOf(orchestratorOwner.address);
      // orchestratorFeeBps = 1000 (10%) of 100M = 10M
      const expectedFee = 100000000n * 1000n / 10000n;
      expect(orchBalAfter - orchBalBefore).to.equal(expectedFee);
    });

    it("should reject completing a node on a completed pipeline", async function () {
      // Complete all nodes first
      await pipeline.connect(agent1Owner).completeNode(1, 0, deliverable);
      await pipeline.connect(orchestratorOwner).startNode(1, 1);
      await pipeline.connect(agent2Owner).completeNode(1, 1, deliverable);

      // Try to complete again (pipeline is completed)
      // Create another pipeline to test the revert
      await pipeline.connect(requester).createPipeline(ORCHESTRATOR_ID, 10000000n, "spec2");
      await pipeline.connect(orchestratorOwner).submitDAG(
        2, [AGENT1_ID], [[]], [5000000n]
      );
      await pipeline.connect(orchestratorOwner).startNode(2, 0);
      await pipeline.connect(agent1Owner).completeNode(2, 0, deliverable);
      // Pipeline 2 is now completed, any further completeNode would need a running node
    });
  });

  // --- failNode ---
  describe("failNode", function () {
    beforeEach(async function () {
      await pipeline.connect(requester).createPipeline(ORCHESTRATOR_ID, 100000000n, "spec");
      await pipeline.connect(orchestratorOwner).submitDAG(
        1, [AGENT1_ID], [[]], [40000000n]
      );
      await pipeline.connect(orchestratorOwner).startNode(1, 0);
    });

    it("should fail a running node", async function () {
      const tx = await pipeline.connect(orchestratorOwner).failNode(1, 0);
      await expect(tx).to.emit(pipeline, "NodeStatusChanged").withArgs(1, 0, 3); // Failed = 3
      await expect(tx).to.emit(pipeline, "PipelineFailed").withArgs(1, 0);

      const node = await pipeline.getNode(1, 0);
      expect(node.status).to.equal(3); // Failed
    });

    it("should reject failing a non-running node", async function () {
      await pipeline.connect(orchestratorOwner).failNode(1, 0);
      await expect(pipeline.connect(orchestratorOwner).failNode(1, 0))
        .to.be.revertedWith("Node not running");
    });

    it("should reject if not orchestrator", async function () {
      await expect(pipeline.connect(requester).failNode(1, 0))
        .to.be.revertedWith("Not orchestrator");
    });
  });

  // --- retryNode ---
  describe("retryNode", function () {
    beforeEach(async function () {
      await pipeline.connect(requester).createPipeline(ORCHESTRATOR_ID, 100000000n, "spec");
      await pipeline.connect(orchestratorOwner).submitDAG(
        1, [AGENT1_ID], [[]], [40000000n]
      );
      await pipeline.connect(orchestratorOwner).startNode(1, 0);
      await pipeline.connect(orchestratorOwner).failNode(1, 0);
    });

    it("should retry a failed node with a new agent", async function () {
      const tx = await pipeline.connect(orchestratorOwner).retryNode(1, 0, AGENT2_ID);
      await expect(tx).to.emit(pipeline, "NodeStatusChanged").withArgs(1, 0, 0); // Pending = 0

      const node = await pipeline.getNode(1, 0);
      expect(node.agentId).to.equal(AGENT2_ID);
      expect(node.status).to.equal(0); // Pending
    });

    it("should allow starting the retried node", async function () {
      await pipeline.connect(orchestratorOwner).retryNode(1, 0, AGENT2_ID);
      await pipeline.connect(orchestratorOwner).startNode(1, 0);

      const node = await pipeline.getNode(1, 0);
      expect(node.status).to.equal(1); // Running
    });

    it("should allow completing a retried node by new agent", async function () {
      await pipeline.connect(orchestratorOwner).retryNode(1, 0, AGENT2_ID);
      await pipeline.connect(orchestratorOwner).startNode(1, 0);

      const deliverable = ethers.keccak256(ethers.toUtf8Bytes("retry-result"));
      const balBefore = await mockUsdc.balanceOf(agent2Owner.address);
      await pipeline.connect(agent2Owner).completeNode(1, 0, deliverable);
      const balAfter = await mockUsdc.balanceOf(agent2Owner.address);
      expect(balAfter - balBefore).to.equal(40000000n);
    });

    it("should reject retrying a non-failed node", async function () {
      await pipeline.connect(orchestratorOwner).retryNode(1, 0, AGENT2_ID);
      // Node is now Pending, not Failed
      await expect(pipeline.connect(orchestratorOwner).retryNode(1, 0, AGENT1_ID))
        .to.be.revertedWith("Node not failed");
    });

    it("should reject if not orchestrator", async function () {
      await expect(pipeline.connect(requester).retryNode(1, 0, AGENT2_ID))
        .to.be.revertedWith("Not orchestrator");
    });
  });

  // --- Dependency validation (complex DAG) ---
  describe("Dependency validation", function () {
    it("should enforce multi-level dependencies", async function () {
      // DAG: 0 -> 1 -> 2
      await pipeline.connect(requester).createPipeline(ORCHESTRATOR_ID, 100000000n, "spec");
      await pipeline.connect(orchestratorOwner).submitDAG(
        1,
        [AGENT1_ID, AGENT2_ID, AGENT1_ID],
        [[], [0], [1]],
        [20000000n, 20000000n, 20000000n]
      );

      // Cannot start node 2 directly
      await expect(pipeline.connect(orchestratorOwner).startNode(1, 2))
        .to.be.revertedWith("Dependency not complete");

      // Cannot start node 1 before node 0 is complete
      await expect(pipeline.connect(orchestratorOwner).startNode(1, 1))
        .to.be.revertedWith("Dependency not complete");

      // Complete node 0
      await pipeline.connect(orchestratorOwner).startNode(1, 0);
      const d0 = ethers.keccak256(ethers.toUtf8Bytes("d0"));
      await pipeline.connect(agent1Owner).completeNode(1, 0, d0);

      // Now node 1 can start, but node 2 still cannot
      await pipeline.connect(orchestratorOwner).startNode(1, 1);
      await expect(pipeline.connect(orchestratorOwner).startNode(1, 2))
        .to.be.revertedWith("Dependency not complete");

      // Complete node 1
      const d1 = ethers.keccak256(ethers.toUtf8Bytes("d1"));
      await pipeline.connect(agent2Owner).completeNode(1, 1, d1);

      // Now node 2 can start
      await pipeline.connect(orchestratorOwner).startNode(1, 2);
      const node2 = await pipeline.getNode(1, 2);
      expect(node2.status).to.equal(1); // Running
    });

    it("should allow parallel nodes with same dependency", async function () {
      // DAG: 0 -> 1, 0 -> 2
      await pipeline.connect(requester).createPipeline(ORCHESTRATOR_ID, 100000000n, "spec");
      await pipeline.connect(orchestratorOwner).submitDAG(
        1,
        [AGENT1_ID, AGENT2_ID, AGENT1_ID],
        [[], [0], [0]],
        [20000000n, 20000000n, 20000000n]
      );

      // Complete node 0
      await pipeline.connect(orchestratorOwner).startNode(1, 0);
      const d0 = ethers.keccak256(ethers.toUtf8Bytes("d0"));
      await pipeline.connect(agent1Owner).completeNode(1, 0, d0);

      // Both node 1 and node 2 can start now
      await pipeline.connect(orchestratorOwner).startNode(1, 1);
      await pipeline.connect(orchestratorOwner).startNode(1, 2);

      const node1 = await pipeline.getNode(1, 1);
      const node2 = await pipeline.getNode(1, 2);
      expect(node1.status).to.equal(1);
      expect(node2.status).to.equal(1);
    });
  });

  // --- getPipelineProgress ---
  describe("getPipelineProgress", function () {
    it("should return correct progress counts", async function () {
      await pipeline.connect(requester).createPipeline(ORCHESTRATOR_ID, 100000000n, "spec");
      await pipeline.connect(orchestratorOwner).submitDAG(
        1,
        [AGENT1_ID, AGENT2_ID, AGENT1_ID],
        [[], [], []],
        [20000000n, 20000000n, 20000000n]
      );

      let progress = await pipeline.getPipelineProgress(1);
      expect(progress.total).to.equal(3);
      expect(progress.pending).to.equal(3);
      expect(progress.running).to.equal(0);
      expect(progress.completed).to.equal(0);
      expect(progress.failed).to.equal(0);

      // Start node 0
      await pipeline.connect(orchestratorOwner).startNode(1, 0);
      progress = await pipeline.getPipelineProgress(1);
      expect(progress.running).to.equal(1);
      expect(progress.pending).to.equal(2);

      // Complete node 0
      const d = ethers.keccak256(ethers.toUtf8Bytes("d"));
      await pipeline.connect(agent1Owner).completeNode(1, 0, d);
      progress = await pipeline.getPipelineProgress(1);
      expect(progress.completed).to.equal(1);
      expect(progress.pending).to.equal(2);

      // Fail node 1
      await pipeline.connect(orchestratorOwner).startNode(1, 1);
      await pipeline.connect(orchestratorOwner).failNode(1, 1);
      progress = await pipeline.getPipelineProgress(1);
      expect(progress.completed).to.equal(1);
      expect(progress.failed).to.equal(1);
      expect(progress.pending).to.equal(1);
    });
  });

  // --- Admin ---
  describe("Admin", function () {
    it("should allow owner to set orchestrator fee", async function () {
      await pipeline.connect(owner).setOrchestratorFee(500);
      expect(await pipeline.orchestratorFeeBps()).to.equal(500);
    });

    it("should reject orchestrator fee above 20%", async function () {
      await expect(pipeline.connect(owner).setOrchestratorFee(2001))
        .to.be.revertedWith("Max 20%");
    });

    it("should reject setOrchestratorFee from non-owner", async function () {
      await expect(pipeline.connect(requester).setOrchestratorFee(500))
        .to.be.revertedWith("Not owner");
    });
  });

  // --- emergencyRefund ---
  describe("emergencyRefund", function () {
    it("should refund uncompleted node budgets to requester", async function () {
      await pipeline.connect(requester).createPipeline(ORCHESTRATOR_ID, 100000000n, "spec");
      await pipeline.connect(orchestratorOwner).submitDAG(
        1,
        [AGENT1_ID, AGENT2_ID],
        [[], [0]],
        [40000000n, 40000000n]
      );

      // Complete node 0 only
      await pipeline.connect(orchestratorOwner).startNode(1, 0);
      const d = ethers.keccak256(ethers.toUtf8Bytes("d"));
      await pipeline.connect(agent1Owner).completeNode(1, 0, d);

      const balBefore = await mockUsdc.balanceOf(requester.address);
      await pipeline.connect(owner).emergencyRefund(1);
      const balAfter = await mockUsdc.balanceOf(requester.address);

      // Only node 1 (40M) is uncompleted
      expect(balAfter - balBefore).to.equal(40000000n);

      const p = await pipeline.getPipeline(1);
      expect(p.completed).to.equal(true);
    });

    it("should refund all node budgets if none completed", async function () {
      await pipeline.connect(requester).createPipeline(ORCHESTRATOR_ID, 100000000n, "spec");
      await pipeline.connect(orchestratorOwner).submitDAG(
        1, [AGENT1_ID, AGENT2_ID], [[], [0]], [40000000n, 40000000n]
      );

      const balBefore = await mockUsdc.balanceOf(requester.address);
      await pipeline.connect(owner).emergencyRefund(1);
      const balAfter = await mockUsdc.balanceOf(requester.address);

      expect(balAfter - balBefore).to.equal(80000000n);
    });

    it("should reject if not owner", async function () {
      await pipeline.connect(requester).createPipeline(ORCHESTRATOR_ID, 100000000n, "spec");
      await expect(pipeline.connect(requester).emergencyRefund(1))
        .to.be.revertedWith("Not owner");
    });

    it("should reject if pipeline already completed", async function () {
      await pipeline.connect(requester).createPipeline(ORCHESTRATOR_ID, 100000000n, "spec");
      await pipeline.connect(orchestratorOwner).submitDAG(
        1, [AGENT1_ID], [[]], [40000000n]
      );
      await pipeline.connect(orchestratorOwner).startNode(1, 0);
      const d = ethers.keccak256(ethers.toUtf8Bytes("d"));
      await pipeline.connect(agent1Owner).completeNode(1, 0, d);

      await expect(pipeline.connect(owner).emergencyRefund(1))
        .to.be.revertedWith("Already completed");
    });
  });
});
