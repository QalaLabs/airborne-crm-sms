"use client";

import type { CSSProperties } from "react";

type PrintButtonProps = {
  label?: string;
  style?: CSSProperties;
};

export function PrintButton({ label = "Print / Save PDF", style }: PrintButtonProps) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      style={
        style ?? {
          padding: "10px 24px",
          background: "#c8102e",
          color: "#fff",
          border: "none",
          borderRadius: "8px",
          cursor: "pointer",
          fontSize: "14px",
          fontFamily: "system-ui",
        }
      }
    >
      {label}
    </button>
  );
}
