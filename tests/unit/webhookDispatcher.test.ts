import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  validateWebhookUrl,
  getBrowserLimitationsNotice,
} from "../../lib/guard/webhookDispatcher.ts";

describe("validateWebhookUrl", () => {
  describe("valid HTTPS URLs (production)", () => {
    it("accepts a standard HTTPS URL", () => {
      const result = validateWebhookUrl("https://example.com/webhook");
      assert.equal(result.valid, true);
    });

    it("accepts HTTPS with subdomain", () => {
      const result = validateWebhookUrl("https://api.example.com/hook");
      assert.equal(result.valid, true);
    });

    it("accepts HTTPS with port", () => {
      const result = validateWebhookUrl("https://example.com:8443/webhook");
      assert.equal(result.valid, true);
    });

    it("accepts HTTPS with path and query", () => {
      const result = validateWebhookUrl(
        "https://hooks.example.com/receive?token=abc123"
      );
      assert.equal(result.valid, true);
    });

    it("accepts HTTPS with fragment", () => {
      const result = validateWebhookUrl("https://example.com/webhook#section");
      assert.equal(result.valid, true);
    });
  });

  describe("valid HTTP URLs (development only)", () => {
    it("rejects HTTP in production mode", () => {
      const result = validateWebhookUrl("http://example.com/webhook", true);
      assert.equal(result.valid, false);
      assert.ok(result.reason?.includes("Unsupported URL scheme"));
    });

    it("accepts HTTP in development mode", () => {
      const result = validateWebhookUrl("http://example.com/webhook", false);
      assert.equal(result.valid, true);
    });
  });

  describe("whitespace handling", () => {
    it("rejects leading whitespace", () => {
      const result = validateWebhookUrl(" https://example.com/webhook");
      assert.equal(result.valid, false);
      assert.ok(result.reason?.includes("whitespace"));
    });

    it("rejects trailing whitespace", () => {
      const result = validateWebhookUrl("https://example.com/webhook ");
      assert.equal(result.valid, false);
      assert.ok(result.reason?.includes("whitespace"));
    });

    it("rejects both leading and trailing whitespace", () => {
      const result = validateWebhookUrl(" https://example.com/webhook ");
      assert.equal(result.valid, false);
      assert.ok(result.reason?.includes("whitespace"));
    });

    it("rejects empty string", () => {
      const result = validateWebhookUrl("");
      assert.equal(result.valid, false);
      assert.ok(result.reason?.includes("empty"));
    });

    it("rejects whitespace-only string", () => {
      const result = validateWebhookUrl("   ");
      assert.equal(result.valid, false);
      assert.ok(result.reason?.includes("empty"));
    });
  });

  describe("embedded credentials rejection", () => {
    it("rejects URL with username", () => {
      const result = validateWebhookUrl(
        "https://user@example.com/webhook"
      );
      assert.equal(result.valid, false);
      assert.ok(result.reason?.includes("credentials"));
    });

    it("rejects URL with username and password", () => {
      const result = validateWebhookUrl(
        "https://user:pass@example.com/webhook"
      );
      assert.equal(result.valid, false);
      assert.ok(result.reason?.includes("credentials"));
    });

    it("rejects URL with password only", () => {
      const result = validateWebhookUrl(
        "https://:pass@example.com/webhook"
      );
      assert.equal(result.valid, false);
      assert.ok(result.reason?.includes("credentials"));
    });
  });

  describe("insecure schemes rejection", () => {
    it("rejects ftp scheme", () => {
      const result = validateWebhookUrl("ftp://example.com/file");
      assert.equal(result.valid, false);
      assert.ok(result.reason?.includes("Unsupported URL scheme"));
    });

    it("rejects ws (WebSocket) scheme", () => {
      const result = validateWebhookUrl("ws://example.com/socket");
      assert.equal(result.valid, false);
      assert.ok(result.reason?.includes("Unsupported URL scheme"));
    });

    it("rejects wss (secure WebSocket) scheme", () => {
      const result = validateWebhookUrl("wss://example.com/socket");
      assert.equal(result.valid, false);
      assert.ok(result.reason?.includes("Unsupported URL scheme"));
    });

    it("rejects file scheme", () => {
      const result = validateWebhookUrl("file:///etc/passwd");
      assert.equal(result.valid, false);
      assert.ok(result.reason?.includes("Unsupported URL scheme"));
    });

    it("rejects data scheme", () => {
      const result = validateWebhookUrl("data:text/plain,hello");
      assert.equal(result.valid, false);
      assert.ok(result.reason?.includes("Unsupported URL scheme"));
    });

    it("rejects javascript scheme", () => {
      const result = validateWebhookUrl("javascript:alert('xss')");
      assert.equal(result.valid, false);
      assert.ok(result.reason?.includes("Unsupported URL scheme"));
    });
  });

  describe("invalid hosts rejection", () => {
    it("rejects malformed URL", () => {
      const result = validateWebhookUrl("not-a-url");
      assert.equal(result.valid, false);
      assert.ok(result.reason?.includes("malformed"));
    });

    it("rejects URL without hostname", () => {
      // URLs like "https:///path" get parsed with "path" as hostname, so use empty host
      const result = validateWebhookUrl("https://");
      assert.equal(result.valid, false);
      assert.ok(result.reason?.includes("malformed"));
    });

    it("rejects single-label hostname", () => {
      const result = validateWebhookUrl("https://localhost/webhook");
      assert.equal(result.valid, false);
      assert.ok(result.reason?.includes("hostname") || result.reason?.includes("Localhost"));
    });

    it("rejects hostname with invalid characters", () => {
      const result = validateWebhookUrl("https://exam!ple.com/webhook");
      assert.equal(result.valid, false);
      assert.ok(result.reason?.includes("hostname") || result.reason?.includes("invalid"));
    });

    it("rejects hostname starting with hyphen", () => {
      const result = validateWebhookUrl("https://-example.com/webhook");
      assert.equal(result.valid, false);
      assert.ok(result.reason?.includes("hostname") || result.reason?.includes("invalid"));
    });

    it("rejects hostname ending with hyphen", () => {
      const result = validateWebhookUrl("https://example-.com/webhook");
      assert.equal(result.valid, false);
      assert.ok(result.reason?.includes("hostname") || result.reason?.includes("invalid"));
    });
  });

  describe("localhost and private IP rejection in production", () => {
    it("rejects localhost in production", () => {
      const result = validateWebhookUrl("https://localhost:3000/webhook", true);
      assert.equal(result.valid, false);
      assert.ok(result.reason?.includes("Localhost") || result.reason?.includes("private"));
    });

    it("rejects 127.0.0.1 in production", () => {
      const result = validateWebhookUrl("https://127.0.0.1:3000/webhook", true);
      assert.equal(result.valid, false);
      assert.ok(result.reason?.includes("private") || result.reason?.includes("Localhost"));
    });

    it("rejects 10.x.x.x in production", () => {
      const result = validateWebhookUrl("https://10.0.0.1/webhook", true);
      assert.equal(result.valid, false);
      assert.ok(result.reason?.toLowerCase().includes("private"));
    });

    it("rejects 172.16.x.x in production", () => {
      const result = validateWebhookUrl("https://172.16.0.1/webhook", true);
      assert.equal(result.valid, false);
      assert.ok(result.reason?.toLowerCase().includes("private"));
    });

    it("rejects 192.168.x.x in production", () => {
      const result = validateWebhookUrl("https://192.168.1.1/webhook", true);
      assert.equal(result.valid, false);
      assert.ok(result.reason?.toLowerCase().includes("private"));
    });

    it("allows localhost in development", () => {
      const result = validateWebhookUrl("https://localhost:3000/webhook", false);
      assert.equal(result.valid, true);
    });

    it("allows 127.0.0.1 in development", () => {
      const result = validateWebhookUrl("https://127.0.0.1:3000/webhook", false);
      assert.equal(result.valid, true);
    });
  });

  describe("edge cases", () => {
    it("handles very long valid URL", () => {
      const longPath = "/".repeat(100);
      const result = validateWebhookUrl(`https://example.com${longPath}`);
      assert.equal(result.valid, true);
    });

    it("accepts URL with multiple subdomains", () => {
      const result = validateWebhookUrl(
        "https://api.v2.staging.example.com/webhook"
      );
      assert.equal(result.valid, true);
    });

    it("accepts URL with numbers in hostname", () => {
      const result = validateWebhookUrl("https://api123.example.com/webhook");
      assert.equal(result.valid, true);
    });

    it("rejects URL with empty label (double dots)", () => {
      const result = validateWebhookUrl("https://example..com/webhook");
      assert.equal(result.valid, false);
      assert.ok(result.reason?.includes("hostname") || result.reason?.includes("invalid"));
    });
  });
});

describe("getBrowserLimitationsNotice", () => {
  it("returns a non-empty notice", () => {
    const notice = getBrowserLimitationsNotice();
    assert.ok(notice.length > 0);
  });

  it("mentions CORS policy", () => {
    const notice = getBrowserLimitationsNotice();
    assert.ok(notice.toLowerCase().includes("cors"));
  });

  it("mentions browser limitations", () => {
    const notice = getBrowserLimitationsNotice();
    assert.ok(notice.toLowerCase().includes("browser"));
  });

  it("mentions remote service control", () => {
    const notice = getBrowserLimitationsNotice();
    assert.ok(notice.toLowerCase().includes("remote"));
  });
});
