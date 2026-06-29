"""MCP prompts — reusable prompt templates for clients."""

from __future__ import annotations

from mcp.server.fastmcp import FastMCP


def register_prompts(mcp: FastMCP) -> None:
    """Register all prompts on the MCP server instance."""

    @mcp.prompt()
    async def edit_note(query: str = "") -> str:
        """Prompt template: find a note and edit it safely."""
        find = (
            f"Search for the note with search_notes({query!r})."
            if query
            else "Ask the user which note, then find it with search_notes / list_notes."
        )
        return (
            "You are editing local AppNotas Markdown notes.\n\n"
            f"1. {find}\n"
            "2. read_note(id) to get the current body.\n"
            "3. Make your change to the body, then update_note(id, body=<whole new body>). "
            "It preserves created/tags/color you don't pass.\n"
            "4. For checklists, use toggle_task to check/uncheck items instead of "
            "rewriting the body.\n"
            "5. To delete, confirm with the user, then delete_note(id, confirm=true) "
            "(it soft-deletes to .trash). Tell the user they may need to reload "
            "the AppNotas app to see changes."
        )
