#!/usr/bin/env node
/**
 * Mock LLM provider that randomly returns link service error codes.
 *
 * Usage:
 *   node scripts/mock-link-errors.mjs [--port 9919] [--mode random|sequential]
 *
 * Then configure a provider in Nexu pointing to http://localhost:9919/v1
 *
 * Modes:
 *   random     — each request returns a random error (default)
 *   sequential — cycles through all error codes in order
 *   success    — always returns a valid chat completion (for sanity checks)
 */

import { createServer } from "node:http";

const PORT = Number.parseInt(
  process.argv.find((_, i, a) => a[i - 1] === "--port") ?? "9919",
  10,
);
const MODE = process.argv.find((_, i, a) => a[i - 1] === "--mode") ?? "random";

const ERRORS = [
  {
    status: 401,
    code: "missing_api_key",
    message: "[code=missing_api_key] missing api key",
  },
  {
    status: 401,
    code: "invalid_api_key",
    message: "[code=invalid_api_key] invalid api key",
  },
  {
    status: 403,
    code: "forbidden_api_key",
    message: "[code=forbidden_api_key] api key is forbidden",
  },
  {
    status: 429,
    code: "insufficient_credits",
    message: "[code=insufficient_credits] insufficient credits",
  },
  {
    status: 429,
    code: "usage_limit_exceeded",
    message: "[code=usage_limit_exceeded] usage limit exceeded for this period",
  },
  {
    status: 400,
    code: "invalid_json",
    message: "[code=invalid_json] request body is not valid JSON",
  },
  {
    status: 400,
    code: "invalid_model",
    message: "[code=invalid_model] model field is missing or empty",
  },
  {
    status: 400,
    code: "invalid_request",
    message: "[code=invalid_request] invalid request parameters",
  },
  {
    status: 404,
    code: "model_not_found",
    message: "[code=model_not_found] the requested model was not found",
  },
  {
    status: 413,
    code: "request_too_large",
    message: "[code=request_too_large] request body exceeds maximum size",
  },
  {
    status: 500,
    code: "internal_error",
    message: "[code=internal_error] internal server error",
  },
  {
    status: 500,
    code: "streaming_unsupported",
    message: "[code=streaming_unsupported] streaming is not supported",
  },
  {
    status: 502,
    code: "upstream_error",
    message: "[code=upstream_error] upstream provider is unavailable",
  },
];

let seqIndex = 0;

function pickError() {
  if (MODE === "sequential") {
    const err = ERRORS[seqIndex % ERRORS.length];
    seqIndex++;
    return err;
  }
  return ERRORS[Math.floor(Math.random() * ERRORS.length)];
}

function makeLargeContent() {
  // ~5000 tokens per response (8000+ chars of diverse Chinese text)
  // Pi tokenizer typically estimates 1 token per 1.5-2 Chinese chars
  const blocks = [];
  const themes = [
    [
      "artificial intelligence",
      "The development of AI spans decades. Early rule-based systems gave way to statistical methods, then deep learning. The perceptron model, backpropagation algorithm, convolutional neural networks for image recognition, recurrent networks for sequences, and the Transformer architecture each represent milestones. Large language models like GPT, Claude, and Gemini now demonstrate remarkable reasoning, coding, and creative abilities across multiple modalities.",
    ],
    [
      "quantum computing",
      "Quantum computing leverages quantum mechanical phenomena like superposition and entanglement to solve problems intractable for classical computers. Superconducting qubits, trapped ions, photonic systems, and topological approaches each offer unique advantages. Error correction, algorithm design, and software toolchains remain active research areas with applications in drug discovery, cryptography, and optimization.",
    ],
    [
      "cloud native",
      "Cloud-native development built on containers, Kubernetes orchestration, service meshes, and observability platforms has transformed software delivery. Microservices architecture enables independent scaling and deployment. CI/CD pipelines automate testing and release. Infrastructure-as-code tools like Terraform manage complex environments declaratively. Serverless computing further abstracts infrastructure management.",
    ],
    [
      "cybersecurity",
      "Modern cybersecurity faces evolving threats from nation-state actors, ransomware gangs, and supply chain attacks. Zero-trust architecture replaces perimeter-based security. Endpoint detection and response, security information and event management, and extended detection platforms provide layered defense. Bug bounty programs and red team exercises proactively identify vulnerabilities before adversaries exploit them.",
    ],
    [
      "distributed systems",
      "Distributed systems enable scalable, fault-tolerant computing across multiple nodes. Consensus algorithms like Raft and Paxos ensure data consistency. Event-driven architectures with message queues decouple producers from consumers. Content delivery networks cache data at edge locations worldwide. Database sharding horizontally partitions data across servers for parallel query execution.",
    ],
  ];
  for (const [topic, text] of themes) {
    blocks.push(
      `## ${topic}\n\n${text}\n\n${text.split(". ").reverse().join(". ")}`,
    );
  }
  // Repeat with variations to reach ~5000 tokens
  for (let i = 0; i < 8; i++) {
    const [topic, text] = themes[i % themes.length];
    blocks.push(
      `### Additional notes on ${topic} (part ${i + 2})\n\n${text.replace(/\./g, ";")} Furthermore, ongoing research continues to push boundaries in ${topic}, with new breakthroughs expected in the coming years. The intersection of ${topic} with other fields creates novel applications and research directions that were previously unimaginable.`,
    );
  }
  return blocks.join("\n\n---\n\n");
}

// Track cumulative prompt tokens for fill mode (simulates growing context)
let fillPromptTokens = 2000;

function makeSuccessResponse(model, stream) {
  const id = `chatcmpl-mock-${Date.now()}`;
  const content =
    MODE === "fill"
      ? makeLargeContent()
      : "Hello! I'm the mock provider responding successfully.";
  const completionTokens = MODE === "fill" ? 2000 : 20;

  if (MODE === "fill") {
    fillPromptTokens += 3000; // Each turn adds ~3000 prompt tokens
  }

  const promptTokens = MODE === "fill" ? fillPromptTokens : 10;
  const usage = {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  };

  // Always return streaming format — pi-ai always sets stream:true
  const chunks = [
    `data: ${JSON.stringify({ id, object: "chat.completion.chunk", model, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ id, object: "chat.completion.chunk", model, choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ id, object: "chat.completion.chunk", model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage })}\n\n`,
    "data: [DONE]\n\n",
  ];

  if (stream) {
    return { chunks };
  }

  return {
    json: {
      id,
      object: "chat.completion",
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content },
          finish_reason: "stop",
        },
      ],
      usage,
    },
  };
}

const server = createServer((req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ status: "ok", mode: MODE, errors: ERRORS.length }),
    );
    return;
  }

  // Models endpoint
  if (req.url === "/v1/models") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        object: "list",
        data: [
          { id: "mock-error-model", object: "model", owned_by: "mock" },
          { id: "gpt-4o", object: "model", owned_by: "mock" },
        ],
      }),
    );
    return;
  }

  // Chat completions
  if (req.url === "/v1/chat/completions" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = {};
      }

      const model = parsed.model ?? "mock-error-model";
      const stream = parsed.stream === true;
      const reqId = req.headers["x-request-id"] ?? `req-${Date.now()}`;

      // fill mode: always stream responses with realistic usage tokens
      // Pi auto-compaction triggers when usage.prompt_tokens approaches context window
      if (MODE === "fill") {
        seqIndex++;
        const msgCount = parsed.messages?.length ?? 0;
        // Detect compaction call: few messages (summarization prompt) after many turns
        if (msgCount <= 3 && seqIndex > 6) {
          console.log(
            `⏳ [${reqId}] compaction call detected (${msgCount} msgs), delaying 5s (req #${seqIndex})`,
          );
          setTimeout(() => {
            const summary =
              "## Decisions\n- User greeted multiple times\n\n## Open TODOs\n- None\n\n## Constraints/Rules\n- None\n\n## Pending user asks\n- None\n\n## Exact identifiers\n- None";
            const summaryChunks = [
              `data: ${JSON.stringify({ id: `chatcmpl-compact-${Date.now()}`, object: "chat.completion.chunk", model, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] })}\n\n`,
              `data: ${JSON.stringify({ id: `chatcmpl-compact-${Date.now()}`, object: "chat.completion.chunk", model, choices: [{ index: 0, delta: { content: summary }, finish_reason: null }] })}\n\n`,
              `data: ${JSON.stringify({ id: `chatcmpl-compact-${Date.now()}`, object: "chat.completion.chunk", model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 3000, completion_tokens: 500, total_tokens: 3500 } })}\n\n`,
              "data: [DONE]\n\n",
            ];
            res.writeHead(200, {
              "Content-Type": "text/event-stream",
              "X-Request-Id": reqId,
            });
            for (const chunk of summaryChunks) res.write(chunk);
            res.end();
            console.log(
              `✅ [${reqId}] compaction summary streamed (req #${seqIndex})`,
            );
          }, 5000);
          return;
        }
        console.log(
          `✅ [${reqId}] 200 fill stream #${seqIndex} (prompt_tokens=${fillPromptTokens})`,
        );
        // Always stream in fill mode (pi-ai sets stream:true)
        const resp = makeSuccessResponse(model, true);
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "X-Request-Id": reqId,
        });
        for (const chunk of resp.chunks) res.write(chunk);
        res.end();
        return;
      }

      if (MODE === "success") {
        const resp = makeSuccessResponse(model, stream);
        if (stream) {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "X-Request-Id": reqId,
          });
          for (const chunk of resp.chunks) res.write(chunk);
          res.end();
        } else {
          res.writeHead(200, {
            "Content-Type": "application/json",
            "X-Request-Id": reqId,
          });
          res.end(JSON.stringify(resp.json));
        }
        console.log(
          `✅ [${reqId}] 200 success (model=${model}, stream=${stream})`,
        );
        return;
      }

      const err = pickError();
      const errorBody = JSON.stringify({
        error: {
          code: err.code,
          message: err.message,
          type: err.code,
        },
      });

      console.log(`❌ [${reqId}] ${err.status} ${err.code} — "${err.message}"`);

      if (stream) {
        // For stream requests, some errors happen pre-stream (return normal HTTP error)
        // and some happen mid-stream (SSE error chunk). Simulate pre-stream errors.
        res.writeHead(err.status, {
          "Content-Type": "application/json",
          "X-Request-Id": reqId,
        });
        res.end(errorBody);
      } else {
        res.writeHead(err.status, {
          "Content-Type": "application/json",
          "X-Request-Id": reqId,
        });
        res.end(errorBody);
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      error: {
        code: "not_found",
        message: `Unknown route: ${req.method} ${req.url}`,
      },
    }),
  );
});

server.listen(PORT, () => {
  console.log(
    `\n🎯 Mock Link Error Provider running on http://localhost:${PORT}/v1`,
  );
  console.log(`   Mode: ${MODE}`);
  console.log(`   Errors: ${ERRORS.length} types\n`);
  console.log("   Configure in Nexu as a custom OpenAI-compatible provider:");
  console.log(`     Base URL: http://localhost:${PORT}/v1`);
  console.log("     API Key:  any-value");
  console.log("     Model:    mock-error-model\n");
  if (MODE === "sequential") {
    console.log("   Sequential mode: will cycle through errors in order.\n");
  }
  console.log("   Ctrl+C to stop.\n");
  console.log("---");
});
