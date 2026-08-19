/**
 * Hierarchical task decomposition with dependency graph (Issue #9).
 *
 * Breaks a high-level task into subtasks with dependencies, and renders the
 * resulting dependency graph as Mermaid / DOT / JSON for visualization.
 */

export interface SubTask {
  id: string;
  name: string;
  estimatedMinutes: number;
  dependsOn: string[];
  depth: number;
}

export interface DecompositionResult {
  rootId: string;
  rootName: string;
  subtasks: SubTask[];
}

export interface DecompositionConfig {
  maxDepth?: number;
  minTaskSizeMinutes?: number; // don't decompose below this
}

const DEFAULT_CONFIG: Required<DecompositionConfig> = {
  maxDepth: 5,
  minTaskSizeMinutes: 5,
};

export class TaskDecomposer {
  private readonly config: Required<DecompositionConfig>;

  constructor(config: DecompositionConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Decompose a task description into subtasks using a simple heuristic.
   * Production deployments can plug in an LLM for smarter decomposition.
   */
  decompose(task: string): DecompositionResult {
    const rootId = 'root';
    const subtasks: SubTask[] = [];
    const words = task.split(/\s+/).filter(Boolean).length;
    const estimatedTotal = Math.max(5, Math.round(words / 20) * 5);

    // Heuristic: split into research / analysis / synthesis / writing phases
    const phases = [
      { id: 'research', name: 'Research', weight: 0.4 },
      { id: 'analysis', name: 'Analysis', weight: 0.2 },
      { id: 'synthesis', name: 'Synthesis', weight: 0.2 },
      { id: 'writing', name: 'Write & Review', weight: 0.2 },
    ];

    let prevId: string | null = null;
    for (const phase of phases) {
      const minutes = Math.max(
        this.config.minTaskSizeMinutes,
        Math.round(estimatedTotal * phase.weight),
      );
      subtasks.push({
        id: phase.id,
        name: phase.name,
        estimatedMinutes: minutes,
        dependsOn: prevId ? [prevId] : [],
        depth: 1,
      });
      prevId = phase.id;
    }

    return { rootId, rootName: task, subtasks };
  }

  /** Render the dependency graph as a Mermaid diagram. */
  toMermaid(result: DecompositionResult): string {
    const lines = ['graph TD'];
    lines.push(`  ${result.rootId}[${sanitize(result.rootName)}]`);
    for (const st of result.subtasks) {
      lines.push(`  ${st.id}[${st.name} (${st.estimatedMinutes}m)]`);
    }
    for (const st of result.subtasks) {
      const parents = st.dependsOn.length > 0 ? st.dependsOn : [result.rootId];
      for (const parent of parents) {
        lines.push(`  ${parent} --> ${st.id}`);
      }
    }
    return lines.join('\n');
  }

  /** Render the dependency graph in Graphviz DOT format. */
  toDot(result: DecompositionResult): string {
    const lines = ['digraph task_graph {'];
    lines.push(`  "${result.rootId}" [label="${sanitize(result.rootName)}"];`);
    for (const st of result.subtasks) {
      lines.push(`  "${st.id}" [label="${st.name} (${st.estimatedMinutes}m)"];`);
    }
    for (const st of result.subtasks) {
      const parents = st.dependsOn.length > 0 ? st.dependsOn : [result.rootId];
      for (const parent of parents) {
        lines.push(`  "${parent}" -> "${st.id}";`);
      }
    }
    lines.push('}');
    return lines.join('\n');
  }

  /** Export the decomposition as plain JSON. */
  toJSON(result: DecompositionResult): string {
    return JSON.stringify(result, null, 2);
  }
}

function sanitize(s: string): string {
  return s.replace(/[[\]{}()"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
}
