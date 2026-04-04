/**
 * A2A Agent Card Registry — register agents as discoverable A2A endpoints.
 *
 * A2A (Agent-to-Agent) is Google's open protocol for inter-agent communication.
 * This registry allows agents managed by agent-kernel to publish Agent Cards
 * for discovery by external A2A-compatible systems.
 *
 * Reference: https://a2a-protocol.org
 *
 * Usage:
 *   import { A2AAgentCardRegistry } from './a2a-registry';
 *
 *   const registry = new A2AAgentCardRegistry({ namespace: 'production' });
 *   registry.registerAgent({
 *     id: 'researcher',
 *     description: 'Research agent for market data',
 *     skills: ['web-search', 'data-analysis'],
 *     endpoint: 'http://kernel:8000/agents/researcher',
 *   });
 *
 *   // Export all agent cards as a discovery manifest
 *   const manifest = registry.exportManifest();
 */

import { AgentId } from './types.js';

// ---- A2A Types ----

export interface A2AAgentCapability {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
}

export interface A2AAgentProvider {
  organization: string;
  name: string;
  url?: string;
}

export interface A2AAgentCard {
  name: string;
  description: string;
  version: string;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    stateTransitionHistory: boolean;
  };
  skills: A2AAgentCapability[];
  defaultInputModes: string[];
  defaultOutputModes: string[];
  tags: string[];
  provider: A2AAgentProvider;
  url: string;
  documentationUrl?: string;
  endpoint: string;
}

export interface A2ADiscoveryManifest {
  version: string;
  agents: A2AAgentCard[];
  exportedAt: string;
}

export interface RegisterAgentOptions {
  /** Unique agent ID within the kernel namespace */
  id: string;
  /** Human-readable description of what the agent does */
  description: string;
  /** A2A skill/capability IDs (e.g., 'web-search', 'code-execution') */
  skills?: string[];
  /** URL endpoint for this agent's A2A handler */
  endpoint: string;
  /** Optional metadata */
  tags?: string[];
  provider?: Partial<A2AAgentProvider>;
  /** Version string (defaults to '1.0.0') */
  version?: string;
}

export interface A2ARegistryConfig {
  /** Kernel/namespace identifier */
  namespace: string;
  /** Base URL for all agent endpoints (e.g., 'http://kernel:8000') */
  baseUrl?: string;
  /** Organization name for agent cards */
  organization?: string;
}

// ---- A2A Agent Card Registry ----

export class A2AAgentCardRegistry {
  private cards = new Map<string, A2AAgentCard>();
  private config: Required<A2ARegistryConfig>;

  constructor(config: A2ARegistryConfig) {
    this.config = {
      namespace: config.namespace,
      baseUrl: config.baseUrl ?? 'http://localhost:8000',
      organization: config.organization ?? 'agent-kernel',
    };
  }

  /**
   * Register an agent as an A2A discoverable endpoint.
   *
   * Calling this multiple times with the same id updates the card.
   */
  registerAgent(options: RegisterAgentOptions): A2AAgentCard {
    const card: A2AAgentCard = {
      name: options.id,
      description: options.description,
      version: options.version ?? '1.0.0',
      capabilities: {
        streaming: true,
        pushNotifications: false,
        stateTransitionHistory: false,
      },
      skills: (options.skills ?? []).map((id) => ({
        id,
        name: id,
        description: `Agent capability: ${id}`,
      })),
      defaultInputModes: ['text'],
      defaultOutputModes: ['text'],
      tags: options.tags ?? [],
      provider: {
        organization: this.config.organization,
        name: 'agent-kernel',
        url: 'https://github.com/cdzzy/agent-kernel',
      },
      url: options.endpoint,
      documentationUrl: 'https://github.com/cdzzy/agent-kernel#a2a-registry',
      endpoint: options.endpoint,
    };

    this.cards.set(options.id, card);
    return card;
  }

  /**
   * Unregister an agent from the registry.
   */
  unregisterAgent(agentId: string): boolean {
    return this.cards.delete(agentId);
  }

  /**
   * Get the Agent Card for a specific agent.
   */
  getCard(agentId: string): A2AAgentCard | undefined {
    return this.cards.get(agentId);
  }

  /**
   * List all registered agent IDs.
   */
  listAgents(): string[] {
    return Array.from(this.cards.keys());
  }

  /**
   * Find agents that expose a specific skill/capability.
   */
  findBySkill(skillId: string): A2AAgentCard[] {
    return Array.from(this.cards.values()).filter((card) =>
      card.skills.some((s) => s.id === skillId),
    );
  }

  /**
   * Export a discovery manifest — the complete registry as a single JSON document.
   * This can be served at /.well-known/agent-manifest.json for A2A discovery.
   */
  exportManifest(): A2ADiscoveryManifest {
    return {
      version: '1.0',
      agents: Array.from(this.cards.values()),
      exportedAt: new Date().toISOString(),
    };
  }

  /**
   * Generate the .well-known/agent.json for a single agent.
   * This follows the A2A spec: the card is served at /{agentId}/.well-known/agent.json
   */
  getAgentCardJSON(agentId: string): string | null {
    const card = this.cards.get(agentId);
    if (!card) return null;
    return JSON.stringify(card, null, 2);
  }
}
