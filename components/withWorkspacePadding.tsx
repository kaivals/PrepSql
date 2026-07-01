"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface WorkspacePaddingOptions {
  scrollable?: boolean;
  bg?: string;
}

export function withWorkspacePadding<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  options: WorkspacePaddingOptions = {},
) {
  const { scrollable = false, bg = "bg-background" } = options;

  const WithWorkspacePadding = (props: P) => {
    return (
      <div
        className={cn(
          "flex flex-1 flex-col p-6 lg:p-8",
          scrollable ? "overflow-y-auto" : "overflow-hidden",
          bg,
        )}
      >
        <WrappedComponent {...props} />
      </div>
    );
  };

  WithWorkspacePadding.displayName = `WithWorkspacePadding(${
    WrappedComponent.displayName || WrappedComponent.name || "Component"
  })`;

  return WithWorkspacePadding;
}
