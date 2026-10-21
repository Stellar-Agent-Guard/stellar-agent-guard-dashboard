"use client";

import { useState } from "react";
import {
  validateWebhookUrl,
  getBrowserLimitationsNotice,
} from "../lib/guard/webhookDispatcher";

interface WebhookDestination {
  id: string;
  url: string;
  active: boolean;
}

interface WebhookSettingsProps {
  destinations?: WebhookDestination[];
  onSave?: (url: string) => void;
  onRemove?: (id: string) => void;
  onToggle?: (id: string, active: boolean) => void;
  isProduction?: boolean;
}

/**
 * Component for managing webhook destination URLs with validation.
 *
 * Validates URLs before saving to prevent common mistakes like:
 * - Insecure schemes (http in production)
 * - Embedded credentials
 * - Malformed hosts
 * - Private IPs in production
 *
 * Clearly explains browser-side limitations regarding CORS and delivery.
 */
export default function WebhookSettings({
  destinations = [],
  onSave,
  onRemove,
  onToggle,
  isProduction = true,
}: WebhookSettingsProps) {
  const [newUrl, setNewUrl] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showValidationHelp, setShowValidationHelp] = useState(false);

  const handleUrlChange = (value: string) => {
    setNewUrl(value);
    setValidationError(null);
  };

  const handleAddDestination = () => {
    const result = validateWebhookUrl(newUrl, isProduction);

    if (!result.valid) {
      setValidationError(result.reason || "Invalid URL");
      return;
    }

    onSave?.(newUrl.trim());
    setNewUrl("");
    setValidationError(null);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleAddDestination();
    }
  };

  return (
    <div className="space-y-4 p-4 border rounded-lg bg-white dark:bg-gray-900">
      <h2 className="text-lg font-semibold">Webhook Destinations</h2>

      {/* Add new destination */}
      <div className="space-y-2">
        <label htmlFor="webhook-url" className="block text-sm font-medium">
          Add Webhook URL
        </label>
        <div className="flex gap-2">
          <input
            id="webhook-url"
            type="text"
            value={newUrl}
            onChange={(e) => handleUrlChange(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="https://example.com/webhook"
            className={`flex-1 px-3 py-2 border rounded-md ${
              validationError
                ? "border-red-500 focus:ring-red-500"
                : "border-gray-300 focus:ring-blue-500"
            }`}
            aria-invalid={!!validationError}
            aria-describedby={
              validationError ? "webhook-error" : "webhook-help"
            }
          />
          <button
            onClick={handleAddDestination}
            disabled={!newUrl.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add
          </button>
        </div>

        {/* Validation error message */}
        {validationError && (
          <p
            id="webhook-error"
            className="text-sm text-red-600 dark:text-red-400"
            role="alert"
          >
            {validationError}
          </p>
        )}

        {/* Help text */}
        <p
          id="webhook-help"
          className="text-xs text-gray-500 dark:text-gray-400"
        >
          Enter a secure HTTPS URL.{" "}
          <button
            type="button"
            onClick={() => setShowValidationHelp(!showValidationHelp)}
            className="text-blue-600 hover:underline"
          >
            What are the requirements?
          </button>
        </p>

        {/* Expanded validation help */}
        {showValidationHelp && (
          <div className="text-xs space-y-2 p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
            <p className="font-medium">URL Requirements:</p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>
                Must use{" "}
                {isProduction ? (
                  <strong>HTTPS only</strong>
                ) : (
                  <>
                    HTTPS or HTTP (HTTP allowed in development)
                  </>
                )}
              </li>
              <li>Must have a valid hostname (e.g., example.com)</li>
              <li>Cannot contain embedded credentials (user:pass@host)</li>
              <li>Cannot have leading or trailing whitespace</li>
              {isProduction && (
                <>
                  <li>Cannot use localhost or private IP addresses</li>
                </>
              )}
            </ul>
          </div>
        )}
      </div>

      {/* Browser limitations notice */}
      <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md">
        <p className="text-xs text-yellow-800 dark:text-yellow-200">
          {getBrowserLimitationsNotice()}
        </p>
      </div>

      {/* Existing destinations */}
      {destinations.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Configured Destinations</h3>
          <ul className="space-y-2">
            {destinations.map((dest) => (
              <li
                key={dest.id}
                className="flex items-center justify-between p-3 border rounded-md"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-mono truncate">{dest.url}</p>
                  <p
                    className={`text-xs ${
                      dest.active
                        ? "text-green-600 dark:text-green-400"
                        : "text-gray-500 dark:text-gray-400"
                    }`}
                  >
                    {dest.active ? "Active" : "Inactive"}
                  </p>
                </div>
                <div className="flex gap-2 ml-4">
                  <button
                    onClick={() => onToggle?.(dest.id, !dest.active)}
                    className={`px-3 py-1 text-xs rounded-md ${
                      dest.active
                        ? "bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600"
                        : "bg-green-600 hover:bg-green-700 text-white"
                    }`}
                  >
                    {dest.active ? "Disable" : "Enable"}
                  </button>
                  <button
                    onClick={() => onRemove?.(dest.id)}
                    className="px-3 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded-md"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
