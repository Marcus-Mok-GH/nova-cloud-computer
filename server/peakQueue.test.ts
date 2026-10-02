import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PEAK_END_HOUR_UTC,
  DEFAULT_PEAK_START_HOUR_UTC,
  formatPeakWindow,
  getPeakWindow,
  isPeakHour,
  isPeakQueueEnabled,
  parsePeakWindow,
  priorityActiveMessage,
  queuePositionMessage,
  shouldQueue,
} from "./peakQueue";

const atUtc = (hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 9, 2, hour, minute, 0, 0));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("parsePeakWindow", () => {
  it("defaults to 14-18 UTC when unset or unparseable", () => {
    expect(parsePeakWindow(undefined)).toEqual({
      startHour: DEFAULT_PEAK_START_HOUR_UTC,
      endHour: DEFAULT_PEAK_END_HOUR_UTC,
    });
    expect(parsePeakWindow("  ")).toEqual({
      startHour: DEFAULT_PEAK_START_HOUR_UTC,
      endHour: DEFAULT_PEAK_END_HOUR_UTC,
    });
    expect(parsePeakWindow("nonsense")).toEqual({
      startHour: DEFAULT_PEAK_START_HOUR_UTC,
      endHour: DEFAULT_PEAK_END_HOUR_UTC,
    });
  });

  it("parses an explicit window and tolerates surrounding whitespace", () => {
    expect(parsePeakWindow("9-17")).toEqual({ startHour: 9, endHour: 17 });
    expect(parsePeakWindow(" 22 - 6 ")).toEqual({ startHour: 22, endHour: 6 });
  });

  it("treats a single hour as a one-hour window", () => {
    expect(parsePeakWindow("14")).toEqual({ startHour: 14, endHour: 15 });
    expect(parsePeakWindow("23")).toEqual({ startHour: 23, endHour: 0 });
  });

  it("rejects equal bounds rather than queueing nothing", () => {
    expect(parsePeakWindow("14-14")).toEqual({
      startHour: DEFAULT_PEAK_START_HOUR_UTC,
      endHour: DEFAULT_PEAK_END_HOUR_UTC,
    });
  });
});

describe("isPeakHour", () => {
  const window = { startHour: 14, endHour: 18 };

  it("includes the start hour and excludes the end hour", () => {
    expect(isPeakHour(atUtc(13, 59), window)).toBe(false);
    expect(isPeakHour(atUtc(14, 0), window)).toBe(true);
    expect(isPeakHour(atUtc(17, 59), window)).toBe(true);
    expect(isPeakHour(atUtc(18, 0), window)).toBe(false);
  });

  it("handles a window that wraps past midnight", () => {
    const overnight = { startHour: 22, endHour: 6 };
    expect(isPeakHour(atUtc(21), overnight)).toBe(false);
    expect(isPeakHour(atUtc(23), overnight)).toBe(true);
    expect(isPeakHour(atUtc(3), overnight)).toBe(true);
    expect(isPeakHour(atUtc(7), overnight)).toBe(false);
  });
});

describe("isPeakQueueEnabled", () => {
  it("is on by default", () => {
    vi.stubEnv("NOVA_PEAK_QUEUE", "");
    expect(isPeakQueueEnabled()).toBe(true);
  });

  it("is off for the documented falsey values", () => {
    for (const value of ["off", "false", "0", "disabled", "OFF"]) {
      vi.stubEnv("NOVA_PEAK_QUEUE", value);
      expect(isPeakQueueEnabled()).toBe(false);
    }
  });
});

describe("shouldQueue", () => {
  it("queues only when enabled and inside the window", () => {
    vi.stubEnv("NOVA_PEAK_QUEUE", "on");
    vi.stubEnv("NOVA_PEAK_HOURS_UTC", "14-18");
    expect(shouldQueue(atUtc(12))).toBe(false);
    expect(shouldQueue(atUtc(15))).toBe(true);
  });

  it("never queues outside peak even if the window matches the clock", () => {
    vi.stubEnv("NOVA_PEAK_QUEUE", "off");
    vi.stubEnv("NOVA_PEAK_HOURS_UTC", "14-18");
    expect(shouldQueue(atUtc(15))).toBe(false);
  });
});

describe("formatPeakWindow and queuePositionMessage", () => {
  it("labels the window in UTC", () => {
    vi.stubEnv("NOVA_PEAK_HOURS_UTC", "14-18");
    expect(getPeakWindow()).toEqual({ startHour: 14, endHour: 18 });
    expect(formatPeakWindow()).toBe("14:00-18:00 UTC");
    expect(formatPeakWindow({ startHour: 23, endHour: 0 })).toBe("23:00-00:00 UTC");
  });

  it("formats the position notice with a one-based floor", () => {
    expect(queuePositionMessage(1)).toBe("You are 1 in the queue.");
    expect(queuePositionMessage(4)).toBe("You are 4 in the queue.");
    expect(queuePositionMessage(0)).toBe("You are 1 in the queue.");
    expect(queuePositionMessage(Number.NaN)).toBe("You are 1 in the queue.");
  });

  it("confirms the priority hour on the message that starts it", () => {
    expect(priorityActiveMessage()).toBe(
      "Priority active for 1 hour. Your requests now jump ahead during peak hours."
    );
  });
});
