# tfs-onprem-mcp

MCP server for on-prem TFS / Azure DevOps Server instances that require `NTLM` authentication.

This server uses the official MCP TypeScript SDK over `stdio` and shells out to `curl --ntlm` for REST calls. It is aimed at environments like the one validated here:

- Azure DevOps Server / TFS on-prem
- collection-based URLs such as `http://host/DefaultCollection`
- Windows-domain credentials
- REST API version `5.1`

## Features

- List projects
- List repositories in a project
- List branches in a repository
- List recently changed work items
- List available work item types
- Inspect field definitions for a work item type
- Run custom WIQL queries
- Create generic work items from field reference names
- Create backlog items with required custom fields

## Requirements

- Node.js `20+`
- `curl` available on `PATH`
- TFS / Azure DevOps Server reachable from the host machine

## Install

```bash
npm install
```

Package tarball:

```bash
npm pack
```

## Environment Variables

Required:

```bash
export AZURE_DEVOPS_ORG_URL="http://your-tfs-host"
export AZURE_DEVOPS_COLLECTION="DefaultCollection"
export AZURE_DEVOPS_USERNAME="domain_user"
export AZURE_DEVOPS_PASSWORD="your-password"
```

Optional:

```bash
export AZURE_DEVOPS_PROJECT="Your Default Project"
export AZURE_DEVOPS_API_VERSION="5.1"
```

## Run Locally

```bash
npm start
```

## Run With Docker

Build the image:

```bash
docker build -t tfs-onprem-mcp .
```

Run it with your TFS connection settings:

```bash
docker run --rm -i \
  -e AZURE_DEVOPS_ORG_URL="http://your-tfs-host" \
  -e AZURE_DEVOPS_COLLECTION="DefaultCollection" \
  -e AZURE_DEVOPS_USERNAME="domain_user" \
  -e AZURE_DEVOPS_PASSWORD="your-password" \
  -e AZURE_DEVOPS_PROJECT="体检新产品" \
  -e AZURE_DEVOPS_API_VERSION="5.1" \
  tfs-onprem-mcp
```

If your MCP client supports Docker-based stdio servers, point it at the image and pass the same environment variables there.

## MCP Client Config

Example client config for a stdio MCP client:

```json
{
  "mcpServers": {
    "tfs-onprem": {
      "command": "node",
      "args": ["/absolute/path/to/tfs-onprem-mcp/src/index.js"],
      "env": {
        "AZURE_DEVOPS_ORG_URL": "http://your-tfs-host",
        "AZURE_DEVOPS_COLLECTION": "DefaultCollection",
        "AZURE_DEVOPS_USERNAME": "domain_user",
        "AZURE_DEVOPS_PASSWORD": "your-password",
        "AZURE_DEVOPS_PROJECT": "体检新产品",
        "AZURE_DEVOPS_API_VERSION": "5.1"
      }
    }
  }
}
```

If you publish this package to npm, you can switch to:

```json
{
  "mcpServers": {
    "tfs-onprem": {
      "command": "npx",
      "args": ["-y", "@cybercdc/tfs-onprem-mcp"],
      "env": {
        "AZURE_DEVOPS_ORG_URL": "http://your-tfs-host",
        "AZURE_DEVOPS_COLLECTION": "DefaultCollection",
        "AZURE_DEVOPS_USERNAME": "domain_user",
        "AZURE_DEVOPS_PASSWORD": "your-password",
        "AZURE_DEVOPS_PROJECT": "体检新产品"
      }
    }
  }
}
```

## Exposed Tools

- `server_info`
- `list_projects`
- `list_repositories`
- `list_branches`
- `list_recent_work_items`
- `list_work_item_types`
- `get_work_item_type_fields`
- `query_work_items`
- `create_work_item`
- `create_backlog_item`

## Recommended Usage Flow

For a new TFS project, the safest flow is:

1. Call `list_work_item_types`
2. Pick a work item type such as `Bug`, `任务`, or `产品积压工作(backlog)项`
3. Call `get_work_item_type_fields`
4. Use the required field reference names to call `create_work_item`

This avoids hardcoding one project's process template into the MCP client workflow.

## create_backlog_item Notes

`create_backlog_item` is still included as a convenience wrapper for the validated environment behind this package. It assumes a customized backlog template with these required logical fields:

- `acceptanceCriteria`
- `storyType`
- `relatedProject`
- `productCategory`
- `expectedReleaseDate`

If your server uses different custom field reference names, prefer `create_work_item` instead of editing the package.

## Publish

1. Confirm the scoped package name in `package.json` is correct for your npm account or org.
2. Update the GitHub URLs in `package.json` if your repository owner or organization differs.
3. Bump `version`.
4. Log in:

```bash
npm login
```

5. Publish:

```bash
npm publish --access public
```

## GitHub Release Checklist

1. Push the current version tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

2. Create a GitHub release from that tag.
3. Attach the `npm pack` tarball if you want a downloadable artifact on the release page.
4. Use release notes that mention:
   - NTLM-authenticated TFS / Azure DevOps Server support
   - validated REST API version `5.1`
   - generic work item creation plus backlog convenience wrapper

## Sources

- MCP TypeScript SDK README: https://github.com/modelcontextprotocol/typescript-sdk
- MCP documentation: https://modelcontextprotocol.io
