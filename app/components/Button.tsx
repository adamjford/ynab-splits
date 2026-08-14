import type { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
};

export function Button({
  className = "",
  type = "button",
  variant = "secondary",
  ...props
}: ButtonProps): React.JSX.Element {
  const variantClassName =
    variant === "primary"
      ? "border-slate-900 bg-slate-900 text-white hover:bg-slate-800 active:bg-slate-700 dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200 dark:active:bg-slate-300"
      : "border-slate-300 bg-white text-slate-900 hover:bg-slate-50 active:bg-slate-100 dark:border-slate-700 dark:bg-gray-950 dark:text-slate-100 dark:hover:bg-slate-900 dark:active:bg-slate-800";

  return (
    <button
      type={type}
      className={`inline-flex min-h-11 items-center justify-center rounded border px-3 py-2 text-sm font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${variantClassName} ${className}`}
      {...props}
    />
  );
}
