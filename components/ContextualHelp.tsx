"use client";

import { useEffect, useRef, useState } from "react";
import {
  detectScreenFromHash,
  GROUNDED_TERMINOLOGY,
  type ScreenHelpContent,
} from "../lib/guard/contextualHelp.ts";

export function ContextualHelp() {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentScreen, setCurrentScreen] = useState<ScreenHelpContent>(() =>
    detectScreenFromHash(typeof window !== "undefined" ? window.location.hash : ""),
  );

  const triggerRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleHashChange = () => {
      setCurrentScreen(detectScreenFromHash(window.location.hash));
    };
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  // Keyboard accessibility: handle Escape key and initial focus
  useEffect(() => {
    if (!isOpen) return;

    // Focus close button on open
    closeBtnRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const filteredTerms = GROUNDED_TERMINOLOGY.filter(
    (item) =>
      item.term.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.definition.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="secondary contextual-help-trigger"
        onClick={() => setIsOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls="contextual-help-dialog"
        aria-label="Open contextual help and terminology guide"
        title="Screen help and safety glossary"
      >
        <span aria-hidden="true" style={{ fontWeight: "bold" }}>?</span> Help
      </button>

      {isOpen && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setIsOpen(false);
            triggerRef.current?.focus();
          }}
          role="presentation"
        >
          <div
            ref={modalRef}
            id="contextual-help-dialog"
            className="panel modal contextual-help-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="contextual-help-title"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "680px", maxHeight: "85vh", overflowY: "auto" }}
          >
            <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <span className="pill info" style={{ marginBottom: 4 }}>Contextual Help</span>
                <h2 id="contextual-help-title" style={{ margin: "4px 0" }}>
                  {currentScreen.title}
                </h2>
              </div>
              <button
                ref={closeBtnRef}
                type="button"
                className="secondary"
                onClick={() => {
                  setIsOpen(false);
                  triggerRef.current?.focus();
                }}
                aria-label="Close contextual help"
              >
                ✕ Close
              </button>
            </div>

            <p className="help-summary" style={{ marginTop: 8, fontSize: "14px", lineHeight: 1.5 }}>
              {currentScreen.summary}
            </p>

            <div className="section" style={{ marginTop: 16 }}>
              <h3 style={{ fontSize: "14px", margin: "8px 0" }}>Safety Constraints & Boundaries</h3>
              <ul style={{ margin: "4px 0 12px 18px", fontSize: "13px", lineHeight: 1.6 }}>
                {currentScreen.safetyConstraints.map((constraint, index) => (
                  <li key={index}>{constraint}</li>
                ))}
              </ul>
            </div>

            <div className="section" style={{ marginTop: 16 }}>
              <h3 style={{ fontSize: "14px", margin: "8px 0" }}>Screen Documentation Links</h3>
              <ul style={{ listStyleType: "none", padding: 0, margin: 0 }}>
                {currentScreen.docLinks.map((link, index) => (
                  <li
                    key={index}
                    style={{
                      padding: "8px",
                      border: "1px solid var(--border, #333)",
                      borderRadius: 6,
                      marginBottom: 8,
                    }}
                  >
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontWeight: "bold", textDecoration: "underline" }}
                    >
                      {link.label} ↗
                    </a>
                    <p className="tiny muted" style={{ margin: "4px 0 0" }}>
                      {link.description}
                    </p>
                  </li>
                ))}
              </ul>
            </div>

            <div className="section" style={{ marginTop: 20 }}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <h3 style={{ fontSize: "14px", margin: 0 }}>Grounded Terminology</h3>
                <input
                  type="search"
                  placeholder="Filter terms…"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  aria-label="Filter glossary terms"
                  style={{ width: "160px", padding: "4px 8px", fontSize: "12px" }}
                />
              </div>

              <dl
                className="terminology-list"
                style={{
                  marginTop: 12,
                  display: "grid",
                  gridTemplateColumns: "1fr",
                  gap: "10px",
                }}
              >
                {filteredTerms.map((item) => (
                  <div
                    key={item.term}
                    style={{
                      padding: "8px 10px",
                      background: "var(--surface-subtle, rgba(255,255,255,0.03))",
                      borderRadius: 6,
                    }}
                  >
                    <dt style={{ fontWeight: "bold", fontSize: "13px", display: "flex", gap: "8px" }}>
                      <span>{item.term}</span>
                      {item.contractEnforced ? (
                        <span className="pill info tiny" style={{ fontSize: "10px" }}>
                          Contract Enforced
                        </span>
                      ) : (
                        <span className="pill muted tiny" style={{ fontSize: "10px" }}>
                          Client Guardrail
                        </span>
                      )}
                    </dt>
                    <dd style={{ margin: "4px 0 0", fontSize: "12px", color: "var(--muted, #aaa)" }}>
                      {item.definition}
                    </dd>
                  </div>
                ))}
                {filteredTerms.length === 0 && (
                  <p className="tiny muted">No matching terms found.</p>
                )}
              </dl>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
