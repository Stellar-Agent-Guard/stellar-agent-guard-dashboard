"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/**
 * A portal component that renders children into a DOM node outside the normal DOM hierarchy.
 * Useful for tooltips, modals, and other UI elements that need to break out of their container.
 */
export function Portal({ children }: { children: React.ReactNode }) {
  const portalRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Create a div for the portal if it doesn't exist
    if (!portalRef.current) {
      portalRef.current = document.createElement("div");
      portalRef.current.setAttribute("data-portal", "");
      document.body.appendChild(portalRef.current);
    }

    // Clean up on unmount
    return () => {
      if (portalRef.current && portalRef.current.parentNode) {
        portalRef.current.parentNode.removeChild(portalRef.current);
      }
    };
  }, []);

  // Return null if the portal container hasn't been created yet (e.g., during SSR)
  if (!portalRef.current) {
    return null;
  }

  return createPortal(children, portalRef.current);
}