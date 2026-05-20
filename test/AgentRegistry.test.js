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

    it("should emit AgentRegistered event with timestamp", async function () {
      // #8: event now has (agentId, owner, metadataCID, timestamp) - no wallet
      const tx = await agentRegistry.connect(agent1).register(agent1.address, metadataCID, capabilityHashes, basePriceUsdc, true);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      await expect(tx)
        .to.emit(agentRegistry, "AgentRegistered")
        .withArgs(1, agent1.address, metadataCID, block.timestamp);
    });

    it("should prevent duplicate registration", async function () {
      await agentRegistry.connect(agent1).register(agent1.address, metadataCID, capabilityHashes, basePriceUsdc, true);

      await expect(
        agentRegistry.connect(agent1).register(agent1.address, metadataCID, capabilityHashes, basePriceUsdc, true)
      ).to.be.revertedWith("Already registered");
    });

    it("should reject zero wallet address", async function () {
      await expect(
        agentRegistry
          .connect(agent1)
          .register(ethers.ZeroAddress, metadataCID, capabilityHashes, basePriceUsdc, true)
      ).to.be.revertedWith("Invalid wallet");
    });

    it("should reject empty metadataCID", async function () {
      await expect(
        agentRegistry.connect(agent1).register(agent1.address, "", capabilityHashes, basePriceUsdc, true)
      ).to.be.revertedWith("Empty metadata CID");
    });

    // #1: test for empty capabilities array
    it("should reject empty capabilities array", async function () {
      await expect(
        agentRegistry.connect(agent1).register(agent1.address, metadataCID, [], basePriceUsdc, true)
      ).to.be.revertedWith("No capabilities");
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

    // #7: test addressToAgentId mapping
    it("should map address to agent ID via addressToAgentId", async function () {
      await agentRegistry.connect(agent1).register(agent1.address, metadataCID, capabilityHashes, basePriceUsdc, true);
      const agentId = await agentRegistry.addressToAgentId(agent1.address);
      expect(agentId).to.equal(1);
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

    // #2: test public capabilityIndex access
    it("should expose capabilityIndex as public mapping", async function () {
      await agentRegistry.connect(agent1).register(agent1.address, metadataCID, capabilityHashes, basePriceUsdc, true);
      const textGenHash = ethers.keccak256(ethers.toUtf8Bytes("text-generation"));
      // Public mapping accessible via capabilityIndex(hash, index)
      const firstAgentId = await agentRegistry.capabilityIndex(textGenHash, 0);
      expect(firstAgentId).to.equal(1);
    });
  });

  describe("Metadata Update", function () {
    it("should update metadata CID", async function () {
      await agentRegistry.connect(agent1).register(agent1.address, metadataCID, capabilityHashes, basePriceUsdc, true);

      const newBasePrice = ethers.parseUnits('3', 6);
      await expect(agentRegistry.connect(agent1).updateMetadata(updatedCID, newBasePrice))
        .to.emit(agentRegistry, "AgentUpdated")
        .withArgs(1, updatedCID);

      const agent = await agentRegistry.getAgent(1);
      expect(agent.metadataCID).to.equal(updatedCID);
    });

    it("should reject update from unregistered address", async function () {
      await expect(agentRegistry.connect(agent2).updateMetadata(updatedCID, ethers.parseUnits('3', 6))).to.be.revertedWith(
        "Not registered"
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
        "Not registered"
      );
    });
  });

  describe("Reputation", function () {
    it("should update reputation from trusted contract", async function () {
      await agentRegistry.connect(agent1).register(agent1.address, metadataCID, capabilityHashes, basePriceUsdc, true);

      await agentRegistry.setTrustedContract(trustedContract.address, true);

      // #3: third parameter is now bool (incrementTaskCount)
      await expect(agentRegistry.connect(trustedContract).updateReputation(1, 450, true))
        .to.emit(agentRegistry, "ReputationUpdated")
        .withArgs(1, 450);

      const agent = await agentRegistry.getAgent(1);
      expect(agent.reputationScore).to.equal(450);
      expect(agent.totalTasks).to.equal(1);
    });

    it("should not increment task count when incrementTaskCount is false", async function () {
      await agentRegistry.connect(agent1).register(agent1.address, metadataCID, capabilityHashes, basePriceUsdc, true);
      await agentRegistry.setTrustedContract(trustedContract.address, true);

      await agentRegistry.connect(trustedContract).updateReputation(1, 450, false);
      const agent = await agentRegistry.getAgent(1);
      expect(agent.reputationScore).to.equal(450);
      expect(agent.totalTasks).to.equal(0);
    });

    it("should reject reputation update from untrusted caller", async function () {
      await agentRegistry.connect(agent1).register(agent1.address, metadataCID, capabilityHashes, basePriceUsdc, true);

      await expect(agentRegistry.connect(agent2).updateReputation(1, 450, true)).to.be.revertedWith(
        "Not trusted"
      );
    });

    it("should reject score out of range", async function () {
      await agentRegistry.connect(agent1).register(agent1.address, metadataCID, capabilityHashes, basePriceUsdc, true);
      await agentRegistry.setTrustedContract(trustedContract.address, true);

      await expect(agentRegistry.connect(trustedContract).updateReputation(1, 501, true)).to.be.revertedWith(
        "Score out of range"
      );
    });
  });
});
