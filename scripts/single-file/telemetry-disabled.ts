// Drop-in replacement for src/telemetry.ts, used only by the single-file build
// (scripts/build-single-file.mjs). It exports the same API as the real module
// but is always disabled: it imports no analytics client and reads no
// environment variable, so nothing can switch telemetry on in that build.
// The npm build (tsc) never sees this file and keeps src/telemetry.ts.

import type { Telemetry, TelemetryProperties } from "../../src/telemetry.js";

export type { Telemetry, TelemetryProperties };

/** Same contract as src/telemetry.ts: error names are reduced to built-in types. */
export function telemetryErrorType(error: unknown): string {
  if (!(error instanceof Error)) return "UnknownError";
  return ["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "URIError", "EvalError", "AggregateError"].includes(error.name)
    ? error.name
    : "Error";
}

export function captureActivationEvent(
  telemetry: Telemetry,
  properties: { backend: "cep" | "uxp" },
): void {
  telemetry.capture("premiere_mcp_activation_completed", {
    activation_stage: "verified_connection",
    backend: properties.backend,
  });
}

const disabledTelemetry: Telemetry = {
  enabled: false,
  capture: () => {},
  shutdown: async () => {},
};

export function getTelemetry(): Telemetry {
  return disabledTelemetry;
}
