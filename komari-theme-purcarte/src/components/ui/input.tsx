import * as React from "react";

import { cn } from "@/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex w-full text-sm rounded-md bg-card px-3 py-2 placeholder:text-secondary-foreground disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-0",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
