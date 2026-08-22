import * as React from "react"

import { cn } from "@/lib/utils"

// A plain native <select>, styled to match Input, rather than a Base UI
// Select primitive — this app's option sets are small and static, so the
// extra popup/positioning machinery isn't worth the risk of guessing at an
// unverified component API.
function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
        className
      )}
      {...props}
    >
      {children}
    </select>
  )
}

export { Select }
