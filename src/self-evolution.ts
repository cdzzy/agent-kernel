// ============================================================
// AgentKernel - Self-Evolving Agent Support
// Adaptive learning and self-improvement capabilities
// Inspired by hermes-agent's self-evolution pattern
// ============================================================

import { EventEmitter } from 'node:events';

// ---- Types ----

export type LearningEventType =
  | 'feedback_received'
  | 'strategy_updated'
  | 'performance_evaluated'
  | 'adaptation_applied';

export interface FeedbackEntry {
  id: string;
  agentId: string;
  taskId: string;
  outcome: 'success' | 'failure' | 'partial';
  score: number;             // 0-1
  context: Record<string, unknown>;
  strategyUsed: string;
  feedback: string;
  timestamp: number;
}

export interface Strategy {
  id: string;
  name: string;
  description: string;
  conditions: StrategyCondition[];
  parameters: Record<string, unknown>;
  performanceScore: number;   // rolling average 0-1
  usageCount: number;
  successCount: number;
  lastUpdated: number;
}

export interface StrategyCondition {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'contains' | 'regex';
  value: unknown;
}

export interface AdaptationRecord {
  id: string;
  agentId: string;
  timestamp: number;
  trigger: string;
  oldStrategy: string;
  newStrategy: string;
  reason: string;
  improvement: number;
}

export interface SelfEvolutionConfig {
  /** Minimum feedback entries before attempting adaptation */
  minFeedbackEntries: number;
  /** Performance threshold below which adaptation is triggered */
  adaptationThreshold: number;
  /** Maximum strategies per agent */
  maxStrategiesPerAgent: number;
  /** Whether to auto-apply adaptations */
  autoAdapt: boolean;
  /** Decay factor for old feedback (0-1, per hour) */
  feedbackDecayPerHour: number;
}

export const DEFAULT_SELF_EVOLUTION_CONFIG: SelfEvolutionConfig = {
  minFeedbackEntries: 10,
  adaptationThreshold: 0.6,
  maxStrategiesPerAgent: 50,
  autoAdapt: false,
  feedbackDecayPerHour: 0.1,
};

// ---- Events ----

export interface SelfEvolutionEvents {
  'feedback:received': (entry: FeedbackEntry) => void;
  'strategy:updated': (strategy: Strategy, delta: number) => void;
  'performance:evaluated': (agentId: string, score: number) => void;
  'adaptation:applied': (record: AdaptationRecord) => void;
}

export class TypedEventEmitter extends EventEmitter {
  override emit<K extends keyof SelfEvolutionEvents>(
    event: K, ...args: Parameters<SelfEvolutionEvents[K]>
  ): boolean;
  override emit(event: string, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }

  override on<K extends keyof SelfEvolutionEvents>(
    event: K, listener: SelfEvolutionEvents[K]
  ): this;
  override on(event: string, listener: (...args: unknown[]) => void): this {
    return super.on(event, listener);
  }

  override off<K extends keyof SelfEvolutionEvents>(
    event: K, listener: SelfEvolutionEvents[K]
  ): this;
  override off(event: string, listener: (...args: unknown[]) => void): this {
    return super.off(event, listener);
  }
}

// ---- SelfEvolutionManager ----

export class SelfEvolutionManager {
  private feedback: Map<string, FeedbackEntry[]> = new Map();   // agentId → entries
  private strategies: Map<string, Strategy[]> = new Map();       // agentId → strategies
  private adaptations: AdaptationRecord[] = [];
  private config: SelfEvolutionConfig;
  private events: TypedEventEmitter;

  constructor(config?: Partial<SelfEvolutionConfig>) {
    this.config = { ...DEFAULT_SELF_EVOLUTION_CONFIG, ...config };
    this.events = new TypedEventEmitter();
  }

  // ---- Feedback ----

  /**
   * Record feedback from an agent execution.
   */
  recordFeedback(entry: FeedbackEntry): void {
    const entries = this.feedback.get(entry.agentId) || [];
    entries.push(entry);
    this.feedback.set(entry.agentId, entries);
    this.events.emit('feedback:received', entry);

    // Update strategy performance
    this._updateStrategyPerformance(entry);

    // Auto-adapt if enabled
    if (this.config.autoAdapt) {
      this.maybeAdapt(entry.agentId);
    }
  }

  /**
   * Get feedback history for an agent.
   */
  getFeedback(
    agentId: string,
    options?: { limit?: number; since?: number }
  ): FeedbackEntry[] {
    const entries = this.feedback.get(agentId) || [];
    let filtered = entries;

    if (options?.since) {
      filtered = filtered.filter(e => e.timestamp >= options.since!);
    }

    return options?.limit
      ? filtered.slice(-options.limit)
      : filtered;
  }

  // ---- Strategy Management ----

  /**
   * Register a new strategy for an agent.
   */
  registerStrategy(agentId: string, strategy: Strategy): void {
    const strats = this.strategies.get(agentId) || [];

    if (strats.length >= this.config.maxStrategiesPerAgent) {
      throw new Error(
        `Agent ${agentId} has reached max strategies (${this.config.maxStrategiesPerAgent})`
      );
    }

    strats.push(strategy);
    this.strategies.set(agentId, strats);
    this.events.emit('strategy:updated', strategy, 0);
  }

  /**
   * Select the best strategy for a given context.
   */
  selectStrategy(
    agentId: string,
    context: Record<string, unknown>
  ): Strategy | null {
    const strats = this.strategies.get(agentId) || [];
    if (strats.length === 0) return null;

    // Score each strategy by condition match and performance
    const scored = strats.map(s => ({
      strategy: s,
      conditionScore: this._matchScore(s.conditions, context),
      performanceScore: s.performanceScore,
    }));

    // Combined score: 60% condition match, 40% performance
    scored.sort((a, b) => {
      const scoreA = 0.6 * a.conditionScore + 0.4 * a.performanceScore;
      const scoreB = 0.6 * b.conditionScore + 0.4 * b.performanceScore;
      return scoreB - scoreA;
    });

    return scored[0].strategy;
  }

  /**
   * Get all strategies for an agent.
   */
  getStrategies(agentId: string): Strategy[] {
    return this.strategies.get(agentId) || [];
  }

  // ---- Performance Evaluation ----

  /**
   * Evaluate an agent's recent performance.
   */
  evaluatePerformance(agentId: string): number {
    const entries = this.feedback.get(agentId) || [];
    if (entries.length === 0) return 0.5;

    // Weighted average: recent feedback counts more
    const now = Date.now();
    const decayHour = this.config.feedbackDecayPerHour;
    let totalWeight = 0;
    let weightedScore = 0;

    for (const entry of entries) {
      const ageHours = (now - entry.timestamp) / 3_600_000;
      const weight = Math.exp(-decayHour * ageHours);
      weightedScore += entry.score * weight;
      totalWeight += weight;
    }

    const score = totalWeight > 0 ? weightedScore / totalWeight : 0.5;
    this.events.emit('performance:evaluated', agentId, score);
    return score;
  }

  // ---- Adaptation ----

  /**
   * Check if adaptation should be triggered, and apply if so.
   * Returns the adaptation record if applied, null otherwise.
   */
  maybeAdapt(agentId: string): AdaptationRecord | null {
    const entries = this.feedback.get(agentId) || [];
    if (entries.length < this.config.minFeedbackEntries) return null;

    const score = this.evaluatePerformance(agentId);
    if (score >= this.config.adaptationThreshold) return null;

    // Find the worst-performing strategy
    const strats = this.strategies.get(agentId) || [];
    if (strats.length === 0) return null;

    const worst = strats.reduce(
      (min, s) => s.performanceScore < min.performanceScore ? s : min,
      strats[0]
    );

    // Find the best-performing strategy as replacement
    const best = strats.reduce(
      (max, s) => s.performanceScore > max.performanceScore ? s : max,
      strats[0]
    );

    if (worst.id === best.id) return null;

    // Create adaptation record
    const record: AdaptationRecord = {
      id: `adapt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      agentId,
      timestamp: Date.now(),
      trigger: `performance_below_threshold (score=${score.toFixed(3)})`,
      oldStrategy: worst.name,
      newStrategy: best.name,
      reason: `Performance dropped below ${this.config.adaptationThreshold}. ` +
        `Switching from '${worst.name}' (${worst.performanceScore.toFixed(3)}) ` +
        `to '${best.name}' (${best.performanceScore.toFixed(3)}).`,
      improvement: best.performanceScore - worst.performanceScore,
    };

    this.adaptations.push(record);
    this.events.emit('adaptation:applied', record);
    return record;
  }

  // ---- Stats ----

  getStats(agentId?: string): Record<string, unknown> {
    if (agentId) {
      return {
        agentId,
        feedbackCount: (this.feedback.get(agentId) || []).length,
        strategyCount: (this.strategies.get(agentId) || []).length,
        adaptationCount: this.adaptations.filter(a => a.agentId === agentId).length,
        performanceScore: this.evaluatePerformance(agentId),
      };
    }

    return {
      totalAgents: this.feedback.size,
      totalFeedback: Array.from(this.feedback.values()).reduce((s, e) => s + e.length, 0),
      totalStrategies: Array.from(this.strategies.values()).reduce((s, e) => s + e.length, 0),
      totalAdaptations: this.adaptations.length,
    };
  }

  getAdaptationHistory(agentId?: string, limit = 20): AdaptationRecord[] {
    let records = this.adaptations;
    if (agentId) {
      records = records.filter(a => a.agentId === agentId);
    }
    return records.slice(-limit);
  }

  getEventEmitter(): TypedEventEmitter {
    return this.events;
  }

  // ---- Internal ----

  private _updateStrategyPerformance(entry: FeedbackEntry): void {
    const strats = this.strategies.get(entry.agentId) || [];
    const strategy = strats.find(s => s.id === entry.strategyUsed);
    if (!strategy) return;

    strategy.usageCount++;
    if (entry.outcome === 'success') {
      strategy.successCount++;
    }

    // Rolling average
    const alpha = 0.3; // learning rate
    strategy.performanceScore =
      (1 - alpha) * strategy.performanceScore +
      alpha * entry.score;

    strategy.lastUpdated = Date.now();
    this.events.emit('strategy:updated', strategy, entry.score - strategy.performanceScore);
  }

  private _matchScore(conditions: StrategyCondition[], context: Record<string, unknown>): number {
    if (conditions.length === 0) return 0.5; // neutral if no conditions

    let matches = 0;
    for (const cond of conditions) {
      const actual = context[cond.field];
      if (this._evalCondition(actual, cond.operator, cond.value)) {
        matches++;
      }
    }

    return matches / conditions.length;
  }

  private _evalCondition(actual: unknown, operator: string, expected: unknown): boolean {
    switch (operator) {
      case 'eq': return actual === expected;
      case 'neq': return actual !== expected;
      case 'gt': return Number(actual) > Number(expected);
      case 'lt': return Number(actual) < Number(expected);
      case 'contains': return String(actual).includes(String(expected));
      case 'regex': return new RegExp(String(expected)).test(String(actual));
      default: return false;
    }
  }
}
