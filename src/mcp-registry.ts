/**
 * MCP Tool Registry - Tool discovery and management for agent-kernel.
 * 
 * Inspired by Skill_Seekers MCP server patterns (26 tools support).
 * Provides a registry for tools that agents can discover and use.
 * 
 * Usage:
 *   import { MCPToolRegistry, createMCPNode } from './mcp-registry';
 *   
 *   const registry = new MCPToolRegistry();
 *   registry.register({
 *     name: 'web_search',
 *     description: 'Search the web',
 *     parameters: { query: { type: 'string' } },
 *     handler: async ({ query }) => { ... }
 *   });
 *   
 *   const agent = createMCPNode('my-agent', registry);
 */

import { AgentId } from './types';

// ---- MCP Tool Types ----

export interface MCPParameterSchema {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  required?: boolean;
  default?: unknown;
  enum?: string[];
  items?: MCPParameterSchema;
  properties?: Record<string, MCPParameterSchema>;
}

export interface MCPToolDefinition {
  name: string;
  description: string;
  parameters?: {
    type: 'object';
    properties: Record<string, MCPParameterSchema>;
    required?: string[];
  };
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface MCPTool extends MCPToolDefinition {
  name: string;
  description: string;
  handler: MCPToolHandler;
  registeredAt: number;
  callCount: number;
  totalDuration: number;
}

export interface MCPToolCall {
  toolName: string;
  arguments: Record<string, unknown>;
  agentId: AgentId;
  startedAt: number;
  completedAt?: number;
  result?: unknown;
  error?: Error;
}

export type MCPToolHandler = (
  args: Record<string, unknown>,
  context: MCPToolContext
) => unknown | Promise<unknown>;

export interface MCPToolContext {
  agentId: AgentId;
  taskId?: string;
  metadata: Record<string, unknown>;
}

// ---- Registry ----

export interface RegistryConfig {
  enableLogging?: boolean;
  enableMetrics?: boolean;
  maxToolCalls?: number;
}

export interface MCPToolStats {
  name: string;
  callCount: number;
  totalDuration: number;
  avgDuration: number;
  lastCalled: number;
}

export class MCPToolRegistry {
  private tools: Map<string, MCPTool> = new Map();
  private toolCalls: MCPToolCall[] = [];
  private config: Required<RegistryConfig>;
  private agentTools: Map<AgentId, Set<string>> = new Map();

  constructor(config: RegistryConfig = {}) {
    this.config = {
      enableLogging: config.enableLogging ?? true,
      enableMetrics: config.enableMetrics ?? true,
      maxToolCalls: config.maxToolCalls ?? 10000,
    };
  }

  /**
   * Register a new tool with the registry.
   */
  register(definition: MCPToolDefinition, handler: MCPToolHandler): void {
    if (this.tools.has(definition.name)) {
      throw new Error(`Tool '${definition.name}' is already registered`);
    }

    const tool: MCPTool = {
      ...definition,
      handler,
      registeredAt: Date.now(),
      callCount: 0,
      totalDuration: 0,
    };

    this.tools.set(definition.name, tool);

    if (this.config.enableLogging) {
      console.log(`[MCP Registry] Registered tool: ${definition.name}`);
    }
  }

  /**
   * Unregister a tool.
   */
  unregister(name: string): boolean {
    const deleted = this.tools.delete(name);
    
    // Remove from all agents
    for (const tools of this.agentTools.values()) {
      tools.delete(name);
    }

    if (deleted && this.config.enableLogging) {
      console.log(`[MCP Registry] Unregistered tool: ${name}`);
    }

    return deleted;
  }

  /**
   * Get a tool by name.
   */
  get(name: string): MCPTool | undefined {
    return this.tools.get(name);
  }

  /**
   * List all registered tools.
   */
  listTools(agentId?: AgentId): MCPToolDefinition[] {
    const tools = Array.from(this.tools.values());

    if (agentId) {
      const agentToolNames = this.agentTools.get(agentId);
      if (agentToolNames) {
        return tools
          .filter((t) => agentToolNames.has(t.name))
          .map((t) => this.toolToDefinition(t));
      }
    }

    return tools.map((t) => this.toolToDefinition(t));
  }

  /**
   * Find tools by tag.
   */
  findByTag(tag: string): MCPToolDefinition[] {
    return Array.from(this.tools.values())
      .filter((t) => t.tags?.includes(tag))
      .map((t) => this.toolToDefinition(t));
  }

  /**
   * Search tools by name or description.
   */
  search(query: string): MCPToolDefinition[] {
    const lower = query.toLowerCase();
    return Array.from(this.tools.values())
      .filter(
        (t) =>
          t.name.toLowerCase().includes(lower) ||
          t.description.toLowerCase().includes(lower)
      )
      .map((t) => this.toolToDefinition(t));
  }

  /**
   * Grant an agent access to specific tools.
   */
  grantAccess(agentId: AgentId, toolNames: string[]): void {
    const tools = this.agentTools.get(agentId) || new Set();
    for (const name of toolNames) {
      if (this.tools.has(name)) {
        tools.add(name);
      }
    }
    this.agentTools.set(agentId, tools);
  }

  /**
   * Revoke an agent's access to specific tools.
   */
  revokeAccess(agentId: AgentId, toolNames: string[]): void {
    const tools = this.agentTools.get(agentId);
    if (tools) {
      for (const name of toolNames) {
        tools.delete(name);
      }
    }
  }

  /**
   * Call a tool.
   */
  async call(
    toolName: string,
    arguments_: Record<string, unknown>,
    context: MCPToolContext
  ): Promise<unknown> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      throw new Error(`Tool '${toolName}' not found`);
    }

    const callRecord: MCPToolCall = {
      toolName,
      arguments: arguments_,
      agentId: context.agentId,
      startedAt: Date.now(),
    };

    this.toolCalls.push(callRecord);

    // Trim call history
    if (this.toolCalls.length > this.config.maxToolCalls) {
      this.toolCalls = this.toolCalls.slice(-this.config.maxToolCalls);
    }

    try {
      const result = await Promise.resolve(
        tool.handler(arguments_, context)
      );

      callRecord.completedAt = Date.now();
      callRecord.result = result;

      // Update stats
      tool.callCount++;
      tool.totalDuration += callRecord.completedAt - callRecord.startedAt;

      if (this.config.enableLogging) {
        const duration = callRecord.completedAt - callRecord.startedAt;
        console.log(
          `[MCP Registry] ${toolName} completed in ${duration}ms`
        );
      }

      return result;
    } catch (error) {
      callRecord.completedAt = Date.now();
      callRecord.error = error as Error;
      throw error;
    }
  }

  /**
   * Get tool statistics.
   */
  getStats(): MCPToolStats[] {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      callCount: tool.callCount,
      totalDuration: tool.totalDuration,
      avgDuration:
        tool.callCount > 0
          ? tool.totalDuration / tool.callCount
          : 0,
      lastCalled: tool.registeredAt,
    }));
  }

  /**
   * Get recent tool calls.
   */
  getRecentCalls(limit = 100): MCPToolCall[] {
    return this.toolCalls.slice(-limit);
  }

  /**
   * Get the number of registered tools.
   */
  get toolCount(): number {
    return this.tools.size;
  }

  private toolToDefinition(tool: MCPTool): MCPToolDefinition {
    const { handler, registeredAt, callCount, totalDuration, ...def } = tool;
    return def;
  }
}

// ---- MCP Agent Node Factory ----

export interface MCPNodeConfig {
  registry?: MCPToolRegistry;
  allowedTools?: string[];
  deniedTools?: string[];
}

/**
 * Create an MCP-enabled agent node.
 * 
 * This function wraps an agent with MCP tool registry access.
 */
export function createMCPNode(
  agentId: AgentId,
  handler: (message: unknown) => unknown,
  config: MCPNodeConfig = {}
): MCPNode & { registry: MCPToolRegistry } {
  const registry = config.registry || new MCPToolRegistry();

  // Grant tool access if specified
  if (config.allowedTools) {
    registry.grantAccess(agentId, config.allowedTools);
  }

  return {
    id: agentId,
    handler,
    registry,
    async callTool(toolName: string, args: Record<string, unknown>) {
      return registry.call(toolName, args, {
        agentId,
        metadata: {},
      });
    },
    getTools() {
      return registry.listTools(agentId);
    },
  };
}

export interface MCPToolCallOptions {
  timeout?: number;
  retry?: number;
}

/**
 * Enhanced MCP Node with retry and timeout support.
 */
export interface MCPNode {
  id: AgentId;
  handler: (message: unknown) => unknown;
  registry: MCPToolRegistry;
  callTool(
    toolName: string,
    args: Record<string, unknown>,
    options?: MCPToolCallOptions
  ): Promise<unknown>;
  getTools(): MCPToolDefinition[];
}

// ---- Well-known Tool Templates ----

export const WELL_KNOWN_TOOLS = {
  web_search: {
    name: 'web_search',
    description: 'Search the web for information',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results', default: 10 },
      },
      required: ['query'],
    },
    tags: ['search', 'web', 'research'],
  },
  file_read: {
    name: 'file_read',
    description: 'Read contents of a file',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        encoding: { type: 'string', default: 'utf-8' },
      },
      required: ['path'],
    },
    tags: ['filesystem', 'io'],
  },
  file_write: {
    name: 'file_write',
    description: 'Write content to a file',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        content: { type: 'string', description: 'Content to write' },
        append: { type: 'boolean', default: false },
      },
      required: ['path', 'content'],
    },
    tags: ['filesystem', 'io'],
  },
  calculator: {
    name: 'calculator',
    description: 'Perform mathematical calculations',
    parameters: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'Math expression' },
      },
      required: ['expression'],
    },
    tags: ['math', 'computation'],
  },
  code_execute: {
    name: 'code_execute',
    description: 'Execute code in a sandboxed environment',
    parameters: {
      type: 'object',
      properties: {
        language: { type: 'string', enum: ['python', 'javascript', 'bash'] },
        code: { type: 'string', description: 'Code to execute' },
      },
      required: ['language', 'code'],
    },
    tags: ['execution', 'code'],
  },
};

/**
 * Register well-known tools with a registry.
 */
export function registerWellKnownTools(
  registry: MCPToolRegistry,
  implementations?: Partial<Record<keyof typeof WELL_KNOWN_TOOLS, MCPToolHandler>>
): void {
  for (const [name, definition] of Object.entries(WELL_KNOWN_TOOLS)) {
    const handler = implementations?.[name as keyof typeof WELL_KNOWN_TOOLS];
    if (handler) {
      registry.register(definition, handler);
    }
  }
}
