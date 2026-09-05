---
title: agenttest
---
﻿# agenttest 🧪

> Part of the [Agent OS](https://github.com/cdzzy/agent-kernel/blob/main/docs/agent-os.md) suite — kernel · network · memory · policy · audit · testing
[![PyPI](https://img.shields.io/pypi/v/cdzzy-agenttest?color=blue)](https://pypi.org/project/cdzzy-agenttest/)


**The testing framework for AI agents.**

Think `pytest` — but for agents.

---

Software engineering has unit tests, integration tests, and CI/CD pipelines. But when you build an AI agent, how do you test it? How do you know:

- Did the agent call the right tools in the right order?
- Is the output actually correct — not just non-empty?
- Will it still work correctly if you run it 10 times in a row?
- Did it reason through the problem, or just guess?

`agenttest` fills this gap. It's a lightweight, zero-dependency testing framework that gives agent engineers the primitives to write real tests for real agent behavior.

---

## Installation

```bash
pip install agenttest
```

Or install from source:

```bash
git clone https://github.com/cdzzy/agenttest
cd agenttest
pip install -e .
```

---

## Quick Start

```python
from agenttest import AgentTestCase, AgentTestSuite, AgentTestRunner

class MyAgentTests(AgentTestCase):
    agent = my_agent  # your agent callable

    def test_uses_search(self):
        run = self.invoke("What is the capital of France?")
        self.assert_tool_called(run, "web_search")
        self.assert_output_contains(run, "Paris")

    def test_no_error(self):
        run = self.invoke("Tell me a joke")
        self.assert_no_error(run)
        self.assert_output_length(run, min_chars=10)

suite = AgentTestSuite("My Agent")
suite.add_case(MyAgentTests)

runner = AgentTestRunner()
runner.run_suite(suite)
```

Output:
```
============================================================
  AgentTest — My Agent
  2 test(s) collected
============================================================

  ✅  MyAgentTests.test_uses_search  (142ms)
  ✅  MyAgentTests.test_no_error  (98ms)

============================================================
  ✅ 2 passed
  ⏱  Total time: 240ms
============================================================
```

---

## Core Concepts

### 1. `AgentRun` — The unit of inspection

Every time you invoke an agent, you get back an `AgentRun`:

```python
run = self.invoke("Search for Python tutorials")

run.output          # str: what the agent said
run.tool_calls      # list: all tool invocations [{name, input, output}, ...]
run.tool_names      # list[str]: just the names, in call order
run.reasoning_steps # list[str]: the agent's thought process
run.duration_ms     # float: how long it took
run.tokens_used     # int: token count (if reported)
run.error           # Exception | None
```

Your agent just needs to return a dict with these keys, or a plain string:

```python
def my_agent(input_text: str) -> dict:
    # ... run your agent ...
    return {
        "output": "The capital of France is Paris.",
        "tool_calls": [{"name": "web_search", "input": input_text, "output": "..."}],
        "reasoning_steps": ["I need to look this up.", "Found the answer."],
    }
```

---

### 2. Behavior Assertions — Did the agent do the right things?

```python
from agenttest.assertions.behavior import (
    assert_tool_called,
    assert_tool_sequence,
    assert_no_tool_called,
    assert_tool_called_before,
    assert_max_tool_calls,
)

# Was a tool called at all?
assert_tool_called(run, "web_search")

# Was it called exactly twice?
assert_tool_called(run, "web_search", times=2)

# Were tools called in the right order?
assert_tool_sequence(run, ["web_search", "summarize"])

# Strict mode: exactly these tools, exactly this order
assert_tool_sequence(run, ["search", "format"], strict=True)

# Was a dangerous tool NOT called?
assert_no_tool_called(run, "delete_database")

# Did search happen before summarization?
assert_tool_called_before(run, "web_search", "summarize")

# Did the agent stay within a reasonable tool budget?
assert_max_tool_calls(run, max_calls=10)
```

---

### 3. Output Assertions — Did the agent say the right thing?

```python
from agenttest.assertions.output import (
    assert_output_contains,
    assert_output_not_contains,
    assert_output_matches,
    assert_output_length,
    assert_output_contains_all,
    assert_output_json,
    assert_output_sentiment,
)

assert_output_contains(run, "Paris")
assert_output_not_contains(run, "I don't know")
assert_output_matches(run, r"\d{4}-\d{2}-\d{2}")  # ISO date
assert_output_length(run, min_chars=50, max_chars=2000)
assert_output_contains_all(run, ["name", "age", "email"])
assert_output_json(run)  # valid JSON
assert_output_json_schema(run, {"type": "object", "required": ["name", "email"]})  # schema validation
assert_output_sentiment(run, "positive")
```

---

### 4. Trace Assertions — Did the agent think correctly?

```python
from agenttest.assertions.trace import (
    assert_reasoning_step,
    assert_step_count,
    assert_no_reasoning_loops,
    assert_tool_reasoning_alignment,
)

# Does the reasoning mention the right thing?
assert_reasoning_step(run, "search for")

# Did the agent use a reasonable number of thoughts?
assert_step_count(run, min_steps=1, max_steps=5)

# Is the agent stuck in a loop?
assert_no_reasoning_loops(run)

# Did the agent justify its tool calls?
assert_tool_reasoning_alignment(run)
```

---

### 5. Stability Testing — Is the agent reliable?

```python
from agenttest.assertions.stability import StabilityAssertion

stability = StabilityAssertion(my_agent, runs=10, pass_rate=1.0)

# Run 10 times — should always contain "Paris"
stability.assert_consistent_output(
    "What is the capital of France?",
    check_fn=lambda run: "Paris" in run.output,
)

# Output should be identical every run (temperature=0)
stability.assert_output_deterministic("What is 6 * 7?")

# Same tools should be called every run
stability.assert_tool_usage_consistent("Search for Python docs")

# Just measure the pass rate
rate = stability.get_pass_rate("...", check_fn=lambda r: "answer" in r.output)
print(f"Pass rate: {rate*100:.0f}%")
```

---

### 6. Mock Tools — Test without side effects

```python
from agenttest import MockToolkit

toolkit = MockToolkit()
toolkit.add("web_search", returns="Paris is the capital of France.")
toolkit.add("send_email", returns="Email sent.")
toolkit.add("calculator", side_effect=lambda expr: str(eval(expr)))

# Inject into your agent
agent = MyAgent(tools=toolkit.as_dict())
agent("What is the capital of France?")

# Assert on tool usage
toolkit["web_search"].assert_called()
toolkit["send_email"].assert_not_called()  # shouldn't email anyone
assert toolkit["web_search"].call_count == 1
```

---

### 7. Scenario Builder — Batch test from data

```python
from agenttest import ScenarioBuilder

scenarios = (
    ScenarioBuilder()
    .add("Capital query")
        .input("What is the capital of France?")
        .expect_tools("web_search")
        .expect_output_contains("Paris")
        .done()
    .add("Math problem")
        .input("What is 6 * 7?")
        .expect_tools("calculator")
        .expect_output_contains("42")
        .done()
    .build()
)

# Load from files
scenarios = ScenarioBuilder.from_jsonl("test_cases.jsonl")
scenarios = ScenarioBuilder.from_csv("test_cases.csv")
```

---

## Decorator Style (pytest-like)

```python
from agenttest import agent_test

@agent_test(tags=["smoke"])
def test_basic(agent):
    run = agent("Hello!")
    assert run.output

@agent_test(repeat=5, tags=["stability"])  # run 5 times
def test_stable(agent):
    run = agent("What is 2+2?")
    assert "4" in run.output
```

---

## Agent Return Format

agenttest works with any agent that returns a dict or string:

```python
# Dict format (recommended — enables all assertions)
def my_agent(input_text: str) -> dict:
    return {
        "output": "...",              # required
        "tool_calls": [...],          # for behavior assertions
        "reasoning_steps": [...],     # for trace assertions
        "usage": {"total_tokens": 0}, # optional
    }

# String format (basic output assertions only)
def simple_agent(input_text: str) -> str:
    return "Hello!"
```

---

## Integrations

### LangChain / LangGraph

```python
from langchain_core.messages import HumanMessage

def wrap_langgraph(graph):
    def agent(input_text: str) -> dict:
        result = graph.invoke({"messages": [HumanMessage(content=input_text)]})
        return {
            "output": result["messages"][-1].content,
            "tool_calls": extract_tool_calls(result),
            "reasoning_steps": extract_thoughts(result),
        }
    return agent
```

### AutoGen

```python
def wrap_autogen(team):
    def agent(input_text: str) -> dict:
        result = team.run_sync(task=input_text)
        return {
            "output": result.messages[-1].content,
            "tool_calls": [m for m in result.messages if hasattr(m, "tool_calls")],
        }
    return agent
```

---

## Examples

```
examples/
  test_basic_agent.py      # Getting started
  test_stability.py        # Stability / reliability testing
  test_langgraph_agent.py  # LangGraph integration
  test_scenarios.py        # Scenario-driven batch testing
```

Run all examples:

```bash
python examples/test_basic_agent.py
python examples/test_stability.py
python examples/test_langgraph_agent.py
python examples/test_scenarios.py
```

---

## Roadmap

- [x] `agenttest` CLI (`agenttest edit --ui`, `agenttest --version`) ✅ (agenttest/cli.py, v0.2.0)
- [x] Async agent support (`async def`) ✅ (agenttest/core/runner.py, v0.2.0)
- [x] **Behavior snapshots** (regression testing) ✅ (agenttest/snapshots.py, v0.2.0)
- [x] **Benchmarking** (multi-model comparison) ✅ (agenttest/benchmark.py, v0.2.0)
- [x] **Chaos engineering** (resilience testing) ✅ (agenttest/chaos.py, v0.2.0)
- [x] **Flakiness detection** ✅ (agenttest/flakiness.py, v0.2.0)
- [x] **Suite run history** (pass-rate regression) ✅ (agenttest/core/history.py, v0.2.0)
- [x] **MCP server testing** ✅ (agenttest/mcp_tools.py, v0.2.0)
- [x] **Reasoning model assertions** ✅ (agenttest/assertions/trace.py, v0.2.0)
- [x] **Visual test editor** ✅ (agenttest/ui/editor.html, v0.2.0)
- [x] **GitHub Action** ✅ (action.yml, v0.2.0)
- [x] **HTML/JSON test reports** ✅ (agenttest/report.py, v0.3.0)
- [x] **Pytest plugin** (`pytest11` entry point — run `@agent_test` functions under vanilla pytest with the `agent` fixture) ✅ (v0.4.0)
- [x] ~~LLM-as-judge assertions~~ ✅ (examples/test_llm_judge.py)
- [x] ~~GitHub Actions template~~ ✅ (.github/workflows/ci.yml)
- [x] ~~YAML test configuration~~ ✅ (load tests from YAML files, inspired by PraisonAI)
- [x] **JSON Schema assertion** (validate structured agent output against JSON Schema draft-07, examples/test_json_schema.py)

---

## Contributing

PRs welcome. The goal is to keep agenttest simple, zero-dependency (for the core), and genuinely useful for production agent engineering.

```bash
git clone https://github.com/cdzzy/agenttest
cd agenttest
pip install -e ".[dev]"
python examples/test_basic_agent.py
```

---

## License

MIT

