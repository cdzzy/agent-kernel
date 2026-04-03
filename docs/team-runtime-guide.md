# agent-kernel 团队运行时实战指南

> 对齐今日 Trending 项目中“Agent 团队编排”“实时可视化观察”“运行时调度治理”三类最佳实践。

## 本文解决什么问题

当一个多 Agent 系统开始包含 planner、coder、reviewer、tool-runner 等角色后，仅有调度器还不够。你还需要回答：

- 谁在运行，谁在等待
- 哪个任务占住了资源
- 为什么会阻塞或饿死
- 哪个 agent 当前最忙
- 出问题时怎么快速定位

这也是 `KernelCli` 之类实时观测能力真正有价值的地方。

## 推荐的团队运行时模型

### 1. 任务拆分

建议每个任务都具备：

- `task_id`
- `priority`
- `owner_agent`
- `depends_on`
- `resource_requirements`
- `deadline`

### 2. Agent 状态

建议运行时始终能区分：

- idle
- scheduled
- running
- waiting_io
- blocked
- failed

### 3. 资源维度

除了 CPU/并发槽位，Agent 系统通常还要管理：

- 模型调用配额
- 外部 API 速率限制
- 文件系统访问令牌
- 高优先级任务保留容量

## CLI 观察面板建议

如果仓库已经有 `KernelCli`，建议默认至少提供 4 个观察视图：

### status

显示总体健康度：

- uptime
- 运行中任务数
- 排队任务数
- 失败任务数
- 活跃 agent 数量

### top

显示当前最耗资源的任务：

- task_id
- agent
- priority
- running_duration
- waiting_reason

### agents

显示 agent 维度状态：

- 当前负载
- 最近失败数
- 可用能力标签
- 最近一次心跳

### queues

显示队列堆积情况：

- 各优先级队列长度
- 平均等待时间
- 重试中的任务数量

## 调度建议

### 避免高优先级饿死低优先级

即使支持抢占，也建议加入：

- aging
- 最低服务份额
- 最大连续抢占次数

### 对长任务做切片

参考今日趋势项目里的 Agent 团队模式，长任务不要一直独占执行槽位，建议拆成可汇报进度的小步任务。

### 对失败任务做分类

至少区分：

- transient error
- dependency failure
- policy blocked
- timeout
- resource exhausted

不同类别应该对应不同重试策略。

## 今日可继续补强的方向

- 增加 `docs/scheduling-strategies.md`
- 增加 `examples/team-runtime.ts`
- 增加队列堆积排查手册
- 增加优先级与资源配额的默认策略说明
