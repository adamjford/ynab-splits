import type { ButtonHTMLAttributes } from "react";

export function Button({ ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`basis-1 p-1 border border-solid border-gray-500 bg-gray-800 hover:bg-gray-600 focus:border-gray-400 active:bg-gray-500 ${props.className}`}
      {...props} />
  )
}
