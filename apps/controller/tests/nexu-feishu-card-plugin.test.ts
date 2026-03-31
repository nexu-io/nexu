import { describe, expect, it } from "vitest";
import pluginModule from "../static/runtime-plugins/nexu-feishu-card/index.js";

type ToolContextLike = {
  messageChannel?: string;
  sessionKey?: string;
};

type ToolLike = {
  name?: string;
};

type ToolFactoryResult = ToolLike | ToolLike[] | null | undefined;
type ToolFactory = (ctx: ToolContextLike) => ToolFactoryResult;

type RegisterToolOptions = {
  name?: string;
  names?: string[];
};

type RegisteredTool = {
  tool: ToolLike | ToolFactory;
  opts?: RegisterToolOptions;
};

type PluginLike = {
  register: (api: {
    registerTool: (
      tool: ToolLike | ToolFactory,
      opts?: RegisterToolOptions,
    ) => void;
  }) => void;
};

function isToolFactory(tool: RegisteredTool["tool"]): tool is ToolFactory {
  return typeof tool === "function";
}

function toToolList(value: ToolFactoryResult): ToolLike[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function resolveFallbackName(
  tool: RegisteredTool,
  index: number,
): string | undefined {
  if (typeof tool.opts?.names?.[index] === "string") {
    return tool.opts.names[index];
  }

  if (index === 0 && typeof tool.opts?.name === "string") {
    return tool.opts.name;
  }

  return undefined;
}

function collectToolNames(ctx: ToolContextLike): string[] {
  const registered: RegisteredTool[] = [];
  const plugin = pluginModule as unknown as PluginLike;

  plugin.register({
    registerTool(tool, opts) {
      registered.push({ tool, opts });
    },
  });

  return registered.flatMap((entry) => {
    const resolvedTools = isToolFactory(entry.tool)
      ? toToolList(entry.tool(ctx))
      : [entry.tool];

    return resolvedTools.flatMap((tool, index) => {
      const name =
        typeof tool.name === "string"
          ? tool.name
          : resolveFallbackName(entry, index);
      return typeof name === "string" ? [name] : [];
    });
  });
}

describe("nexu-feishu-card plugin", () => {
  it("does not expose tools outside Feishu sessions", () => {
    expect(
      collectToolNames({
        messageChannel: "slack",
        sessionKey: "agent:bot_123:slack:dm:U123",
      }),
    ).toEqual([]);
  });

  it("exposes tools for Feishu sessions", () => {
    expect(
      collectToolNames({
        messageChannel: "feishu",
        sessionKey: "agent:bot_123:feishu:dm:ou_demo",
      }),
    ).toEqual([
      "send_feishu_card",
      "update_feishu_card",
      "build_feishu_card",
      "build_feishu_button",
      "build_feishu_text",
      "build_feishu_divider",
    ]);
  });

  it("falls back to sessionKey when messageChannel is unavailable", () => {
    expect(
      collectToolNames({
        sessionKey: "agent:bot_123:feishu:group:oc_demo",
      }),
    ).toContain("send_feishu_card");
  });
});
