import { useEffect, useRef } from "react";

type ActionFeedbackProps = {
  error?: string | null;
  status?: string | null;
  focusKey: unknown;
};

export function ActionFeedback({ error, status, focusKey }: ActionFeedbackProps): React.JSX.Element | null {
  const errorRef = useRef<HTMLParagraphElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const preferred = error != null ? errorRef : status != null ? statusRef : null;

  useEffect(() => {
    preferred?.current?.focus();
  }, [focusKey, preferred]);

  if (error == null && status == null) return null;

  return (
    <>
      {error != null && (
        <p ref={errorRef} role="alert" tabIndex={-1} className="text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      {status != null && (
        <p
          ref={statusRef}
          role="status"
          tabIndex={error != null ? undefined : -1}
          className="text-green-700 dark:text-green-400"
        >
          {status}
        </p>
      )}
    </>
  );
}
