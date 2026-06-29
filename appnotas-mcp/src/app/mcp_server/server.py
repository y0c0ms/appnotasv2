"""MCP server factory.

Creates a FastMCP instance and registers all tools, resources, and prompts.
FastMCP is the high-level Python SDK for building MCP servers — it handles
the protocol details so you only write tool functions.

``stateless_http=True`` means each request is independent, which allows the
server to run as multiple replicas in Kubernetes without sticky sessions.
"""

from __future__ import annotations

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings

from app.config import get_settings
from app.mcp_server.prompts import register_prompts
from app.mcp_server.resources import register_resources
from app.mcp_server.tools import register_tools


def create_mcp_server() -> FastMCP:
    """Create and configure the MCP server with all tools, resources, and prompts."""
    settings = get_settings()

    allowed_hosts = [h.strip() for h in settings.allowed_hosts.split(",") if h.strip()]
    allowed_origins = [o.strip() for o in settings.allowed_origins.split(",") if o.strip()]

    # Enable DNS-rebinding protection only when explicit allowed hosts are
    # configured. Behind a gateway the Host header is the external hostname;
    # listing it here keeps protection on without causing 421 responses.
    transport_security = TransportSecuritySettings(
        enable_dns_rebinding_protection=bool(allowed_hosts),
        allowed_hosts=allowed_hosts,
        allowed_origins=allowed_origins,
    )

    mcp = FastMCP(
        name=settings.app_name,
        stateless_http=True,
        transport_security=transport_security,
    )
    register_tools(mcp)
    register_resources(mcp)
    register_prompts(mcp)
    return mcp
