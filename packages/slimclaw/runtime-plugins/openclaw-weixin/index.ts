import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { buildChannelConfigSchema } from "openclaw/plugin-sdk";

import { weixinPlugin } from "./src/channel.js";
import { WeixinConfigSchema } from "./src/config/config-schema.js";
import { registerWeixinCli } from "./src/log-upload.js";
import { setWeixinRuntime } from "./src/runtime.js";

const plugin = {
  id: "openclaw-weixin",
  name: "Weixin",
  description: "Weixin channel (getUpdates long-poll + sendMessage)",
  configSchema: buildChannelConfigSchema(WeixinConfigSchema),
  register(api: OpenClawPluginApi) {
    if (!api?.runtime) {
      throw new Error("[weixin] api.runtime is not available in register()");
    }
    setWeixinRuntime(api.runtime);

    api.registerChannel({ plugin: weixinPlugin });
    api.registerCli(
      ({ program, config }) => registerWeixinCli({ program, config }),
      {
        commands: ["openclaw-weixin"],
      },
    );
  },
};

export default plugin;
