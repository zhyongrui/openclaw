import { createDefaultDeps } from "../../cli/deps.js";
import { agentCommand } from "../../commands/agent.js";
import { createNonExitingRuntime } from "../../runtime.js";

export interface AgentRunRequest {
  prompt: string;
  workspaceDir: string;
  agentId?: string;
  extraSystemPrompt?: string;
  timeoutSeconds?: number;
}

export interface AgentRunResult {
  text: string;
  raw: unknown;
}

export interface AgentRunner {
  run(request: AgentRunRequest): Promise<AgentRunResult>;
}

function extractText(raw: unknown): string {
  const payloads = (raw as { payloads?: Array<{ text?: string }> } | null | undefined)?.payloads;
  if (!Array.isArray(payloads)) {
    return "";
  }
  return payloads
    .map((payload) => (typeof payload.text === "string" ? payload.text.trim() : ""))
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

export class OpenClawAgentRunner implements AgentRunner {
  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    const raw = await agentCommand(
      {
        message: request.prompt,
        workspaceDir: request.workspaceDir,
        agentId: request.agentId,
        extraSystemPrompt: request.extraSystemPrompt,
        timeout:
          typeof request.timeoutSeconds === "number" ? String(request.timeoutSeconds) : undefined,
        json: true
      },
      createNonExitingRuntime(),
      createDefaultDeps()
    );

    return {
      text: extractText(raw),
      raw
    };
  }
}
