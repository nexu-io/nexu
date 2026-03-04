import { logger } from "./logger.js";

type DatadogSpan = {
  setTag: (key: string, value: unknown) => void;
};

type DatadogTracer = {
  trace: <T>(
    spanName: string,
    options: Record<string, unknown>,
    callback: (span: DatadogSpan) => T,
  ) => T;
};

let tracerPromise: Promise<DatadogTracer | null> | null = null;

async function getTracer(): Promise<DatadogTracer | null> {
  if (!process.env.DD_ENV) {
    return null;
  }

  if (tracerPromise) {
    return tracerPromise;
  }

  tracerPromise = import("dd-trace")
    .then((module) => {
      const candidate = (module.default?.tracer ?? module.default) as {
        trace?: DatadogTracer["trace"];
      };

      if (typeof candidate.trace !== "function") {
        return null;
      }

      return {
        trace: candidate.trace.bind(candidate),
      };
    })
    .catch(() => null);

  return tracerPromise;
}

type AsyncMethod = (...args: unknown[]) => Promise<unknown>;

function decorateWithSpan(spanName: string, spanType: "trace" | "span") {
  return (
    _target: object,
    _propertyKey: string,
    descriptor: PropertyDescriptor,
  ): void => {
    const original = descriptor.value;

    if (typeof original !== "function") {
      return;
    }

    descriptor.value = async function (...args: unknown[]) {
      const tracer = await getTracer();

      if (!tracer) {
        logger.info({
          message: "trace_local_event",
          span_name: spanName,
          span_type: spanType,
        });
        return (original as AsyncMethod).apply(this, args);
      }

      return tracer.trace(
        spanName,
        {
          resource: spanName,
          tags: {
            span_type: spanType,
          },
        },
        async (span) => {
          try {
            return await (original as AsyncMethod).apply(this, args);
          } catch (error) {
            span.setTag("error", true);
            if (error instanceof Error) {
              span.setTag("error.type", error.name || "Error");
              span.setTag("error.msg", error.message || "unknown_error");
            }
            throw error;
          }
        },
      );
    };
  };
}

export function Trace(spanName: string) {
  return decorateWithSpan(spanName, "trace");
}

export function Span(spanName: string) {
  return decorateWithSpan(spanName, "span");
}
