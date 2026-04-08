"""Bootstrap builder — assemble the system prompt from workspace files."""
from __future__ import annotations

from langchain_core.messages import SystemMessage

from .workspace import load_skill_files, load_workspace_files


def build_system_prompt(workspace_path: str, agent_name: str = "") -> str:
    """Concatenate workspace bootstrap files and skills into a system prompt string."""
    sections: list[str] = []

    workspace_files = load_workspace_files(workspace_path)
    for fname, content in workspace_files.items():
        sections.append(f"## {fname}\n\n{content}")

    skill_files = load_skill_files(workspace_path)
    for skill_name, content in skill_files.items():
        sections.append(f"## SKILL: {skill_name}\n\n{content}")

    return "\n\n---\n\n".join(sections)


def build_system_message(workspace_path: str, agent_name: str = "") -> SystemMessage:
    """Return a LangChain SystemMessage with the assembled system prompt."""
    content = build_system_prompt(workspace_path, agent_name)
    return SystemMessage(content=content)
