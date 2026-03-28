import { afterEach, describe, expect, it, vi } from "vitest";

import plugin from "../static/runtime-plugins/nexu-feishu-card/index.js";

type ToolContextLike = {
  messageChannel?: string;
  sessionKey?: string;
};

type ToolLike = {
  name?: string;
  description?: string;
  execute?: (
    toolCallId: string,
    params: Record<string, unknown>,
  ) => Promise<unknown>;
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

function collectTools(ctx: ToolContextLike): ToolLike[] {
  const registered: RegisteredTool[] = [];
  const pluginModule = plugin as unknown as PluginLike;

  pluginModule.register({
    registerTool(tool, opts) {
      registered.push({ tool, opts });
    },
  });

  return registered.flatMap((entry) => {
    const resolvedTools = isToolFactory(entry.tool)
      ? toToolList(entry.tool(ctx))
      : [entry.tool];

    return resolvedTools.map((tool, index) => ({
      ...tool,
      name:
        typeof tool.name === "string"
          ? tool.name
          : resolveFallbackName(entry, index),
    }));
  });
}

describe("nexu-feishu-card plugin", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not expose tools outside Feishu sessions", () => {
    expect(
      collectTools({
        messageChannel: "slack",
        sessionKey: "agent:bot_123:slack:dm:U123",
      }),
    ).toEqual([]);
  });

  it("exposes tools for Feishu sessions", () => {
    expect(
      collectTools({
        messageChannel: "feishu",
        sessionKey: "agent:bot_123:feishu:dm:ou_demo",
      }).map((tool) => tool.name),
    ).toEqual([
      "ask_feishu_choice",
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
      collectTools({
        sessionKey: "agent:bot_123:feishu:group:oc_demo",
      }).map((tool) => tool.name),
    ).toContain("send_feishu_card");
  });

  it("registers ask_feishu_choice with a strong tool-selection hint", () => {
    const askTool = collectTools({
      sessionKey: "agent:bot-1:workspace:feishu:dm:ou_test",
    }).find((tool) => tool.name === "ask_feishu_choice");

    expect(askTool).toBeDefined();
    expect(askTool?.description).toContain("优先使用本工具而不是普通文本提问");
  });

  it("builds and sends a choice card for finite-option questions", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        messageId: "om_test_message",
      }),
    }));

    vi.stubGlobal("fetch", fetchMock);

    const askTool = collectTools({
      sessionKey: "agent:bot-1:workspace:feishu:dm:ou_test",
    }).find((tool) => tool.name === "ask_feishu_choice");

    expect(askTool?.execute).toBeTypeOf("function");

    const result = await askTool?.execute?.("tool-call-1", {
      question: "是否继续发布？",
      details: "请选择一个操作。",
      options: [
        { text: "继续", value: "continue", type: "primary" },
        { text: "取消", value: "cancel" },
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      botId: string;
      to: string;
      receiveIdType: string;
      card: {
        header: {
          title: {
            content: string;
          };
          template: string;
        };
        elements: Array<Record<string, unknown>>;
      };
    };

    expect(body.botId).toBe("bot-1");
    expect(body.to).toBe("ou_test");
    expect(body.receiveIdType).toBe("open_id");
    expect(body.card.header.title.content).toBe("请做选择");
    expect(body.card.header.template).toBe("blue");
    expect(body.card.elements).toEqual([
      {
        tag: "markdown",
        content: "是否继续发布？",
      },
      {
        tag: "markdown",
        content: "请选择一个操作。",
      },
      {
        tag: "action",
        actions: [
          {
            tag: "button",
            text: {
              tag: "plain_text",
              content: "继续",
            },
            type: "primary",
            value: "continue",
          },
          {
            tag: "button",
            text: {
              tag: "plain_text",
              content: "取消",
            },
            type: "default",
            value: "cancel",
          },
        ],
      },
    ]);

    expect(result).toMatchObject({
      details: {
        success: true,
        messageId: "om_test_message",
      },
    });
  });

  it("wraps raw button elements into an action block when building cards", async () => {
    const buildCardTool = collectTools({
      sessionKey: "agent:bot-1:workspace:feishu:dm:ou_test",
    }).find((tool) => tool.name === "build_feishu_card");

    expect(buildCardTool?.execute).toBeTypeOf("function");

    const result = await buildCardTool?.execute?.("tool-call-2", {
      header_title: "审批",
      elements: [
        {
          tag: "markdown",
          content: "请选择后续动作",
        },
        {
          tag: "button",
          text: {
            tag: "plain_text",
            content: "同意",
          },
          value: "approve",
          type: "primary",
        },
        {
          tag: "button",
          text: {
            tag: "plain_text",
            content: "拒绝",
          },
          value: "reject",
          type: "default",
        },
      ],
    });

    expect(result).toMatchObject({
      details: {
        card: {
          header: {
            title: {
              tag: "plain_text",
              content: "审批",
            },
          },
          elements: [
            {
              tag: "markdown",
              content: "请选择后续动作",
            },
            {
              tag: "action",
              actions: [
                {
                  tag: "button",
                  text: {
                    tag: "plain_text",
                    content: "同意",
                  },
                  type: "primary",
                  value: "approve",
                },
                {
                  tag: "button",
                  text: {
                    tag: "plain_text",
                    content: "拒绝",
                  },
                  type: "default",
                  value: "reject",
                },
              ],
            },
          ],
        },
      },
    });
  });

  it("defaults build_feishu_text to markdown when is_markdown is omitted", async () => {
    const buildTextTool = collectTools({
      sessionKey: "agent:bot-1:workspace:feishu:dm:ou_test",
    }).find((tool) => tool.name === "build_feishu_text");

    expect(buildTextTool?.execute).toBeTypeOf("function");

    const result = await buildTextTool?.execute?.("tool-call-3", {
      content: "默认 markdown",
    });

    expect(result).toMatchObject({
      details: {
        tag: "markdown",
        content: "默认 markdown",
      },
    });
  });
});
