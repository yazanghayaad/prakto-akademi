"""Atlas: the in-app course agent (open-source implementation).

The tool layer (`src.services.ai.tools`) is shared with the MCP server; this
package adds what the agent needs on top of it: chat sessions, the model loop
that streams text and tool calls, and the approval of proposed changes.
"""
