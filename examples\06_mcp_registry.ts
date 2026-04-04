/**
 * Example: MCP Tool Registry for agent-kernel.
 * 
 * This example demonstrates how to use the MCP Tool Registry
 * to manage and discover tools for agents.
 * 
 * Inspired by Skill_Seekers MCP server patterns.
 * 
 * Usage:
 *   npx ts-node examples/06_mcp_registry.ts
 */

import {
  MCPToolRegistry,
  createMCPNode,
  registerWellKnownTools,
} from '../src/mcp-registry';

async function exampleBasicRegistry() {
  console.log('='.repeat(60));
  console.log('Example: Basic MCP Tool Registry');
  console.log('='.repeat(60));

  // Create registry
  const registry = new MCPToolRegistry({
    enableLogging: true,
    enableMetrics: true,
  });

  // Register custom tools
  registry.register(
    {
      name: 'web_search',
      description: 'Search the web for information',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number', default: 10 },
        },
        required: ['query'],
      },
      tags: ['search', 'web'],
    },
    async ({ query, limit = 10 }) => {
      // Simulated search result
      return {
        query,
        results: [
          { title: `Result 1 for "${query}"`, url: 'https://example.com/1' },
          { title: `Result 2 for "${query}"`, url: 'https://example.com/2' },
        ].slice(0, limit),
        total: 2,
      };
    }
  );

  registry.register(
    {
      name: 'get_weather',
      description: 'Get current weather for a location',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'City name' },
          unit: { type: 'string', enum: ['celsius', 'fahrenheit'], default: 'celsius' },
        },
        required: ['city'],
      },
      tags: ['weather', 'api'],
    },
    async ({ city, unit = 'celsius' }) => {
      // Simulated weather
      const temp = unit === 'celsius' ? 22 : 72;
      return { city, temperature: temp, unit, condition: 'Sunny' };
    }
  );

  console.log('\n1. Registered Tools:');
  const tools = registry.listTools();
  tools.forEach((tool) => {
    console.log(`   - ${tool.name}: ${tool.description}`);
  });

  console.log('\n2. Tool Count:', registry.toolCount);

  return registry;
}

async function exampleToolDiscovery(registry: MCPToolRegistry) {
  console.log('\n' + '='.repeat(60));
  console.log('Example: Tool Discovery');
  console.log('='.repeat(60));

  // Search tools
  console.log('\n1. Search for "search":');
  const searchResults = registry.search('search');
  searchResults.forEach((t) => console.log(`   - ${t.name}`));

  // Find by tag
  console.log('\n2. Find tools with tag "web":');
  const webTools = registry.findByTag('web');
  webTools.forEach((t) => console.log(`   - ${t.name}`));

  // Get tool definition
  console.log('\n3. Get tool definition:');
  const webSearchTool = registry.get('web_search');
  if (webSearchTool) {
    console.log(`   Name: ${webSearchTool.name}`);
    console.log(`   Description: ${webSearchTool.description}`);
    console.log(`   Parameters:`, webSearchTool.parameters);
  }
}

async function exampleToolCalls(registry: MCPToolRegistry) {
  console.log('\n' + '='.repeat(60));
  console.log('Example: Calling Tools');
  console.log('='.repeat(60));

  const context = {
    agentId: 'agent-001',
    metadata: { taskId: 'task-123' },
  };

  // Call web_search
  console.log('\n1. Calling web_search tool:');
  try {
    const result = await registry.call('web_search', { query: 'AI trends 2026', limit: 5 }, context);
    console.log('   Result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('   Error:', error);
  }

  // Call get_weather
  console.log('\n2. Calling get_weather tool:');
  try {
    const result = await registry.call('get_weather', { city: 'San Francisco', unit: 'celsius' }, context);
    console.log('   Result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('   Error:', error);
  }

  // Call non-existent tool
  console.log('\n3. Calling non-existent tool:');
  try {
    await registry.call('nonexistent', {}, context);
  } catch (error) {
    console.log('   Expected error:', (error as Error).message);
  }
}

async function exampleAgentAccess(registry: MCPToolRegistry) {
  console.log('\n' + '='.repeat(60));
  console.log('Example: Agent Tool Access Control');
  console.log('='.repeat(60));

  // Grant access to specific tools for an agent
  console.log('\n1. Granting tool access:');
  registry.grantAccess('agent-001', ['web_search', 'get_weather']);
  registry.grantAccess('agent-002', ['get_weather']);

  // List tools for each agent
  console.log('\n2. Tools for agent-001:');
  const agent1Tools = registry.listTools('agent-001');
  agent1Tools.forEach((t) => console.log(`   - ${t.name}`));

  console.log('\n3. Tools for agent-002:');
  const agent2Tools = registry.listTools('agent-002');
  agent2Tools.forEach((t) => console.log(`   - ${t.name}`));

  // Revoke access
  console.log('\n4. Revoking access:');
  registry.revokeAccess('agent-001', ['get_weather']);
  const updatedTools = registry.listTools('agent-001');
  console.log(`   agent-001 now has ${updatedTools.length} tool(s)`);
}

async function exampleWellKnownTools() {
  console.log('\n' + '='.repeat(60));
  console.log('Example: Well-Known Tools');
  console.log('='.repeat(60));

  const registry = new MCPToolRegistry();

  // Implement well-known tools
  registerWellKnownTools(registry, {
    calculator: async ({ expression }) => {
      // Simple calculator (be careful with eval in production!)
      try {
        // Safe evaluation using Function
        const result = new Function(`return ${expression}`)();
        return { expression, result };
      } catch (e) {
        return { expression, error: (e as Error).message };
      }
    },
  });

  console.log('\n1. Registered well-known tools:');
  const tools = registry.listTools();
  tools.forEach((t) => console.log(`   - ${t.name}`));

  console.log('\n2. Calling calculator:');
  const result = await registry.call(
    'calculator',
    { expression: '2 + 2 * 3' },
    { agentId: 'test-agent' }
  );
  console.log('   Result:', result);
}

async function exampleMCPNode() {
  console.log('\n' + '='.repeat(60));
  console.log('Example: MCP Node Creation');
  console.log('='.repeat(60));

  const registry = new MCPToolRegistry();

  // Register some tools
  registry.register(
    {
      name: 'summarize',
      description: 'Summarize text',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          maxLength: { type: 'number', default: 100 },
        },
        required: ['text'],
      },
    },
    async ({ text, maxLength = 100 }) => {
      return text.slice(0, maxLength) + (text.length > maxLength ? '...' : '');
    }
  );

  // Create MCP node
  const node = createMCPNode('my-agent', async (msg) => {
    return `Processed: ${msg}`;
  });

  // Grant tool access
  registry.grantAccess('my-agent', ['summarize']);

  console.log('\n1. Node created:');
  console.log(`   ID: ${node.id}`);
  console.log(`   Available tools: ${node.getTools().map((t) => t.name).join(', ')}`);

  console.log('\n2. Calling tool through node:');
  const result = await node.callTool('summarize', {
    text: 'This is a long text that needs to be summarized.',
    maxLength: 20,
  });
  console.log('   Result:', result);
}

async function exampleStats(registry: MCPToolRegistry) {
  console.log('\n' + '='.repeat(60));
  console.log('Example: Tool Statistics');
  console.log('='.repeat(60));

  // Make some calls to generate stats
  await registry.call('web_search', { query: 'test1' }, { agentId: 'agent-001' });
  await registry.call('web_search', { query: 'test2' }, { agentId: 'agent-002' });
  await registry.call('get_weather', { city: 'NYC' }, { agentId: 'agent-001' });

  console.log('\n1. Tool Statistics:');
  const stats = registry.getStats();
  stats.forEach((s) => {
    console.log(`   ${s.name}:`);
    console.log(`     Calls: ${s.callCount}`);
    console.log(`     Avg Duration: ${s.avgDuration.toFixed(2)}ms`);
  });

  console.log('\n2. Recent Calls:');
  const recent = registry.getRecentCalls(5);
  recent.forEach((c) => {
    const duration = c.completedAt ? c.completedAt - c.startedAt : 'pending';
    console.log(`   ${c.toolName} (${duration}ms) by ${c.agentId}`);
  });
}

// Run all examples
async function main() {
  console.log('\n🚀 MCP Tool Registry Examples\n');

  try {
    const registry = await exampleBasicRegistry();
    await exampleToolDiscovery(registry);
    await exampleToolCalls(registry);
    await exampleAgentAccess(registry);
    await exampleWellKnownTools();
    await exampleMCPNode();
    await exampleStats(registry);

    console.log('\n' + '='.repeat(60));
    console.log('✅ All MCP Registry examples completed!');
    console.log('='.repeat(60));
  } catch (error) {
    console.error('Error:', error);
  }
}

main();
