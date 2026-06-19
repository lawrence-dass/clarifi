import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { ConsoleSpanExporter, SimpleSpanProcessor, BatchSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME ?? "clarifi-api";
const SERVICE_VERSION = "1.1.0";
const OTLP_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

function buildSpanProcessor() {
  if (OTLP_ENDPOINT) {
    return new BatchSpanProcessor(new OTLPTraceExporter({ url: `${OTLP_ENDPOINT}/v1/traces` }));
  }
  if (process.env.NODE_ENV === "development") {
    return new SimpleSpanProcessor(new ConsoleSpanExporter());
  }
  return undefined;
}

const spanProcessor = buildSpanProcessor();

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: SERVICE_NAME,
    [ATTR_SERVICE_VERSION]: SERVICE_VERSION,
  }),
  ...(spanProcessor ? { spanProcessors: [spanProcessor] } : {}),
  instrumentations: [
    getNodeAutoInstrumentations({
      "@opentelemetry/instrumentation-http": { enabled: true },
      "@opentelemetry/instrumentation-express": { enabled: true },
      // Disable noisy instrumentations irrelevant to this service
      "@opentelemetry/instrumentation-fs": { enabled: false },
    }),
  ],
});

sdk.start();

process.on("SIGTERM", () => {
  sdk.shutdown().catch(() => {});
});
