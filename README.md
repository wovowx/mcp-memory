# mcp-memory

MCP Server for Ziven - deployed on Cloudflare Workers

## Features
- Memory management (remember, recall, update, etc.)
- Image recognition and generation
- GitHub integration
- File management

## Endpoints
- `POST /mcp` - MCP JSON-RPC endpoint
- `POST /upload` - File upload to Supabase

## GitHub
- Owner: wovowx
- Repo: mcp-memory
- Synced from Cloudflare Workers

## Env Variables
- `GITHUB_TOKEN` - GitHub Personal Access Token (with repo scope)
- `GITHUB_REPO` - Default GitHub repository (e.g., wovowx/mcp-memory)
- `SUPABASE_ANON_KEY` - Supabase anonymous key for image storage

## Tools
- `github_push` - Push files to GitHub
- `github_create_repo` - Create new GitHub repository
- `help` - Show available tools
