import { defineConfig } from 'vitepress';

export default defineConfig({
  lang: 'en-US',
  title: 'Agent OS',
  description: 'Six libraries that together form a complete operating layer for multi-agent AI systems — kernel, network, memory, policy, audit, and testing.',
  base: '/agent-kernel/',
  ignoreDeadLinks: true,
  themeConfig: {
    siteTitle: 'Agent OS',
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Architecture', link: '/architecture' },
      { text: 'Packages', link: '/packages/agent-kernel' },
    ],
    sidebar: [
      {
        text: 'Getting Started',
        items: [
          { text: 'Overview', link: '/guide/overview' },
          { text: 'Quick Start', link: '/guide/getting-started' },
          { text: 'Flagship Example', link: '/guide/flagship' },
        ],
      },
      {
        text: 'Packages',
        items: [
          { text: 'agent-kernel', link: '/packages/agent-kernel' },
          { text: 'agentlink', link: '/packages/agentlink' },
          { text: 'engram', link: '/packages/engram' },
          { text: 'agentconfig', link: '/packages/agentconfig' },
          { text: 'traceshield', link: '/packages/traceshield' },
          { text: 'agenttest', link: '/packages/agenttest' },
        ],
      },
      {
        text: 'Architecture',
        items: [
          { text: 'Agent OS Stack', link: '/architecture/agent-os' },
          { text: 'Integrations', link: '/architecture/integrations' },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/cdzzy' },
    ],
  },
});
