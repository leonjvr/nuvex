"""Pydantic config models for divisions.yaml parsing."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field


class ModelConfig(BaseModel):
    primary: str = "openai/gpt-4o"
    fast: str | None = None
    code: str | None = None
    # Failover: tried in order when the primary model returns a retriable error
    failover: list[str] = Field(default_factory=list)
    # mode: standard (use routing table) | budget (always fast) | failover (primary then failover list)
    mode: str = "standard"
    # Anthropic advisor tool (advisor-tool-2026-03-01 beta) — on by default for Claude models.
    # Set to False to disable per agent.
    advisor: bool = True


class RoutingConfig(BaseModel):
    simple_reply: str = "fast"
    conversation: str = "primary"
    code_generation: str = "code"
    voice_response: str = "fast"


class BudgetConfig(BaseModel):
    per_task_usd: float = 0.50
    daily_usd: float = 5.0
    monthly_usd: float = 50.0
    hard_cap_usd: float | None = None
    warn_at_pct: float = 80.0
    period_start: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )


class CompactionConfig(BaseModel):
    threshold: int = 50
    preserve_recent: int = 10
    summary_max_tokens: int = 2000
    mode: str = "safeguard"  # safeguard | manual | disabled | snip
    # Snip-mode settings (§31)
    snip_max_replay: int = 3
    snip_max_tokens: int = 1500
    snip_relevance_threshold: float = 0.55


class RecoveryConfig(BaseModel):
    llm_retries: int = 2
    llm_retry_delay_seconds: int = 5
    tool_timeout_multiplier: float = 2.0
    gateway_reconnect_delays: list[int] = Field(default_factory=lambda: [0, 30, 300])
    escalation_target: str = "telegram"


class TelegramAgentConfig(BaseModel):
    enabled: bool = False
    bot_token: str = ""
    allowed_users: str = ""


class EmailAgentConfig(BaseModel):
    enabled: bool = False
    imap_host: str = ""
    imap_port: int = 993
    smtp_host: str = ""
    smtp_port: int = 587
    email_user: str = ""
    email_pass: str = ""


class SlackAgentConfig(BaseModel):
    enabled: bool = False
    bot_token: str = ""
    signing_secret: str = ""
    default_channel: str = ""


class DiscordAgentConfig(BaseModel):
    enabled: bool = False
    bot_token: str = ""
    guild_id: str = ""
    webhook_url: str = ""


class WhatsAppAgentConfig(BaseModel):
    enabled: bool = False
    sync_full_history: bool = False


class AgentChannelsConfig(BaseModel):
    whatsapp: WhatsAppAgentConfig = Field(default_factory=WhatsAppAgentConfig)
    telegram: TelegramAgentConfig = Field(default_factory=TelegramAgentConfig)
    email: EmailAgentConfig = Field(default_factory=EmailAgentConfig)
    slack: SlackAgentConfig = Field(default_factory=SlackAgentConfig)
    discord: DiscordAgentConfig = Field(default_factory=DiscordAgentConfig)


class GroupBinding(BaseModel):
    jid: str
    workspace: str
    label: str = ""


class WhatsAppOrgConfig(BaseModel):
    enabled: bool = False
    agent_id: str = "maya"
    dm_policy: str = "pairing"
    group_policy: str = "allowlist"
    humanise_enabled: bool = False
    humanise_read_receipt_delay_ms: int = 1500
    humanise_thinking_delay_ms: int = 2500
    humanise_typing_speed_wpm: int = 45
    humanise_chunk_messages: bool = True
    group_bindings: list[GroupBinding] = Field(default_factory=list)


class McpServerConfig(BaseModel):
    """Config for a single MCP server process attached to an agent."""
    # Transport: stdio (default) or sse
    transport: str = "stdio"
    # stdio: command + args to spawn the server process
    command: str = ""
    args: list[str] = Field(default_factory=list)
    env: dict[str, str] = Field(default_factory=dict)
    # sse: base URL of the running SSE MCP server
    url: str = ""


class DiminishingReturnsConfig(BaseModel):
    """Per-agent thresholds for the diminishing-returns stop logic (§29)."""

    enabled: bool = True
    min_tokens_per_turn: int = 500
    consecutive_threshold: int = 3


class ScratchConfig(BaseModel):
    """Scratch directory quota and cleanup policy (§35)."""

    quota_mb: int = 100
    cleanup: str = "on_archive"  # on_archive | on_invocation_end | never


class PluginAgentConfig(BaseModel):
    """Per-agent plugin configuration."""
    enabled: bool = True
    config: dict[str, Any] = Field(default_factory=dict)


class AgentDefinition(BaseModel):
    name: str = ""
    tier: str = "T1"  # T1 | T2 | T3
    division: str = "default"
    workspace: str | None = None
    # Human-readable description (used in A2A agent card)
    description: str = ""
    # System agents cannot be deleted or suspended
    system: bool = False
    model: ModelConfig = Field(default_factory=ModelConfig)
    routing: RoutingConfig = Field(default_factory=RoutingConfig)
    budget: BudgetConfig = Field(default_factory=BudgetConfig)
    compaction: CompactionConfig = Field(default_factory=CompactionConfig)
    recovery: RecoveryConfig = Field(default_factory=RecoveryConfig)
    channels: AgentChannelsConfig = Field(default_factory=AgentChannelsConfig)
    forbidden_tools: list[str] = Field(default_factory=list)
    policies: list[dict[str, Any]] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)
    skill_disclosure: str = "progressive"  # "progressive" | "eager"
    # MCP servers: keyed by a logical name used as tool name prefix
    mcp_servers: dict[str, McpServerConfig] = Field(default_factory=dict)
    # §29 — diminishing returns thresholds
    diminishing_returns: DiminishingReturnsConfig = Field(default_factory=DiminishingReturnsConfig)
    # §30 — response style overlay
    response_style: str | None = None
    # §34 — PII masking patterns
    pii_patterns: list[str] = Field(default_factory=list)
    # §35 — scratch directory config
    scratch: ScratchConfig = Field(default_factory=ScratchConfig)
    # §5.5 — auto-trigger under_review on governance hit types for T0 contacts
    # e.g. ["forbidden"] — apply under_review when T0 contact triggers a forbidden governance block
    auto_under_review_on: list[str] = Field(default_factory=list)
    # §8 — plugin configs keyed by plugin id
    plugins: dict[str, PluginAgentConfig] = Field(default_factory=dict)
    # §desktop — assigned desktop device id (None = no desktop access)
    desktop_device: str | None = None


class TrustProgressionConfig(BaseModel):
    """Thresholds for automatic T0→T1 trust tier promotion."""

    t0_min_messages: int = 5
    t0_min_days: int = 1


class DatabaseConfig(BaseModel):
    url: str | None = None


class HealthConfig(BaseModel):
    gateway_check_interval_seconds: int = 30


class ParallelConfig(BaseModel):
    """Parallel tool execution config (hermes-inspired-runtime §1)."""

    enabled: bool = True
    max_concurrency: int = 8
    safe_tools: list[str] = Field(
        default_factory=lambda: [
            "read_file",
            "web_fetch",
            "web_search",
            "session_search",
            "read_tool_result",
        ]
    )


class ResultBudgetConfig(BaseModel):
    """Tool result budget config (hermes-inspired-runtime §2)."""

    enabled: bool = True
    default_max_chars: int = 30000
    turn_budget_chars: int = 200000
    per_tool: dict[str, int] = Field(default_factory=dict)


class CredentialPoolProviderConfig(BaseModel):
    """Per-provider credential pool config (hermes-inspired-runtime §3)."""

    strategy: str = "fill_first"  # fill_first | round_robin | random
    cooldown_minutes: int = 60
    keys: list[str] = Field(default_factory=list)


class CredentialPoolConfig(BaseModel):
    """Multi-credential failover pool config (hermes-inspired-runtime §3)."""

    providers: dict[str, CredentialPoolProviderConfig] = Field(default_factory=dict)


class TrivialReplyConfig(BaseModel):
    """Trivial reply routing config (hermes-inspired-runtime §5)."""

    enabled: bool = True
    max_chars: int = 160
    max_words: int = 28
    complex_keywords: list[str] = Field(
        default_factory=lambda: [
            "explain",
            "analyze",
            "compare",
            "implement",
            "debug",
            "refactor",
            "design",
            "architect",
            "review",
        ]
    )


class ToolsConfig(BaseModel):
    """Top-level tools configuration block for nuvex.yaml."""

    parallel: ParallelConfig = Field(default_factory=ParallelConfig)
    result_budget: ResultBudgetConfig = Field(default_factory=ResultBudgetConfig)


class LlmConfig(BaseModel):
    """Top-level LLM configuration block for nuvex.yaml."""

    credential_pools: CredentialPoolConfig = Field(default_factory=CredentialPoolConfig)


class NuvexConfig(BaseModel):
    agents: dict[str, AgentDefinition] = Field(default_factory=dict)
    whatsapp: WhatsAppOrgConfig = Field(default_factory=WhatsAppOrgConfig)
    database: DatabaseConfig = Field(default_factory=DatabaseConfig)
    health: HealthConfig = Field(default_factory=HealthConfig)
    policies: list[dict[str, Any]] = Field(default_factory=list)
    trust_progression: TrustProgressionConfig = Field(default_factory=TrustProgressionConfig)
    tools: ToolsConfig = Field(default_factory=ToolsConfig)
    llm: LlmConfig = Field(default_factory=LlmConfig)
