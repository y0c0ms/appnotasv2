"""stdio entrypoint for Claude Desktop and other local MCP clients.

Claude Desktop launches an MCP server as a subprocess and talks to it over
stdin/stdout using newline-delimited JSON-RPC. This entrypoint runs the very
same FastMCP server as the HTTP app — identical tools, resources, and prompts —
but over the stdio transport instead of Streamable HTTP. No FastAPI, uvicorn,
or network port is involved.

IMPORTANT: on stdio, **nothing may be written to stdout except the MCP protocol
itself**, or the client cannot parse the stream. We therefore do NOT call
``configure_logging`` here (which forces JSON logs to stdout). Python's default
logging goes to stderr, which Claude Desktop captures safely.

Usage in claude_desktop_config.json:

    {
      "mcpServers": {
        "nif-checker-mcp": {
          "command": "<abs>/.venv/Scripts/python.exe",
          "args": ["-m", "app.stdio"],
          "env": { "PYTHONPATH": "<abs>/src" }
        }
      }
    }
"""

from __future__ import annotations

import sys

from app.config import get_settings
from app.logging_setup import configure_logging
from app.mcp_server.server import create_mcp_server


def main() -> None:
    # Logs MUST go to stderr here — stdout is the MCP JSON-RPC channel.
    configure_logging(get_settings().log_level, stream=sys.stderr)
    mcp = create_mcp_server()
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
