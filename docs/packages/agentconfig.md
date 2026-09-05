---
title: agentconfig
---
# AgentConfig

> Part of the [Agent OS](https://github.com/cdzzy/agent-kernel/blob/main/docs/agent-os.md) suite — kernel · network · memory · policy · audit · testing
[![PyPI](https://img.shields.io/pypi/v/cdzzy-agentconfig?color=blue)](https://pypi.org/project/cdzzy-agentconfig/)


**The missing layer between business users and AI agents.**

> Business people know what they want their agent to do. They just shouldn't need to write Python to say it.

[![Tests](https://img.shields.io/badge/tests-179%20passed-brightgreen)](tests/)
[![Python](https://img.shields.io/badge/python-3.10%2B-blue)](pyproject.toml)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

---

## The Problem

Every AI agent configuration tool today is built for engineers. Dify, LangGraph, AutoGen — powerful, but they all require technical knowledge to configure an agent's behavior, constraints, and guardrails.

Business users know exactly what they want:
- *"This agent should never mention pricing"*
- *"Escalate when the customer seems angry"*
- *"Always ask for confirmation before canceling an order"*

But translating that into code requires an engineer. **AgentConfig removes that gap.**

---

## What It Does

AgentConfig lets business users describe agent behavior in plain language, then:

1. **Parses** the description into structured intent (domain, tone, forbidden topics, escalation triggers)
2. **Generates** a complete, executable `AgentConfig` with system prompt + constraint rules
3. **Enforces** constraints at runtime — blocking, warning, or escalating on violations
4. **Monitors** all agent activity through a real-time web dashboard

No LLM needed to configure. No code needed by business users.

---

## Quick Start

```bash
pip install flask
git clone https://github.com/cdzzy/agentconfig
cd agentconfig
python examples/02_web_ui.py
# Open http://localhost:7860
```

Or use the Python API directly:

```python
from agentconfig.semantic.intent import IntentParser
from agentconfig.semantic.config_gen import ConfigGenerator
from agentconfig.runtime.executor import AgentExecutor

# 1. Describe your agent in plain English
parser = IntentParser()
intent = parser.parse(
    """This agent handles customer complaints.
    It should be polite and empathetic.
    Never mention competitor products or internal pricing.
    Escalate when the customer asks for a manager.""",
    name="Support Bot"
)

# 2. Generate a full config
gen    = ConfigGenerator()
config = gen.generate(intent)

print(config.system_prompt)
# → You are Support Bot. This agent handles customer complaints.
# → Your communication style should be: professional.
# → Never discuss or mention: competitor products, internal pricing.
# → If any of these conditions arise, immediately tell the user a human
# → specialist will take over: the customer asks for a manager.

# 3. Run with constraint enforcement
executor = AgentExecutor()  # plug in your own LLM
response, record = executor.chat(config, "What's your profit margin?")
# → "I'm sorry, I can't help with that."  (blocked by constraint)
```

---

## Web UI

AgentConfig ships with a complete web interface:

```bash
python examples/02_web_ui.py
```

| Page | URL | Description |
|------|-----|-------------|
| **Dashboard** | `/` | Real-time monitoring — runs, violations, latency, agent stats |
| **Configure** | `/configure` | 5-step wizard to create an agent config from plain language |
| **My Configs** | `/configs` | Browse, inspect, and manage saved configurations |
| **Chat Demo** | `/chat` | Test any config in a live chat interface |

### Dashboard
- Total runs, escalations, errors
- Per-agent performance table
- Constraint violation breakdown by type
- Recent run history with status and latency

### Configuration Wizard (5 steps)
1. **Describe** — pick a template or write your own description
2. **Review** — see the parsed intent and live system prompt preview; edit inline
3. **Constraints** — auto-generated rules + add custom ones (keyword/regex/length)
4. **Model** — choose provider, model, temperature, max turns
5. **Save** — export JSON, save to disk, open in chat

---

## Architecture

```
agentconfig/
├── semantic/
│   ├── intent.py        # IntentParser — plain text → AgentIntent
│   ├── constraint.py    # ConstraintEngine — define & enforce rules
│   └── config_gen.py    # ConfigGenerator — produce AgentConfig
├── runtime/
│   ├── executor.py      # AgentExecutor — run agent with constraint checking
│   └── monitor.py       # AgentMonitor — collect & aggregate run stats
└── ui/
    ├── app.py           # Flask application (15 routes)
    └── static/
        ├── index.html   # Monitoring dashboard
        ├── configure.html  # Configuration wizard
        ├── configs.html    # Config management
        ├── chat.html       # Chat demo
        ├── style.css       # Dark theme UI
        └── utils.js        # Shared JS utilities
```

---

## Core Concepts

### AgentIntent

Structured representation of what a business user wants:

```python
AgentIntent(
    name="Support Bot",
    domain=AgentDomain.CUSTOMER_SERVICE,
    tone=[AgentTone.EMPATHETIC, AgentTone.PROFESSIONAL],
    topics_forbidden=["competitor products", "internal pricing"],
    escalation_triggers=["customer asks for a manager"],
    require_confirmation=["cancel an order"],
    max_turns=20,
)
```

### Constraints

Five constraint types with four actions:

| Type | Description |
|------|-------------|
| `forbidden_keyword` | Block if any keyword appears in response |
| `forbidden_topic` | Block if topic is discussed |
| `max_length` | Enforce response length limit |
| `required_keyword` | Require specific phrase in response |
| `custom` | Regex pattern match |

| Action | Behavior |
|--------|----------|
| `block` | Replace response with fallback message |
| `warn` | Log violation, allow response through |
| `replace` | Swap response with configured fallback |
| `escalate` | Trigger human handoff |

### LLM Integration

AgentExecutor accepts any callable that takes a list of messages and returns a string:

```python
import openai

def my_llm(messages: list) -> str:
    resp = openai.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages
    )
    return resp.choices[0].message.content

executor = AgentExecutor(llm_fn=my_llm)
response, record = executor.chat(config, "Hello!")
```

Works with OpenAI, Anthropic, Ollama, or any LLM with a compatible interface.

---

## Running Tests

```bash
pip install pytest
pytest tests/ -v
# 179 passed
```

---

## Multi-Format Configs

AgentConfig supports JSON, YAML, and TOML out of the box:

```python
config = AgentConfig(name="SupportAgent", max_turns=30)

# Serialize to any format
json_str = config.to_json()
yaml_str = config.to_yaml()
toml_str = config.to_toml()

# Parse from any format
config = AgentConfig.from_json(json_str)
config = AgentConfig.from_yaml(yaml_str)
config = AgentConfig.from_toml(toml_str)
```

Or use the file-oriented loader:

```python
from agentconfig import load_config, save_config

config = load_config("agent.yaml")   # auto-detects format
save_config(config, "agent.toml")    # re-save in another format
```

---

## Config Versioning

Track, diff, and roll back config changes — Git-style workflows for agent configs:

```python
from agentconfig import ConfigVersionManager, AgentConfig

manager = ConfigVersionManager()
manager.commit(AgentConfig(name="ResearchAgent"), "Initial setup")
manager.commit(AgentConfig(name="ResearchAgent", max_turns=50), "Bumped turns")

for v in manager.history():
    print(v.id, v.message)          # v1 Initial setup / v2 Bumped turns

print(manager.diff("v1", "v2"))     # unified diff
older = manager.rollback("v1")      # reconstruct a previous config
```

---

## Hot-Reload

Apply config changes without restarting your agent:

```python
from agentconfig import watch_config

watcher = watch_config("agent.yaml", on_change=lambda cfg: agent.update(cfg))
watcher.start()
# edit agent.yaml → callback fires automatically
watcher.stop()
```

Or expose a runtime REST API for production config updates:

```python
from agentconfig import RuntimeConfigStore, create_reload_blueprint
from flask import Flask

store = RuntimeConfigStore()
app = Flask(__name__)
app.register_blueprint(create_reload_blueprint(store), url_prefix="/api")

# PUT   /api/agents/<id>/config      partial config update
# GET   /api/agents/<id>/config      fetch current config
# GET   /api/agents/<id>/history     version history
# POST  /api/agents/<id>/rollback    roll back to a version
```

---

## Roadmap

- [x] CLI: `agentconfig serve` and `agentconfig watch` (hot-reload)
- [x] **LangGraph / AutoGen / CrewAI adapter plugins** (constraint-enforcing wrappers for each framework's calling convention) ✅ (v2.2.0)
- [x] **LLM-as-judge constraint** (semantic violation detection — catches paraphrases & indirect reveals that keywords miss) ✅ (v2.1.0)
- [x] **Config versioning and diff view** (commit / diff / rollback / history)
- [x] **YAML/TOML config support** (`from_yaml` / `from_toml` / `to_yaml` / `to_toml`)
- [x] **JSON Schema validation** (`agentconfig validate` for JSON/YAML/TOML)
- [x] **MCP tool declarations** with env-var substitution (`${VAR}`)
- [x] ~~Export to LangChain prompt template format~~ ✅
- [x] **A2A Protocol export** (`agentconfig export-a2a`)
- [x] ~~Skill Seekers import~~ ✅ (import from Claude Skills/SKILL.md)
- [ ] Team/organization config sharing

---

## License

MIT © cdzzy
