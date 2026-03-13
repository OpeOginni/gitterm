import { getProviderConfigService } from "../../service/config/provider-config";
import type {
  ComputeProvider,
  PersistentWorkspaceConfig,
  PersistentWorkspaceInfo,
  WorkspaceConfig,
  WorkspaceInfo,
  WorkspaceStatusResult,
} from "../compute";
import { Sandbox } from "e2b";

import type { E2BConfig } from "./types";
import env from "@gitterm/env/server";
export type { E2BConfig } from "./types";

const BASE_DOMAIN = env.BASE_DOMAIN;
const ROUTING_MODE = env.ROUTING_MODE;

export class E2BProvider implements ComputeProvider {
  readonly name = "e2b";
  private config: E2BConfig | null = null;

  async getConfig(): Promise<E2BConfig> {
    if (this.config) {
      return this.config;
    }

    const dbConfig = await getProviderConfigService().getProviderConfigForUse("e2b");
    if (!dbConfig) {
      console.error("E2B provider is not configured.");
      throw new Error("E2B provider is not configured. Please configure it in the admin panel.");
    }
    this.config = dbConfig as E2BConfig;
    return this.config;
  }

  async createWorkspace(config: WorkspaceConfig): Promise<WorkspaceInfo> {
    const { apiKey } = await this.getConfig();

    if (!apiKey) {
      throw new Error("E2B Api Key not configured");
    }

    const e2bSandbox = await Sandbox.create("opencode", {
      apiKey: apiKey,
      timeoutMs: 10 * 60 * 1_000, // 10 mins timeout
      lifecycle: {
        onTimeout: "pause",
      },
      envs: {
        OPENCODE_SERVER_PASSWORD: config.environmentVariables?.OPENCODE_SERVER_PASSWORD ?? "",
      },
    });

    const workspaceDir = `/home/user/workspace`;
    const repoDir = `${workspaceDir}/${config.environmentVariables?.REPO_NAME}`;

    if (config.repositoryUrl && config.environmentVariables) {
      // We Clone Repository
      const parsedGitRepoUrl = config.repositoryUrl.endsWith(".git")
        ? config.repositoryUrl
        : `${config.repositoryUrl}.git`;

      const username = config.environmentVariables.GITHUB_APP_TOKEN
        ? config.environmentVariables.USER_GITHUB_USERNAME
        : undefined;
      const password = config.environmentVariables.GITHUB_APP_TOKEN;

      await e2bSandbox.commands.run(`mkdir -p ${workspaceDir}`).catch(async (err) => {
        e2bSandbox.kill();
        console.error("EB2 Killed sanbbox because of err: ", err);
        throw err;
      });

      await e2bSandbox.git
        .clone(parsedGitRepoUrl, {
          path: repoDir,
          username: username,
          password: password,
        })
        .catch(async (err) => {
          e2bSandbox.kill();
          console.error("EB2 Killed sanbbox because of err: ", err);
          throw err;
        });
    }

    if (config.environmentVariables && config.environmentVariables.OPENCODE_CONFIG_BASE64) {
      await e2bSandbox.commands.run("mkdir -p ~/.config/opencode").catch(async (err) => {
        e2bSandbox.kill();
        console.error("EB2 Killed sanbbox because of err: ", err);
        throw err;
      });

      await e2bSandbox.commands
        .run(
          `echo "${config.environmentVariables.OPENCODE_CONFIG_BASE64}" | base64 -d > ~/.config/opencode/opencode.json`,
        )
        .catch(async (err) => {
          e2bSandbox.kill();
          console.error("EB2 Killed sanbbox because of err: ", err);
          throw err;
        });
    }

    if (config.environmentVariables && config.environmentVariables.OPENCODE_CREDENTIALS_BASE64) {
      await e2bSandbox.commands.run("mkdir -p ~/.local/share/opencode").catch(async (err) => {
        e2bSandbox.kill();
        console.error("EB2 Killed sanbbox because of err: ", err);
        throw err;
      });

      await e2bSandbox.commands
        .run(
          `echo "${config.environmentVariables.OPENCODE_CREDENTIALS_BASE64}" | base64 -d > ~/.local/share/opencode/auth.json`,
        )
        .catch(async (err) => {
          e2bSandbox.kill();
          console.error("EB2 Killed sanbbox because of err: ", err);
          throw err;
        });
    }

    await e2bSandbox.commands
      .run(
        `cd ${repoDir} && opencode serve --hostname 0.0.0.0 --port 4096 > /tmp/opencode.log 2>&1`,
        {
          background: true,
          onStdout: (data) => console.log(data),
          onStderr: (data) => console.error(data),
        },
      )
      .catch(async (err) => {
        e2bSandbox.kill();
        console.error("EB2 Killed sanbbox because of err: ", err);
        throw err;
      });

    const host = e2bSandbox.getHost(4096);

    const upstreamUrl = `https://${host}`;

    const domain =
      ROUTING_MODE === "path"
        ? BASE_DOMAIN.includes("localhost")
          ? `http://${BASE_DOMAIN}/ws/${config.subdomain}`
          : `https://${BASE_DOMAIN}/ws/${config.subdomain}`
        : BASE_DOMAIN.includes("localhost")
          ? `http://${config.subdomain}.${BASE_DOMAIN}`
          : `https://${config.subdomain}.${BASE_DOMAIN}`;

    return {
      externalServiceId: e2bSandbox.sandboxId,
      upstreamUrl,
      domain,
      serviceCreatedAt: new Date((await e2bSandbox.getInfo()).startedAt),
    };
  }

  async createPersistentWorkspace(
    config: PersistentWorkspaceConfig,
  ): Promise<PersistentWorkspaceInfo> {
    const { apiKey } = await this.getConfig();

    if (!apiKey) {
      throw new Error("E2B Api Key not configured");
    }

    const e2bSandbox = await Sandbox.create("opencode", {
      apiKey: apiKey,
      timeoutMs: 10 * 60 * 1_000, // 10 mins timeout
      lifecycle: {
        onTimeout: "kill",
      },
      envs: {
        OPENCODE_SERVER_PASSWORD: config.environmentVariables?.OPENCODE_SERVER_PASSWORD ?? "",
      },
    });

    const workspaceDir = `/home/user/workspace`;
    const repoDir = `${workspaceDir}/${config.environmentVariables?.REPO_NAME}`;

    if (config.repositoryUrl && config.environmentVariables) {
      // We Clone Repository
      const parsedGitRepoUrl = config.repositoryUrl.endsWith(".git")
        ? config.repositoryUrl
        : `${config.repositoryUrl}.git`;

      const username = config.environmentVariables.GITHUB_APP_TOKEN
        ? config.environmentVariables.USER_GITHUB_USERNAME
        : undefined;
      const password = config.environmentVariables.GITHUB_APP_TOKEN;

      await e2bSandbox.commands.run(`mkdir -p ${workspaceDir}`).catch(async (err) => {
        e2bSandbox.kill();
        console.error("EB2 Killed sanbbox because of err: ", err);
        throw err;
      });

      await e2bSandbox.git
        .clone(parsedGitRepoUrl, {
          path: repoDir,
          username: username,
          password: password,
        })
        .catch(async (err) => {
          e2bSandbox.kill();
          console.error("EB2 Killed sanbbox because of err: ", err);
          throw err;
        });
    }

    if (config.environmentVariables && config.environmentVariables.OPENCODE_CONFIG_BASE64) {
      await e2bSandbox.commands.run("mkdir -p ~/.config/opencode").catch(async (err) => {
        e2bSandbox.kill();
        console.error("EB2 Killed sanbbox because of err: ", err);
        throw err;
      });

      await e2bSandbox.commands
        .run(
          `echo "${config.environmentVariables.OPENCODE_CONFIG_BASE64}" | base64 -d > ~/.config/opencode/opencode.json`,
        )
        .catch(async (err) => {
          e2bSandbox.kill();
          console.error("EB2 Killed sanbbox because of err: ", err);
          throw err;
        });
    }

    if (config.environmentVariables && config.environmentVariables.OPENCODE_CREDENTIALS_BASE64) {
      await e2bSandbox.commands.run("mkdir -p ~/.local/share/opencode").catch(async (err) => {
        e2bSandbox.kill();
        console.error("EB2 Killed sanbbox because of err: ", err);
        throw err;
      });

      await e2bSandbox.commands
        .run(
          `echo "${config.environmentVariables.OPENCODE_CREDENTIALS_BASE64}" | base64 -d > ~/.local/share/opencode/auth.json`,
        )
        .catch(async (err) => {
          e2bSandbox.kill();
          console.error("EB2 Killed sanbbox because of err: ", err);
          throw err;
        });
    }

    await e2bSandbox.commands
      .run(
        `cd ${repoDir} && opencode serve --hostname 0.0.0.0 --port 4096 > /tmp/opencode.log 2>&1`,
        {
          background: true,
          onStdout: (data) => console.log(data),
          onStderr: (data) => console.error(data),
        },
      )
      .catch(async (err) => {
        e2bSandbox.kill();
        console.error("EB2 Killed sanbbox because of err: ", err);
        throw err;
      });

    const host = e2bSandbox.getHost(4096);

    const upstreamUrl = `https://${host}`;

    const domain =
      ROUTING_MODE === "path"
        ? BASE_DOMAIN.includes("localhost")
          ? `http://${BASE_DOMAIN}/ws/${config.subdomain}`
          : `https://${BASE_DOMAIN}/ws/${config.subdomain}`
        : BASE_DOMAIN.includes("localhost")
          ? `http://${config.subdomain}.${BASE_DOMAIN}`
          : `https://${config.subdomain}.${BASE_DOMAIN}`;

    return {
      externalServiceId: e2bSandbox.sandboxId,
      externalVolumeId: e2bSandbox.sandboxId,
      upstreamUrl,
      domain,
      serviceCreatedAt: new Date((await e2bSandbox.getInfo()).startedAt),
      volumeCreatedAt: new Date((await e2bSandbox.getInfo()).startedAt),
    };
  }

  async stopWorkspace(
    externalId: string,
    _regionIdentifier: string,
    _externalRunningDeploymentId?: string,
  ): Promise<void> {
    const { apiKey } = await this.getConfig();

    if (!apiKey) {
      throw new Error("E2B Api Key not configured");
    }

    const e2bSandbox = await Sandbox.connect(externalId, {
      apiKey: apiKey,
    });

    await e2bSandbox.pause().catch((error) => {
      console.error("E2B Sandbox Error (Sandbox.pause)", error.message);
      throw new Error(`E2B Sandbox Error (Sandbox.pause): ${error.message}`);
    });
  }

  async restartWorkspace(
    externalId: string,
    _regionIdentifier: string,
    _externalRunningDeploymentId?: string,
  ): Promise<void> {
    const { apiKey } = await this.getConfig();

    if (!apiKey) {
      throw new Error("E2B Api Key not configured");
    }

    await Sandbox.connect(externalId, {
      apiKey: apiKey,
    }).catch((error) => {
      console.error("E2B Sandbox Error while restarting (Sandbox.connect)", error.message);
      throw new Error(`E2B Sandbox Error while restarting (Sandbox.connect): ${error.message}`);
    });
  }

  async terminateWorkspace(externalServiceId: string, _externalVolumeId?: string): Promise<void> {
    const { apiKey } = await this.getConfig();

    if (!apiKey) {
      throw new Error("E2B Api Key not configured");
    }

    const e2bSandbox = await Sandbox.connect(externalServiceId, {
      apiKey: apiKey,
    });

    await e2bSandbox.kill().catch((error) => {
      console.error("E2B Sandbox Error (Sandbox.kill)", error.message);
      throw new Error(`E2B Sandbox Error (Sandbox.kill): ${error.message}`);
    });
  }

  async getStatus(externalId: string): Promise<WorkspaceStatusResult> {
    const { apiKey } = await this.getConfig();

    if (!apiKey) {
      throw new Error("E2B Api Key not configured");
    }

    try {
      const sandbox = await Sandbox.connect(externalId, {
        apiKey: apiKey,
      });

      const info: any = await sandbox.getInfo();

      if (info.state === "paused") {
        return { status: "stopped" };
      }

      if (info.state === "running") {
        return { status: "running" };
      }

      return { status: "terminated" };
    } catch (error: any) {
      console.error("E2B Sandbox Error (getStatus)", error?.message ?? error);
      return { status: "terminated" };
    }
  }

  async createOrGetExposedPortDomain(
    externalServiceId: string,
    port: number,
  ): Promise<{ domain: string; externalPortDomainId?: string }> {
    const { apiKey } = await this.getConfig();

    if (!apiKey) {
      throw new Error("E2B Api Key not configured");
    }

    const sandbox = await Sandbox.connect(externalServiceId, {
      apiKey: apiKey,
    });

    const host = sandbox.getHost(port);
    const domain = `https://${host}`;

    return { domain };
  }

  async removeExposedPortDomain(_externalServiceDomainId: string): Promise<void> {
    // No way to remove exposed port
  }
}

// Singleton instance
export const e2bProvider = new E2BProvider();
