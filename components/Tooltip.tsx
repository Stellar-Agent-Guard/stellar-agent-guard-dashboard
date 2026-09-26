"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Portal } from "./Portal.tsx";

/**
 * An accessible tooltip component implementing the WAI-ARIA Tooltip pattern.
 *
 * Features:
 * - Appears on mouse enter or keyboard focus
 * - Dismisses on mouse leave, blur, or Escape keypress
 * - Automatic positioning (top, bottom, left, right) to stay within viewport
 * - Delay timers to prevent accidental showing
 * - Fully accessible with proper ARIA attributes
 */
export function Tooltip({
  children,
  content,
  delay = 500,
  distance = 10,
}: {
  children: React.ReactElement;
  content: string;
  delay?: number; // milliseconds to wait before showing
  distance?: number; // pixels from trigger
}) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [position, setPosition] = useState<"top" | "bottom" | "left" | "right">("top");
  const [tooltipRect, setTooltipRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLElement>(null);
  const tooltipRef = useRef<HTMLElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // Update tooltip position when window resizes or scrolls
  useEffect(() => {
    if (!showTooltip || !tooltipRef.current || !triggerRef.current) return;

    const updatePosition = () => {
      const triggerRect = triggerRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      // Get tooltip dimensions
      let tooltipWidth = 0;
      let tooltipHeight = 0;
      if (tooltipRect) {
        tooltipWidth = tooltipRect.width;
        tooltipHeight = tooltipRect.height;
      } else if (tooltipRef.current) {
        const rect = tooltipRef.current.getBoundingClientRect();
        tooltipWidth = rect.width;
        tooltipHeight = rect.height;
      }

      // Calculate potential positions
      const positions: Array<{
        side: "top" | "bottom" | "left" | "right";
        x: number;
        y: number;
        fits: boolean;
      }> = [];

      // Top position
      positions.push({
        side: "top",
        x: triggerRect.left + triggerRect.width / 2 - tooltipWidth / 2,
        y: triggerRect.top - distance - tooltipHeight,
        fits:
          triggerRect.left + triggerRect.width / 2 - tooltipWidth / 2 >= 0 &&
          triggerRect.left + triggerRect.width / 2 + tooltipWidth / 2 <= viewportWidth &&
          triggerRect.top - distance - tooltipHeight >= 0,
      });

      // Bottom position
      positions.push({
        side: "bottom",
        x: triggerRect.left + triggerRect.width / 2 - tooltipWidth / 2,
        y: triggerRect.bottom + distance,
        fits:
          triggerRect.left + triggerRect.width / 2 - tooltipWidth / 2 >= 0 &&
          triggerRect.left + triggerRect.width / 2 + tooltipWidth / 2 <= viewportWidth &&
          triggerRect.bottom + distance + tooltipHeight <= viewportHeight,
      });

      // Left position
      positions.push({
        side: "left",
        x: triggerRect.left - distance - tooltipWidth,
        y: triggerRect.top + triggerRect.height / 2 - tooltipHeight / 2,
        fits:
          triggerRect.left - distance - tooltipWidth >= 0 &&
          triggerRect.top + triggerRect.height / 2 - tooltipHeight / 2 >= 0 &&
          triggerRect.top + triggerRect.height / 2 + tooltipHeight / 2 <= viewportHeight,
      });

      // Right position
      positions.push({
        side: "right",
        x: triggerRect.right + distance,
        y: triggerRect.top + triggerRect.height / 2 - tooltipHeight / 2,
        fits:
          triggerRect.right + distance + tooltipWidth <= viewportWidth &&
          triggerRect.top + triggerRect.height / 2 - tooltipHeight / 2 >= 0 &&
          triggerRect.top + triggerRect.height / 2 + tooltipHeight / 2 <= viewportHeight,
      });

      // Find the first position that fits, or default to top if none fit
      const bestPosition = positions.find((pos) => pos.fits) || positions[0];
      setPosition(bestPosition.side);
    };

    // Update position on resize and scroll
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition);

    // Initial position update
    updatePosition();

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition);
    };
  }, [showTooltip, delay, distance]);

  // Handle mouse enter on trigger
  const handleMouseEnter = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => setShowTooltip(true), delay);
  }, [delay]);

  // Handle mouse leave on trigger
  const handleMouseLeave = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setShowTooltip(false);
  }, []);

  // Handle focus on trigger
  const handleFocus = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => setShowTooltip(true), delay);
  }, [delay]);

  // Handle blur on trigger
  const handleBlur = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setShowTooltip(false);
  }, []);

  // Handle escape key to dismiss tooltip
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showTooltip) {
        setShowTooltip(false);
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [showTooltip]);

  // Update tooltip ref when content changes
  useEffect(() => {
    if (tooltipRef.current) {
      setTooltipRect(tooltipRef.current.getBoundingClientRect());
    }
  }, [content]);

  // Don't render tooltip content when not showing (for performance)
  if (!showTooltip) {
    return (
      <>
        {React.cloneElement(children, {
          ref: triggerRef,
          "aria-describedby": null,
          onMouseEnter: handleMouseEnter,
          onMouseLeave: handleMouseLeave,
          onFocus: handleFocus,
          onBlur: handleBlur,
        })}
      </>
    );
  }

  // Calculate tooltip styles based on position
  const getTooltipStyle = () => {
    const triggerRect = triggerRef.current?.getBoundingClientRect();
    if (!triggerRect) return {};

    let style: React.CSSProperties = {
      position: "fixed",
      zIndex: 1000,
      pointerEvents: "none", // So it doesn't interfere with mouse events on the trigger
    };

    switch (position) {
      case "top":
        style = {
          ...style,
          bottom: `calc(100vh - ${triggerRect.top}px + ${distance}px)`,
          left: `${triggerRect.left + triggerRect.width / 2 - 50}px`, // Centered, assuming max width of 100px for now
          transform: "translateX(-50%)",
        };
        break;
      case "bottom":
        style = {
          ...style,
          top: `${triggerRect.bottom + distance}px`,
          left: `${triggerRect.left + triggerRect.width / 2 - 50}px`,
          transform: "translateX(-50%)",
        };
        break;
      case "left":
        style = {
          ...style,
          right: `calc(100vw - ${triggerRect.left}px + ${distance}px)`,
          top: `${triggerRect.top + triggerRect.height / 2 - 25}px`,
          transform: "translateY(-50%)",
        };
        break;
      case "right":
        style = {
          ...style,
          left: `${triggerRect.right + distance}px`,
          top: `${triggerRect.top + triggerRect.height / 2 - 25}px`,
          transform: "translateY(-50%)",
        };
        break;
    }

    return style;
  };

  return (
    <>
      {/* Trigger element */}
      {React.cloneElement(children, {
        ref: triggerRef,
        "aria-describedby": showTooltip ? "tooltip-content" : undefined,
        onMouseEnter: handleMouseEnter,
        onMouseLeave: handleMouseLeave,
        onFocus: handleFocus,
        onBlur: handleBlur,
      })}

      {/* Tooltip content (rendered in portal to avoid z-index issues) */}
      <Portal>
        <div
          role="tooltip"
          id="tooltip-content"
          ref={tooltipRef}
          className="tooltip"
          style={getTooltipStyle()}
        >
          <div className="tooltip-content">{content}</div>
        </div>
      </Portal>
    </>
  );
}