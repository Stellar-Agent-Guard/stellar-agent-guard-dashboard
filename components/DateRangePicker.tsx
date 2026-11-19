"use client";

/**
 * The telemetry query's date/time range picker (#148).
 *
 * Operators investigating a historical incident need "everything between
 * Tuesday 14:00 and 16:00", not only the live tail. This picker expresses
 * that range with presets (last hour / 24 hours / 7 days) or an explicit
 * custom calendar range, and reports Unix-seconds bounds to `TelemetryFeed`,
 * which converts them to ledger sequences via `ledgerTime.ts` — the chain
 * queries ledgers, humans think in timestamps.
 *
 * Accessibility follows the console's existing conventions: every control is
 * a labelled native control (so it works with a keyboard and a screen reader
 * with no extra widget code), and the preset group is a radiogroup because
 * the presets are mutually exclusive choices.
 */

import { useId, useMemo, useRef, useState } from "react";
import { announce } from "../lib/guard/useAnnounce.ts";
import {
  RANGE_PRESETS,
  datetimeLocalToUnixSecs,
  describeAppliedRange,
  futureBoundError,
  presetLabel,
  resolvePreset,
  unixSecsToDatetimeLocal,
  validateRange,
  type RangePreset,
  type TimeRange,
} from "../lib/guard/ledgerTime.ts";

/**
 * Apply a preset range to `onApply`, resolving it against the current clock.
 *
 * Defined at module level because it reads the clock — an impure call — and
 * the React compiler's purity rule correctly forbids that inside a component
 * body, while an event-handler helper outside it is exactly where a clock
 * read belongs.
 */
function applyPreset(
  preset: Exclude<RangePreset, "custom">,
  onApply: (range: TimeRange, preset: RangePreset) => void,
): void {
  const nowSecs = Math.floor(Date.now() / 1000);
  onApply(resolvePreset(preset, nowSecs), preset);
  announce(`Showing events from ${presetLabel(preset).toLowerCase()}`);
}

/** The latest selectable moment, as a datetime-local value. Reads the clock, so it lives here. */
function latestSelectable(): string {
  return unixSecsToDatetimeLocal(Math.floor(Date.now() / 1000));
}

export function DateRangePicker({
  onApply,
  disabled = false,
}: {
  onApply: (range: TimeRange, preset: RangePreset) => void;
  disabled?: boolean;
}) {
  const [preset, setPreset] = useState<RangePreset>("24h");
  const [fromValue, setFromValue] = useState("");
  const [toValue, setToValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  // The preset to fall back to when the custom panel is dismissed.
  const lastPreset = useRef<Exclude<RangePreset, "custom">>("24h");
  const [maxValue, setMaxValue] = useState<string>(latestSelectable);
  const fromRef = useRef<HTMLInputElement>(null);
  const applyRef = useRef<HTMLButtonElement>(null);
  const radioRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const hintId = useId();
  const errorId = useId();

  const customRange = useMemo<TimeRange>(
    () => ({
      fromUnixSecs: datetimeLocalToUnixSecs(fromValue),
      toUnixSecs: datetimeLocalToUnixSecs(toValue),
    }),
    [fromValue, toValue],
  );

  function choosePreset(next: RangePreset) {
    setPreset(next);
    setError(null);
    if (next === "custom") {
      setMaxValue(latestSelectable());
      announce("Custom range: choose a start and an end date and time, then apply.");
    } else {
      lastPreset.current = next;
      // Presets apply immediately: they need no further input, and a telemetry
      // range that requires a second click to take effect reads as broken.
      applyPreset(next, onApply);
    }
  }

  function applyCustom() {
    const problem =
      validateRange(customRange) ?? futureBoundError(customRange, Math.floor(Date.now() / 1000));
    if (problem !== null) {
      setError(problem);
      announce(`That range cannot be queried. ${problem}`, "assertive");
      // The message is next to the inputs; put the operator on the first one to fix.
      fromRef.current?.focus();
      return;
    }
    setError(null);
    onApply(customRange, "custom");
    announce(`Showing events ${describeAppliedRange(customRange)}`);
    applyRef.current?.focus();
  }

  /** Escape dismisses the custom panel, back to the last preset, with focus on its radio. */
  function dismissCustom() {
    const fallback = lastPreset.current;
    setPreset(fallback);
    setError(null);
    announce("Custom range closed");
    // The inputs unmount with the panel, so focus has to be placed before they go.
    radioRefs.current["custom"]?.focus();
  }

  /** Arrow keys move the checked radio, as in a native radio group. */
  function onRadioKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const keys: Record<string, number> = {
      ArrowRight: 1,
      ArrowDown: 1,
      ArrowLeft: -1,
      ArrowUp: -1,
    };
    const step = keys[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const target = RANGE_PRESETS[(index + step + RANGE_PRESETS.length) % RANGE_PRESETS.length]!;
    choosePreset(target.id);
    radioRefs.current[target.id]?.focus();
  }

  return (
    <div className="stack" role="group" aria-label="Telemetry time range">
      <div className="row" role="radiogroup" aria-label="Time range preset">
        {RANGE_PRESETS.map(({ id, label }, index) => (
          <button
            key={id}
            ref={(node) => {
              radioRefs.current[id] = node;
            }}
            type="button"
            role="radio"
            aria-checked={preset === id}
            tabIndex={preset === id ? 0 : -1}
            onKeyDown={(event) => onRadioKeyDown(event, index)}
            className="secondary"
            style={
              preset === id ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined
            }
            onClick={() => choosePreset(id)}
            disabled={disabled}
          >
            {label}
          </button>
        ))}
      </div>

      {preset === "custom" && (
        <div
          role="group"
          aria-label="Custom range"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              dismissCustom();
            }
          }}
        >
          <p className="tiny muted" id={hintId} style={{ margin: "0 0 6px" }}>
            Dates after {maxValue.replace("T", " ")} are disabled: the chain has no events from the
            future. Press Escape to close this panel.
          </p>
          <div className="row">
            <label className="field" style={{ marginBottom: 0, flex: 1 }}>
              <span className="lbl">From</span>
              <input
                ref={fromRef}
                type="datetime-local"
                max={maxValue}
                aria-describedby={error ? `${hintId} ${errorId}` : hintId}
                aria-invalid={error ? true : undefined}
                value={fromValue}
                onChange={(event) => {
                  setFromValue(event.target.value);
                  setError(null);
                }}
                disabled={disabled}
                aria-label="Range start date and time"
              />
            </label>
            <label className="field" style={{ marginBottom: 0, flex: 1 }}>
              <span className="lbl">To</span>
              <input
                type="datetime-local"
                max={maxValue}
                aria-describedby={error ? `${hintId} ${errorId}` : hintId}
                aria-invalid={error ? true : undefined}
                value={toValue}
                onChange={(event) => {
                  setToValue(event.target.value);
                  setError(null);
                }}
                disabled={disabled}
                aria-label="Range end date and time"
              />
            </label>
            <button
              ref={applyRef}
              type="button"
              onClick={applyCustom}
              disabled={disabled}
              style={{ alignSelf: "flex-end" }}
            >
              Apply range
            </button>
          </div>
          {error && (
            <div className="error" role="alert" id={errorId}>
              <span className="t">That range cannot be queried</span>
              <span className="tiny">{error}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
