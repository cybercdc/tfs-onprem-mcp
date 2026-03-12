#!/usr/bin/env node

import { spawn } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

class TfsClient {
  constructor(env = process.env) {
    this.orgUrl = requireEnvFrom(env, "AZURE_DEVOPS_ORG_URL");
    this.collection = requireEnvFrom(env, "AZURE_DEVOPS_COLLECTION");
    this.username = requireEnvFrom(env, "AZURE_DEVOPS_USERNAME");
    this.password = requireEnvFrom(env, "AZURE_DEVOPS_PASSWORD");
    this.defaultProject = env.AZURE_DEVOPS_PROJECT || "";
    this.apiVersion = env.AZURE_DEVOPS_API_VERSION || "5.1";
  }

  getCollectionUrl() {
    return `${this.orgUrl.replace(/\/+$/, "")}/${encodeURIComponent(this.collection)}`;
  }

  getProjectUrl(project) {
    return `${this.getCollectionUrl()}/${encodeURIComponent(project)}`;
  }

  resolveProject(project) {
    const resolved = project || this.defaultProject;
    if (!resolved) {
      throw new Error(
        "Project is required. Pass the project argument or set AZURE_DEVOPS_PROJECT.",
      );
    }
    return resolved;
  }

  async requestJson(path, options = {}) {
    const {
      project,
      method = "GET",
      body,
      contentType,
      apiVersion = this.apiVersion,
      collectionScoped = false,
    } = options;

    const baseUrl = collectionScoped
      ? this.getCollectionUrl()
      : this.getProjectUrl(this.resolveProject(project));
    const separator = path.includes("?") ? "&" : "?";
    const url = `${baseUrl}${path}${separator}api-version=${encodeURIComponent(apiVersion)}`;

    const args = [
      "--noproxy",
      "*",
      "--ntlm",
      "-sS",
      "-u",
      `${this.username}:${this.password}`,
      "-X",
      method,
    ];

    if (contentType) {
      args.push("-H", `Content-Type: ${contentType}`);
    }

    if (body !== undefined) {
      args.push("--data", typeof body === "string" ? body : JSON.stringify(body));
    }

    args.push(url);

    const { stdout } = await runCurl(args);

    try {
      return JSON.parse(stdout);
    } catch (error) {
      throw new Error(`TFS returned non-JSON response for ${path}: ${stdout.slice(0, 400)}`);
    }
  }

  async listProjects() {
    return this.requestJson("/_apis/projects", { collectionScoped: true });
  }

  async listRepositories(project) {
    return this.requestJson("/_apis/git/repositories", { project });
  }

  async listBranches({ project, repository }) {
    return this.requestJson(
      `/_apis/git/repositories/${encodeURIComponent(repository)}/refs?filter=heads/`,
      { project },
    );
  }

  async queryWorkItems({ project, wiql }) {
    return this.requestJson("/_apis/wit/wiql", {
      project,
      method: "POST",
      contentType: "application/json",
      body: { query: wiql },
    });
  }

  async workItemsBatch({ ids, fields }) {
    return this.requestJson("/_apis/wit/workitemsbatch", {
      collectionScoped: true,
      method: "POST",
      contentType: "application/json",
      body: { ids, fields },
    });
  }

  async listRecentWorkItems({ project, top = 20 }) {
    const wiql = [
      "Select [System.Id], [System.WorkItemType], [System.Title], [System.State],",
      "[System.AssignedTo], [System.ChangedDate]",
      "From WorkItems",
      "Where [System.TeamProject] = @project",
      "Order By [System.ChangedDate] Desc",
    ].join(" ");

    const queryResult = await this.queryWorkItems({ project, wiql });
    const ids = (queryResult.workItems || []).slice(0, top).map((item) => item.id);

    if (ids.length === 0) {
      return { count: 0, value: [] };
    }

    return this.workItemsBatch({
      ids,
      fields: [
        "System.Id",
        "System.WorkItemType",
        "System.Title",
        "System.State",
        "System.AssignedTo",
        "System.ChangedDate",
      ],
    });
  }

  async listWorkItemTypes(project) {
    return this.requestJson("/_apis/wit/workitemtypes", { project });
  }

  async getWorkItemTypeFields({ project, workItemType }) {
    return this.requestJson(
      `/_apis/wit/workitemtypes/${encodeURIComponent(workItemType)}/fields`,
      { project },
    );
  }

  async createWorkItem({ project, workItemType, fields }) {
    const operations = Object.entries(fields).map(([referenceName, value]) => ({
      op: "add",
      path: `/fields/${referenceName}`,
      value,
    }));

    return this.requestJson(
      `/_apis/wit/workitems/${encodeURIComponent(`$${workItemType}`)}`,
      {
        project,
        method: "POST",
        contentType: "application/json-patch+json",
        body: JSON.stringify(operations),
      },
    );
  }

  async createBacklog({
    project,
    title,
    description,
    acceptanceCriteria,
    storyType,
    relatedProject,
    productCategory,
    expectedReleaseDate,
    areaPath,
    iterationPath,
    assignedTo,
  }) {
    const operations = [
      { op: "add", path: "/fields/System.Title", value: title },
      { op: "add", path: "/fields/System.Description", value: description },
      {
        op: "add",
        path: "/fields/Microsoft.VSTS.Common.AcceptanceCriteria",
        value: acceptanceCriteria,
      },
      {
        op: "add",
        path: "/fields/Custom.d6401539-f716-4cd1-96ac-8d9b59b9c8b9",
        value: storyType,
      },
      {
        op: "add",
        path: "/fields/Custom.11dd8b18-bad4-436b-8123-b1702c394ca5",
        value: toTfsDateTime(expectedReleaseDate),
      },
      {
        op: "add",
        path: "/fields/Custom.0b01617e-b9a0-45e4-96b9-2fa34b1e3ea3",
        value: relatedProject,
      },
      {
        op: "add",
        path: "/fields/Custom.31942c5d-1cd3-4bc0-8413-f5fc925badd0",
        value: productCategory,
      },
    ];

    if (areaPath) {
      operations.push({ op: "add", path: "/fields/System.AreaPath", value: areaPath });
    }

    if (iterationPath) {
      operations.push({
        op: "add",
        path: "/fields/System.IterationPath",
        value: iterationPath,
      });
    }

    if (assignedTo) {
      operations.push({ op: "add", path: "/fields/System.AssignedTo", value: assignedTo });
    }

    return this.createWorkItem({
      project,
      workItemType: "产品积压工作(backlog)项",
      fields: operations.reduce((acc, op) => {
        acc[op.path.replace("/fields/", "")] = op.value;
        return acc;
      }, {}),
    });
  }
}

function requireEnvFrom(env, name) {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function toTfsDateTime(dateText) {
  if (/T/.test(dateText)) {
    return dateText;
  }
  return `${dateText}T16:00:00Z`;
}

function runCurl(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("curl", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(`curl exited with code ${code}: ${stderr || stdout}`));
    });
  });
}

function formatJson(value) {
  return JSON.stringify(value, null, 2);
}

function workItemSummary(item) {
  const fields = item.fields || {};
  const assignedTo =
    typeof fields["System.AssignedTo"] === "object"
      ? fields["System.AssignedTo"]?.displayName || ""
      : fields["System.AssignedTo"] || "";

  return {
    id: fields["System.Id"],
    type: fields["System.WorkItemType"],
    title: fields["System.Title"],
    state: fields["System.State"],
    assignedTo,
    changedDate: fields["System.ChangedDate"],
  };
}

const server = new McpServer({
  name: "tfs-onprem-mcp",
  version: "0.1.0",
});

server.tool(
  "list_projects",
  "List projects from an on-prem TFS / Azure DevOps Server collection.",
  {},
  async () => {
    const client = new TfsClient();
    const result = await client.listProjects();
    const projects = (result.value || []).map((project) => ({
      id: project.id,
      name: project.name,
      state: project.state,
      visibility: project.visibility,
      lastUpdateTime: project.lastUpdateTime,
    }));

    return {
      content: [{ type: "text", text: formatJson(projects) }],
      structuredContent: { count: projects.length, projects },
    };
  },
);

server.tool(
  "list_repositories",
  "List Git repositories for a project.",
  {
    project: z.string().optional().describe("Project name. Defaults to AZURE_DEVOPS_PROJECT."),
  },
  async ({ project }) => {
    const client = new TfsClient();
    const result = await client.listRepositories(project);
    const repositories = (result.value || []).map((repo) => ({
      id: repo.id,
      name: repo.name,
      project: repo.project?.name,
      remoteUrl: repo.remoteUrl,
      sshUrl: repo.sshUrl,
      webUrl: repo.webUrl,
      size: repo.size,
    }));

    return {
      content: [{ type: "text", text: formatJson(repositories) }],
      structuredContent: { count: repositories.length, repositories },
    };
  },
);

server.tool(
  "list_branches",
  "List branches for a Git repository.",
  {
    repository: z.string().describe("Repository ID or repository name."),
    project: z.string().optional().describe("Project name. Defaults to AZURE_DEVOPS_PROJECT."),
  },
  async ({ repository, project }) => {
    const client = new TfsClient();
    const result = await client.listBranches({ project, repository });
    const branches = (result.value || []).map((branch) => ({
      name: branch.name,
      objectId: branch.objectId,
      creator: branch.creator?.displayName || null,
      url: branch.url,
    }));

    return {
      content: [{ type: "text", text: formatJson(branches) }],
      structuredContent: { count: branches.length, branches },
    };
  },
);

server.tool(
  "list_recent_work_items",
  "List the most recently updated work items in a project.",
  {
    project: z.string().optional().describe("Project name. Defaults to AZURE_DEVOPS_PROJECT."),
    top: z.number().int().min(1).max(100).optional().describe("Maximum number of items."),
  },
  async ({ project, top }) => {
    const client = new TfsClient();
    const result = await client.listRecentWorkItems({ project, top: top || 20 });
    const workItems = (result.value || []).map(workItemSummary);

    return {
      content: [{ type: "text", text: formatJson(workItems) }],
      structuredContent: { count: workItems.length, workItems },
    };
  },
);

server.tool(
  "list_work_item_types",
  "List available work item types for a project.",
  {
    project: z.string().optional().describe("Project name. Defaults to AZURE_DEVOPS_PROJECT."),
  },
  async ({ project }) => {
    const client = new TfsClient();
    const result = await client.listWorkItemTypes(project);
    const workItemTypes = (result.value || []).map((item) => ({
      name: item.name,
      description: item.description || null,
      color: item.color || null,
    }));

    return {
      content: [{ type: "text", text: formatJson(workItemTypes) }],
      structuredContent: { count: workItemTypes.length, workItemTypes },
    };
  },
);

server.tool(
  "get_work_item_type_fields",
  "Get field definitions for a work item type, including which fields are required.",
  {
    workItemType: z.string().describe("Work item type name."),
    project: z.string().optional().describe("Project name. Defaults to AZURE_DEVOPS_PROJECT."),
  },
  async ({ workItemType, project }) => {
    const client = new TfsClient();
    const result = await client.getWorkItemTypeFields({ project, workItemType });
    const fields = (result.value || []).map((field) => ({
      referenceName: field.referenceName,
      name: field.name,
      alwaysRequired: Boolean(field.alwaysRequired),
      defaultValue: field.defaultValue ?? null,
      helpText: field.helpText ?? null,
    }));

    return {
      content: [{ type: "text", text: formatJson(fields) }],
      structuredContent: { count: fields.length, fields },
    };
  },
);

server.tool(
  "query_work_items",
  "Run a custom WIQL query and return matching work item IDs.",
  {
    wiql: z.string().describe("Full WIQL query text."),
    project: z.string().optional().describe("Project name. Defaults to AZURE_DEVOPS_PROJECT."),
  },
  async ({ wiql, project }) => {
    const client = new TfsClient();
    const result = await client.queryWorkItems({ project, wiql });
    const workItems = (result.workItems || []).map((item) => item.id);

    return {
      content: [{ type: "text", text: formatJson(workItems) }],
      structuredContent: {
        count: workItems.length,
        workItemIds: workItems,
        asOf: result.asOf,
      },
    };
  },
);

server.tool(
  "create_work_item",
  "Create a generic work item by passing TFS field reference names and values.",
  {
    workItemType: z.string().describe("Work item type name, for example Bug or 任务."),
    fields: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .describe("Map of TFS field reference name to value."),
    project: z.string().optional().describe("Project name. Defaults to AZURE_DEVOPS_PROJECT."),
  },
  async ({ workItemType, fields, project }) => {
    const client = new TfsClient();
    const result = await client.createWorkItem({ project, workItemType, fields });
    const summary = {
      id: result.id,
      url: result._links?.html?.href,
      title: result.fields?.["System.Title"],
      state: result.fields?.["System.State"],
      workItemType: result.fields?.["System.WorkItemType"],
      project: result.fields?.["System.TeamProject"],
    };

    return {
      content: [{ type: "text", text: formatJson(summary) }],
      structuredContent: summary,
    };
  },
);

server.tool(
  "create_backlog_item",
  "Create a backlog item in a TFS / Azure DevOps Server project with the required custom fields.",
  {
    title: z.string().describe("Work item title."),
    description: z.string().describe("Description/body."),
    acceptanceCriteria: z.string().describe("Acceptance criteria."),
    storyType: z.string().describe("Custom field: 故事类型."),
    relatedProject: z.string().describe("Custom field: 关联项目."),
    productCategory: z.string().describe("Custom field: 产品分类."),
    expectedReleaseDate: z
      .string()
      .describe("Expected release date in YYYY-MM-DD or full ISO datetime."),
    project: z.string().optional().describe("Project name. Defaults to AZURE_DEVOPS_PROJECT."),
    areaPath: z.string().optional().describe("Optional TFS area path."),
    iterationPath: z.string().optional().describe("Optional TFS iteration path."),
    assignedTo: z.string().optional().describe("Optional assignee."),
  },
  async (input) => {
    const client = new TfsClient();
    const result = await client.createBacklog(input);
    const summary = {
      id: result.id,
      url: result._links?.html?.href,
      title: result.fields?.["System.Title"],
      state: result.fields?.["System.State"],
      project: result.fields?.["System.TeamProject"],
      areaPath: result.fields?.["System.AreaPath"],
      iterationPath: result.fields?.["System.IterationPath"],
    };

    return {
      content: [{ type: "text", text: formatJson(summary) }],
      structuredContent: summary,
    };
  },
);

server.tool(
  "server_info",
  "Show the active TFS connection configuration with secrets removed.",
  {},
  async () => {
    const client = new TfsClient();
    const info = {
      orgUrl: client.orgUrl,
      collection: client.collection,
      defaultProject: client.defaultProject || null,
      apiVersion: client.apiVersion,
      auth: "NTLM via curl",
    };

    return {
      content: [{ type: "text", text: formatJson(info) }],
      structuredContent: info,
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`${escapeHtml(message)}\n`);
  process.exit(1);
});
