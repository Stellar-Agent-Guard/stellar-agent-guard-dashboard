/**
 * Webhook destination URL validation for client-side safety.
 *
 * This module validates webhook destination URLs before they are saved or used.
 * It is strictly client-side and does not provide server-side SSRF protection.
 * The goal is to catch common mistakes (typos, insecure schemes, embedded credentials)
 * before event metadata leaks to an unintended endpoint.
 *
 * Browser CORS and actual delivery behavior are controlled by the remote service —
 * this validation only checks URL syntax and scheme allowlists.
 */

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

const ALLOWED_SCHEMES = ["https:", "http:"] as const;
const PRODUCTION_SCHEMES = ["https:"] as const;

/**
 * Validate a webhook destination URL.
 *
 * Checks:
 * - Scheme is allowed (https only in production, http+https in development)
 * - No embedded credentials (user:pass@host)
 * - Host is present and syntactically valid
 * - No malformed or suspicious patterns
 *
 * @param url - The URL string to validate
 * @param isProduction - Whether we're in production mode (restricts to https only)
 * @returns ValidationResult with valid flag and optional reason for rejection
 */
export function validateWebhookUrl(
  url: string,
  isProduction: boolean = true
): ValidationResult {
  // Trim whitespace first
  const trimmed = url.trim();

  // Reject empty or whitespace-only strings
  if (!trimmed) {
    return { valid: false, reason: "URL cannot be empty" };
  }

  // Check for leading/trailing whitespace in original
  if (url !== trimmed) {
    return { valid: false, reason: "URL must not contain leading or trailing whitespace" };
  }

  // Parse the URL
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, reason: "URL is malformed" };
  }

  // Check scheme
  const scheme = parsed.protocol.toLowerCase();
  const allowedSchemes = isProduction ? PRODUCTION_SCHEMES : ALLOWED_SCHEMES;

  if (!allowedSchemes.includes(scheme as any)) {
    const schemeList = allowedSchemes.join(", ");
    return {
      valid: false,
      reason: `Unsupported URL scheme "${scheme}". Only ${schemeList} are allowed`,
    };
  }

  // Reject embedded credentials (username:password@host)
  if (parsed.username || parsed.password) {
    return {
      valid: false,
      reason: "URL must not contain embedded credentials (user:pass@host)",
    };
  }

  // Validate hostname
  const hostname = parsed.hostname;
  if (!hostname) {
    return { valid: false, reason: "URL must have a valid hostname" };
  }

  // Allow localhost and private IPs in development mode
  if (!isProduction) {
    // In development, skip localhost/private IP checks but still validate hostname format
    if (!isValidHostname(hostname)) {
      return { valid: false, reason: "Hostname is invalid or malformed" };
    }
    return { valid: true };
  }

  // Production mode: reject localhost
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return {
      valid: false,
      reason: "Localhost URLs are not allowed in production",
    };
  }

  // Production mode: reject private IP ranges
  if (isPrivateIp(hostname)) {
    return {
      valid: false,
      reason: "Private IP addresses are not allowed in production",
    };
  }

  // Validate hostname format (basic check)
  if (!isValidHostname(hostname)) {
    return { valid: false, reason: "Hostname is invalid or malformed" };
  }

  return { valid: true };
}

/**
 * Check if a hostname is a private IP address.
 */
function isPrivateIp(hostname: string): boolean {
  // IPv4 private ranges
  const ipv4Pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = hostname.match(ipv4Pattern);

  if (match && match.length >= 3) {
    const a = parseInt(match[1]!, 10);
    const b = parseInt(match[2]!, 10);
    // 10.0.0.0/8
    if (a === 10) return true;
    // 172.16.0.0/12
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16
    if (a === 192 && b === 168) return true;
    // 127.0.0.0/8 (loopback)
    if (a === 127) return true;
  }

  // IPv6 loopback and link-local
  if (hostname === "::1" || hostname === "localhost") return true;

  return false;
}

/**
 * Basic hostname validation.
 */
function isValidHostname(hostname: string): boolean {
  // Must not be empty
  if (!hostname || hostname.length > 253) return false;

  // Allow IPv4 and IPv6
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true; // IPv4
  if (/^[0-9a-fA-F:]+$/.test(hostname) && hostname.includes(":")) return true; // IPv6-like

  // Domain name validation
  const labels = hostname.split(".");
  
  // Single-label hostnames (like localhost) are valid for development/testing
  if (labels.length === 1) {
    // Must still be a valid label format
    if (!labels[0] || labels[0].length > 63) return false;
    return /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(labels[0]);
  }

  for (const label of labels) {
    if (!label || label.length > 63) return false;
    // Labels must start and end with alphanumeric, can contain hyphens
    if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label)) {
      return false;
    }
  }

  return true;
}

/**
 * Format a user-friendly explanation of browser-side webhook limitations.
 */
export function getBrowserLimitationsNotice(): string {
  return (
    "Note: This dashboard runs entirely in your browser. " +
    "Actual webhook delivery depends on the remote service's CORS policy " +
    "and network accessibility. The dashboard cannot guarantee delivery " +
    "or bypass browser security restrictions."
  );
}
