/**
 * Reasoning model routing with complexity detection (Issue #7).
 *
 * Routes tasks to the cheapest sufficient model based on detected complexity,
 * avoiding the 100x cost of reasoning models for trivial tasks.
 */

export type ModelTier = 'fast' | 'standard' | 'reasoning';

export interface ModelRoute {
  tier: ModelTier;
  model: string;
  complexity: number;   // 0-1
  confidence: number;   // 0-1
}

export interface ModelRouterConfig {
  models: Record<ModelTier, string>;
  autoDetect?: boolean;
  thresholds?: { standard: number; reasoning: number };
}

const DEFAULT_MODELS: Record<ModelTier, string> = {
  fast: 'gpt-4o-mini',
  standard: 'claude-3.5-haiku',
  reasoning: 'claude-3.7-sonnet',
};

const DEFAULT_THRESHOLDS = { standard: 0.4, reasoning: 0.7 };

// Heuristic complexity signals
const COMPLEXITY_SIGNALS: Array<{ regex: RegExp; weight: number; label: string }> = [
  { regex: /\b(prove|proof|derive|formal|theorem)\b/i, weight: 0.9, label: 'formal-reasoning' },
  { regex: /\b(design|architecture|strategy|plan|migration|refactor)\b/i, weight: 0.7, label: 'design' },
  { regex: /\b(multi-step|step-by-step|analyze|compare|evaluate|research)\b/i, weight: 0.5, label: 'analysis' },
  { regex: /\b(debug|fix|why|explain|reason)\b/i, weight: 0.4, label: 'diagnostic' },
  { regex: /\b(or|both|versus|vs\.|trade-off|tradeoff)\b/i, weight: 0.3, label: 'comparison' },
];

export class ModelRouter {
  private readonly config: Required<ModelRouterConfig>;

  constructor(config: ModelRouterConfig) {
    this.config = {
      models: { ...DEFAULT_MODELS, ...config.models },
      autoDetect: config.autoDetect ?? true,
      thresholds: { ...DEFAULT_THRESHOLDS, ...config.thresholds },
    };
  }

  /**
   * Detect task complexity (0-1) from the input text.
   */
  detectComplexity(input: string): { complexity: number; signals: string[] } {
    const text = typeof input === 'string' ? input : JSON.stringify(input);
    const matched: string[] = [];
    let score = 0;
    let totalWeight = 0;
    for (const signal of COMPLEXITY_SIGNALS) {
      if (signal.regex.test(text)) {
        matched.push(signal.label);
        score += signal.weight;
        totalWeight += 1;
      }
    }
    // Word count contributes a small baseline
    const words = text.split(/\s+/).filter(Boolean).length;
    if (words > 200) {
      score += 0.3;
      totalWeight += 1;
      matched.push('long-input');
    }

    const complexity = totalWeight === 0 ? 0.1 : Math.min(1, score / Math.max(totalWeight, 1));
    return { complexity, signals: matched };
  }

  /**
   * Route a task to a model tier based on detected complexity.
   */
  route(input: string, options: { tier?: ModelTier } = {}): ModelRoute {
    if (options.tier) {
      return {
        tier: options.tier,
        model: this.config.models[options.tier],
        complexity: options.tier === 'reasoning' ? 1 : options.tier === 'standard' ? 0.5 : 0.1,
        confidence: 1,
      };
    }

    if (!this.config.autoDetect) {
      return { tier: 'standard', model: this.config.models.standard, complexity: 0.5, confidence: 0.5 };
    }

    const { complexity } = this.detectComplexity(input);
    let tier: ModelTier;
    if (complexity >= this.config.thresholds.reasoning) tier = 'reasoning';
    else if (complexity >= this.config.thresholds.standard) tier = 'standard';
    else tier = 'fast';

    return { tier, model: this.config.models[tier], complexity, confidence: complexity };
  }

  /**
   * Route a batch and summarize the tier distribution.
   */
  routeBatch(inputs: string[]): { routes: ModelRoute[]; distribution: Record<ModelTier, number> } {
    const routes = inputs.map((i) => this.route(i));
    const distribution: Record<ModelTier, number> = { fast: 0, standard: 0, reasoning: 0 };
    for (const r of routes) distribution[r.tier]++;
    return { routes, distribution };
  }
}
