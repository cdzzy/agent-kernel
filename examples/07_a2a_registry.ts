/**
 * A2A Agent Card Registry Example — publish kernel agents as A2A discoverable endpoints.
 *
 * A2A (Agent-to-Agent) is Google's open protocol. This example shows how to
 * register agents from agent-kernel as discoverable A2A agents.
 *
 * Reference: https://a2a-protocol.org
 */

import { A2AAgentCardRegistry } from '../src/a2a-registry';

// Create registry for the production namespace
const registry = new A2AAgentCardRegistry({
  namespace: 'production',
  baseUrl: 'http://agent-kernel:8000',
  organization: 'cdzzy',
});

// Register agents from the kernel
registry.registerAgent({
  id: 'researcher',
  description: 'Research agent for market data and competitive analysis',
  skills: ['web-search', 'data-analysis'],
  endpoint: 'http://agent-kernel:8000/agents/researcher/a2a',
  tags: ['research', 'ai'],
});

registry.registerAgent({
  id: 'writer',
  description: 'Content generation agent for reports and summaries',
  skills: ['writing', 'summarize'],
  endpoint: 'http://agent-kernel:8000/agents/writer/a2a',
  tags: ['writing', 'content'],
});

registry.registerAgent({
  id: 'code-analyst',
  description: 'Code review and analysis agent',
  skills: ['code-execution', 'static-analysis'],
  endpoint: 'http://agent-kernel:8000/agents/code-analyst/a2a',
  tags: ['development', 'code'],
});

// Query the registry
console.log('Registered agents:', registry.listAgents());

// Find agents by skill
const searchAgents = registry.findBySkill('web-search');
console.log('Agents with web-search:', searchAgents.map(a => a.name));

// Get a specific agent card
const researcherCard = registry.getCard('researcher');
console.log('Researcher card:', JSON.stringify(researcherCard, null, 2));

// Export the discovery manifest
const manifest = registry.exportManifest();
console.log('\n=== A2A Discovery Manifest ===');
console.log(JSON.stringify(manifest, null, 2));

// Export individual agent card (served at /.well-known/agent.json per A2A spec)
const agentJSON = registry.getAgentCardJSON('researcher');
console.log('\n=== Researcher Agent Card (for /.well-known/agent.json) ===');
console.log(agentJSON);
