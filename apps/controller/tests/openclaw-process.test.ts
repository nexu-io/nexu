import { describe, expect, it } from "vitest";
import {
  type OpenClawRuntimeEvent,
  createOpenClawLogEventProcessor,
} from "../src/runtime/openclaw-process.js";

function createEventSink() {
  const events: OpenClawRuntimeEvent[] = [];
  return {
    emitRuntimeEvent(event: OpenClawRuntimeEvent) {
      events.push(event);
    },
    events,
  };
}

describe("createOpenClawLogEventProcessor", () => {
  it("synthesizes feishu reply outcome failures from provider/model log lines", () => {
    const sink = createEventSink();
    const processLine = createOpenClawLogEventProcessor(sink);

    processLine(
      "2026-04-03T16:48:52.190+08:00 [feishu] feishu[acc-1]: received message from ou_user in oc_123 (p2p)",
    );
    processLine(
      "2026-04-03T16:48:52.206+08:00 [feishu] feishu[acc-1]: dispatching to agent (session=sess-1)",
    );
    processLine(
      "2026-04-03T16:48:52.563+08:00 [agent/embedded] embedded run agent end: runId=run-1 isError=true error=429 [code=insufficient_credits] insufficient credits",
    );

    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]).toMatchObject({
      event: "channel.reply_outcome",
      payload: {
        channel: "feishu",
        status: "failed",
        accountId: "acc-1",
        chatId: "oc_123",
        sessionKey: "sess-1",
        messageId: "feishu:run-1",
        actionId: "feishu:run-1",
        reasonCode: "synthetic_pre_llm_failure",
        error:
          "2026-04-03T16:48:52.563+08:00 [agent/embedded] embedded run agent end: runId=run-1 isError=true error=429 [code=insufficient_credits] insufficient credits",
      },
    });
  });

  it("ignores unknown or non-provider log lines", () => {
    const sink = createEventSink();
    const processLine = createOpenClawLogEventProcessor(sink);

    processLine(
      "2026-04-03T16:48:52.190+08:00 [feishu] feishu[acc-1]: received message from ou_user in oc_123 (p2p)",
    );
    processLine(
      "2026-04-03T16:48:52.206+08:00 [feishu] feishu[acc-1]: dispatching to agent (session=sess-1)",
    );
    processLine(
      "2026-04-03T16:48:52.563+08:00 [agent/embedded] embedded run agent end: runId=run-1 isError=true error=Context overflow: prompt too large for the model.",
    );
    processLine(
      "2026-04-03T16:48:53.563+08:00 [agent/embedded] embedded run agent end: runId=run-1 isError=true error=429 [code=unknown_provider_error] not supported",
    );
    processLine(
      "2026-04-03T16:48:54.563+08:00 [openclaw] some unrelated error happened",
    );

    expect(sink.events).toHaveLength(0);
  });
});
