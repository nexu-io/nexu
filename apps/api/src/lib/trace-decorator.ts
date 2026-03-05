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

type SpanTags = Record<string, unknown>;
type SpanTagResolver = (args: unknown[]) => SpanTags | undefined;

type SpanDecoratorOptions = {
  tags?: SpanTags | SpanTagResolver;
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

async function executeSpan<T>(
  spanName: string,
  spanType: "trace" | "span",
  run: () => Promise<T>,
  tags?: SpanTags,
): Promise<T> {
  const tracer = await getTracer();

  if (!tracer) {
    logger.info({
      message: "trace_local_event",
      span_name: spanName,
      span_type: spanType,
      ...(tags ?? {}),
    });
    return run();
  }

  return tracer.trace(
    spanName,
    {
      resource: spanName,
      tags: {
        span_type: spanType,
        ...(tags ?? {}),
      },
    },
    async (span) => {
      try {
        return await run();
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
}

function resolveDecoratorTags(
  options: SpanDecoratorOptions | undefined,
  args: unknown[],
): SpanTags | undefined {
  if (!options?.tags) {
    return undefined;
  }

  if (typeof options.tags === "function") {
    return options.tags(args);
  }

  return options.tags;
}

function decorateWithSpan(
  spanName: string,
  spanType: "trace" | "span",
  options?: SpanDecoratorOptions,
) {
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
      const tags = resolveDecoratorTags(options, args);
      return executeSpan(
        spanName,
        spanType,
        () => (original as AsyncMethod).apply(this, args),
        tags,
      );
    };
  };
}

export function Trace(spanName: string, options?: SpanDecoratorOptions) {
  return decorateWithSpan(spanName, "trace", options);
}

export function Span(spanName: string, options?: SpanDecoratorOptions) {
  return decorateWithSpan(spanName, "span", options);
}
