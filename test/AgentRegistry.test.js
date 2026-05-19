const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AgentRegistry", function () {
  let agentRegistry;
  let owner, agent1, agent2, trustedContract;

  const metadataCID = "QmTestMetadataCID123456789";
  const updatedCID = "QmUpdatedMetadataCID987654321";
  const capabilityHashes = [
    ethers.keccak256(ethers.toUtf8Bytes("text-generation")),
    ethers.keccak256(ethers.toUtf8Bytes("code-review")),
  ];
  const basePriceUsdc = 1000000n; // 1 USDC (6 decimals)

  beforeEach(async function () {
    [owner, agent1, agent2, trustedContract] = await ethers.getSigners();

    const AgentRegistry = await ethers.getContractFactory("AgentRegistry");
    agentRegistry = await AgentRegistry.deploy();
    await agentRegistry.waitForDeployment();
  });

  describe("Registration", function () {
    it("should register a new agent", async function () {
      const tx = await agentRegistry
        .connect(agent1)
        .register(agent1.address, metadataCID, capabilityHashes, basePriceUsdc, true);

      const receipt = await tx.wait();

      const agent = await agentRegistry.getAgent(1);
      expect(agent.agentId).to.equal(1);
      expect(agent.owner).to.equal(agent1.address);
      expect(agent.wallet).to.equal(agent1.address);
      expect(agent.metadataCID).to.equal(metadataCID);
      expect(agent.basePriceUsdc).to.equal(basePriceUsdc);
      expect(agent.isActive).to.equal(true);
      expect(agent.reputationScore).to.equal(400);
      expect(agent.totalTasks).to.equal(0);
    });

    it("should emit AgentRegistered event", async function () {
      await expect(
        agentRegistry.connect(agent1).register(agent1.address, metadataCID, capabilityHashes, basePriceUsdc, true)
      )
        .to.emit(agentRegistry, "AgentRegistered")
        .withArgs(1, agent1.address, agent1.address, metadataCID);
    });

    it("should prevent duplicate registration", async function () {
      await agentRegistry.connect(agent1).register(agent1.address, metadataCID, capabilityHashes, basePriceUsdc, true);

      await expect(
        agentRegistry.connect(agent1).register(agent1.address, metadataCID, capabilityHashes, basePriceUsdc, true)
      ).to.be.revertedWith("AgentRegistry: already registered");
    });

    it("should reject zero wallet address", async function () {
      await expect(
        agentRegistry
          .connect(agent1)
          .register(ethers.ZeroAddress, metadataCID, capabilityHashes, basePriceUsdc, true)
      ).to.be.revertedWith("AgentRegistry: zero wallet address");
    });

    it("should reject empty metadataCID", async function () {
      await expect(
        agentRegistry.connect(agent1).register(agent1.address, "", capabilityHashes, basePriceUsdc, true)
      ).to.be.revertedWith("AgentRegistry: empty metadataCID");
    });

    it("should register with startActive = false", async function () {
      await agentRegistry
        .connect(agent1)
        .register(agent1.address, metadataCID, capabilityHashes, basePriceUsdc, false);

      const agent = await agentRegistry.getAgent(1);
      expect(agent.isActive).to.equal(false);
    });

    it("should increment agent IDs correctly", async function () {
      await agentRegistry.connect(agent1).register(agent1.address, metadataCID, capabilityHashes, basePriceUsdc, true);
      await agentRegistry
        .connect(agent2)
        .register(agent2.address, metadataCID, capabilityHashes, basePriceUsdc, true);

      const a1 = await agentRegistry.getAgent(1);
      const a2 = await agentRegistry.getAgent(2);
      expect(a1.agentId).to.equal(1);
      expect(a2.agentId).to.equal(2);
    });
  });

  describe("Capability Search", function () {
    it("should return agents by capability hash", async function () {
      await agentRegistry.connect(agent1).register(agent1.address, metadataCID, capabilityHashes, basePriceUsdc, true);

      const textGenHash = ethers.keccak256(ethers.toUtf8Bytes("text-generation"));
      const agentIds = await agentRegistry.getAgentsByCapability(textGenHash);
      expect(agentIds.length).to.equal(1);
      expect(agentIds[0]).to.equal(1);
    });

    it("should return multiple agents for same capability", async function () {
      await agentRegistry.connect(agent1).register(agent1.address, metadataCID, capabilityHashes, basePriceUsdc, true);
      await agentRegistry
        .connect(agent2)
        .register(agent2.address, metadataCID, capabilityHashes, basePriceUsdc, true);

      const textGenHash = ethers.keccak256(ethers.toUtf8Bytes("text-generation"));
      const agentIds = await agentRegistry.getAgentsByCapability(textGenHash);
      expect(agentIds.length).to.equal(2);
    });

    it("should return empty array for unknown capability", async function () {
      const unknownHash = ethers.keccak256(ethers.toUtf8Bytes("unknown-capability"));
      const agentIds = await agentRegistry.getAgentsByCapability(unknownHash);
      expect(agentIds.length).to.equal(0);
    });
  });

  describe("Metadata Update", function () {
    it("should update metadata CID", async function () {
      await agentRegistry.connect(agent1).register(agent1.address, metadataCID, capabilityHashes, basePriceUsdc, true);

      await expect(agentRegistry.connect(agent1).updateMetadata(updatedCID))
        .to.emit(agentRegistry, "AgentUpdated")
        .withArgs(1, updatedCID);

      const agent = await agentRegistry.getAgent(1);
      expect(agent.metadataCID).to.equal(updatedCID);
    });

    it("should reject update from unregistered address", async function () {
      await expect(agentRegistry.connect(agent2).updateMetadata(updatedCID)).to.be.revertedWith(
        "AgentRegistry: not registered"
      );
    });

    it("should reject empty metadata CID", async function () {
      await agentRegistry.connect(agent1).register(agent1.address, metadataCID, capabilityHashes, basePriceUsdc, true);

      await expect(agentRegistry.connect(agent1).updateMetadata("")).to.be.revertedWith(
        "AgentRegistry: empty metadataCID"
      );
    });
  });

  describe("Availability", function () {
    it("should toggle availability", async function () {
      await agentRegistry.connect(agent1).register(agent1.address, metadataCID, capabilityHashes, basePriceUsdc, true);

      await expect(agentRegistry.connect(agent1).setAvailability(false))
        .to.emit(agentRegistry, "AvailabilityChanged")
        .withArgs(1, false);

      let agent = await agentRegistry.getAgent(1);
      expect(agent.isActive).to.equal(false);

      await agentRegistry.connect(agent1).setAvailability(true);
      agent = await agentRegistry.getAgent(1);
      expect(agent.isActive).to.equal(true);
    });

    it("should reject from unregistered address", async function () {
      await expect(agentRegistry.connect(agent2).setAvailability(true)).to.be.revertedWith(
        "AgentRegistry: not registered"
      );
    });
  });

  describe("Reputation", function () {
    it("should update reputation from trusted contract", async function () {
      await agentRegistry.connect(agent1).register(agent1.address, metadataCID, capabilityHashes, basePriceUsdc, true);

      await agentRegistry.setTrustedContract(trustedContract.address, true);

      await expect(agentRegistry.connect(trustedContract).updateReputation(1, 450, 1))
        .to.emit(agentRegistry, "ReputationUpdated")
        .withArgs(1, 450);

      const agent = await agentRegistry.getAgent(1);
      expect(agent.reputationScore).to.equal(450);
      expect(agent.totalTasks).to.equal(1);
    });

    it("should reject reputation update from untrusted caller", async function () {
      await agentRegistry.connect(agent1).register(agent1.address, metadataCID, capabilityHashes, basePriceUsdc, true);

      await expect(agentRegistry.connect(agent2).updateReputation(1, 450, 1)).to.be.revertedWith(
        "AgentRegistry: caller is not a trusted contract"
      );
    });
  });
});
