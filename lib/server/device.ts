import { createHmac } from "node:crypto";
import { serverEnv } from "@/lib/server/env";
import type { NextRequest } from "next/server";
import { getRemoteIp } from "@/lib/server/turnstile";

/**
 * Server-side device context for login security records.
 *
 * The client sends a device fingerprint hash (see
 * lib/device-fingerprint.ts); the server pairs it with facts only it
 * can see — the request's user agent (parsed into browser / OS /
 * device type) and the IP address, stored as an HMAC hash so raw
 * IPs never land in the database while equal IPs still correlate
 * across sessions and events. See SECURITY.md ("Device signals").
 */

export type DeviceContext = {
  /** Validated client fingerprint (64 hex chars), or null. */
  deviceId: string | null;
  userAgent: string | null;
  browser: string;
  os: string;
  deviceType: "mobile" | "tablet" | "desktop";
  /** Human label, e.g. "Chrome on Android". */
  label: string;
  /** HMAC-SHA256 of the client IP, or null when unavailable. */
  ipHash: string | null;
};

export function parseUserAgent(userAgent: string | null): {
  browser: string;
  os: string;
  deviceType: "mobile" | "tablet" | "desktop";
  label: string;
} {
  if (!userAgent) {
    return {
      browser: "Browser",
      os: "Unknown system",
      deviceType: "desktop",
      label: "Unknown device",
    };
  }
  const os = /Windows NT/.test(userAgent)
    ? "Windows"
    : /Android/.test(userAgent)
      ? "Android"
      : /iPhone/.test(userAgent)
        ? "iPhone"
        : /iPad/.test(userAgent)
          ? "iPad"
          : /Mac OS X/.test(userAgent)
            ? "macOS"
            : /Linux/.test(userAgent)
              ? "Linux"
              : "Unknown system";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /OPR\/|Opera/.test(userAgent)
      ? "Opera"
      : /SamsungBrowser\//.test(userAgent)
        ? "Samsung Internet"
        : /Chrome\//.test(userAgent)
          ? "Chrome"
          : /Firefox\//.test(userAgent)
            ? "Firefox"
            : /Safari\//.test(userAgent)
              ? "Safari"
              : "Browser";
  const deviceType = /iPad|Tablet/.test(userAgent)
    ? "tablet"
    : /Mobi|Android|iPhone/.test(userAgent)
      ? "mobile"
      : "desktop";
  return { browser, os, deviceType, label: `${browser} on ${os}` };
}

export function hashIpAddress(ip: string | null): string | null {
  const secret = serverEnv.sessionSecret;
  if (!ip || !secret) return null;
  return createHmac("sha256", secret).update(ip).digest("hex");
}

const DEVICE_ID_PATTERN = /^[0-9a-f]{64}$/;

/** Builds the device context for an auth request. Never throws. */
export function getDeviceContext(
  request: NextRequest,
  rawDeviceId: unknown,
): DeviceContext {
  const userAgent = request.headers.get("user-agent");
  const parsed = parseUserAgent(userAgent);
  return {
    deviceId:
      typeof rawDeviceId === "string" && DEVICE_ID_PATTERN.test(rawDeviceId)
        ? rawDeviceId
        : null,
    userAgent: userAgent ? userAgent.slice(0, 512) : null,
    browser: parsed.browser,
    os: parsed.os,
    deviceType: parsed.deviceType,
    label: parsed.label,
    ipHash: hashIpAddress(getRemoteIp(request) ?? null),
  };
}
