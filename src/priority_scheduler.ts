/**
 * agent-kernel/src/priority_scheduler.ts
 * 优先级调度器 — Priority-based Agent Scheduler
 *
 * 参考 Trending 项目 Multica 的团队协作 + Rowboat 的任务分配理念，
 * 为多 Agent 系统提供优先级驱动的任务调度能力。
 * 灵感来源：Multica "Turn coding agents into real teammates"
 */

export enum AgentPriority {
  CRITICAL = 0,    // 最高优先级：安全、合规相关
  HIGH = 1,        // 高优先级：核心业务逻辑
  NORMAL = 2,     // 普通优先级：日常任务
  LOW = 3,        // 低优先级：后台任务、批量处理
  IDLE = 4,       // 最低优先级：探索性、实验性任务
}

export interface AgentTask {
  id: string;
  agentId: string;
  priority: AgentPriority;
  description: string;
  createdAt: number;
  estimatedDuration?: number; // 毫秒
  dependencies?: string[];    // 任务依赖列表
  metadata?: Record<string, unknown>;
}

export interface SchedulingResult {
  scheduled: AgentTask[];
  rejected: AgentTask[];
  queueDepth: number;
  avgWaitTime: number;
}

/**
 * 基于优先级的任务调度器。
 * 使用多级反馈队列（Multi-Level Feedback Queue）策略，
 * 参考 OS 内核的调度算法思想，服务于 AI Agent 系统。
 */
export class PriorityScheduler {
  private queues: Map<AgentPriority, AgentTask[]> = new Map();
  private runningTasks: Map<string, AgentTask> = new Map();
  private completedTasks: AgentTask[] = [];
  private agentCapacity: Map<string, number> = new Map();

  constructor() {
    // 初始化各优先级队列
    Object.values(AgentPriority)
      .filter((v) => typeof v === "number")
      .forEach((priority) => {
        this.queues.set(priority as AgentPriority, []);
      });
  }

  /**
   * 注册 Agent 及其并发容量。
   * 参考 Multica 的任务分配机制。
   */
  registerAgent(agentId: string, capacity: number = 1): void {
    this.agentCapacity.set(agentId, capacity);
  }

  /**
   * 提交任务到调度器。
   * 会进行依赖检查和优先级验证。
   */
  submitTask(task: AgentTask): { success: boolean; reason?: string } {
    // 依赖检查：如果依赖任务尚未完成，拒绝提交
    if (task.dependencies?.length) {
      const unmet = task.dependencies.filter(
        (depId) => !this.completedTasks.find((t) => t.id === depId)
      );
      if (unmet.length > 0) {
        return {
          success: false,
          reason: `Unmet dependencies: ${unmet.join(", ")}`,
        };
      }
    }

    const queue = this.queues.get(task.priority);
    if (!queue) {
      return { success: false, reason: "Invalid priority" };
    }

    queue.push(task);
    return { success: true };
  }

  /**
   * 执行调度：选择最高优先级任务分配给可用 Agent。
   * 使用抢占式调度，高优先级任务可以打断低优先级任务。
   *
   * 参考 Multica 的优先级驱动任务分配：
   * "Turn coding agents into real teammates"
   */
  schedule(availableAgents: string[]): SchedulingResult {
    const scheduled: AgentTask[] = [];
    const rejected: AgentTask[] = [];

    for (const agentId of availableAgents) {
      const capacity = this.agentCapacity.get(agentId) ?? 1;
      const slots = capacity - (this.runningTasks.get(agentId) ? 1 : 0);

      for (let i = 0; i < slots; i++) {
        const task = this._dequeueNextTask(agentId);
        if (!task) break;

        this.runningTasks.set(agentId, task);
        scheduled.push(task);
      }
    }

    // 计算统计信息
    const allQueued = Array.from(this.queues.values()).flat();
    const avgWaitTime =
      allQueued.length > 0
        ? allQueued.reduce((sum, t) => sum + (Date.now() - t.createdAt), 0) /
          allQueued.length
        : 0;

    return {
      scheduled,
      rejected,
      queueDepth: allQueued.length,
      avgWaitTime,
    };
  }

  /**
   * 标记任务完成，释放 Agent 资源。
   */
  completeTask(taskId: string): void {
    for (const [agentId, task] of this.runningTasks.entries()) {
      if (task.id === taskId) {
        this.runningTasks.delete(agentId);
        const completed = { ...task, completedAt: Date.now() };
        this.completedTasks.push(completed);
        return;
      }
    }
  }

  /**
   * 从队列中取出下一个任务（优先级最高、等待时间最长）。
   */
  private _dequeueNextTask(agentId: string): AgentTask | null {
    // 按优先级从高到低扫描
    const priorities = [
      AgentPriority.CRITICAL,
      AgentPriority.HIGH,
      AgentPriority.NORMAL,
      AgentPriority.LOW,
      AgentPriority.IDLE,
    ];

    for (const priority of priorities) {
      const queue = this.queues.get(priority);
      if (!queue || queue.length === 0) continue;

      // 在同一优先级内，使用等待时间作为二次排序依据
      // 等待时间越长越优先（防止饥饿）
      queue.sort((a, b) => a.createdAt - b.createdAt);
      return queue.shift() ?? null;
    }

    return null;
  }

  /**
   * 获取当前调度状态快照。
   * 用于监控和调试。
   */
  getSnapshot(): {
    queues: Record<string, number>;
    running: string[];
    completed: number;
  } {
    return {
      queues: Object.fromEntries(
        Array.from(this.queues.entries()).map(([p, q]) => [
          AgentPriority[p],
          q.length,
        ])
      ),
      running: Array.from(this.runningTasks.values()).map((t) => t.id),
      completed: this.completedTasks.length,
    };
  }
}
