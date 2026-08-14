import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, SyntheticEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { APP_DESTINATIONS, isDestinationCurrent, type AppDestination } from "~/navigation";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function QuickNavigation(): React.JSX.Element {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const restoreOpenerRef = useRef(true);
  const resultRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const previousPathnameRef = useRef(pathname);

  const dismiss = useCallback(() => {
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
    setIsOpen(false);
    if (restoreOpenerRef.current) {
      const opener = openerRef.current;
      if (opener?.isConnected) opener.focus();
    }
    openerRef.current = null;
    restoreOpenerRef.current = true;
  }, []);

  const openPalette = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (dialog.open) {
      filterRef.current?.focus();
      return;
    }
    const active = document.activeElement;
    openerRef.current = active instanceof HTMLElement ? active : null;
    restoreOpenerRef.current = true;
    setQuery("");
    setIsOpen(true);
    dialog.showModal();
    filterRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || event.ctrlKey === event.metaKey || event.shiftKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
      openPalette();
    };
    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  }, [openPalette]);
  useEffect(() => {
    const previousPathname = previousPathnameRef.current;
    previousPathnameRef.current = pathname;
    if (previousPathname === pathname || !dialogRef.current?.open) return;
    restoreOpenerRef.current = false;
    dismiss();
  }, [dismiss, pathname]);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleDestinations = APP_DESTINATIONS.filter((destination) => {
    if (!normalizedQuery) return true;
    return destination.label.toLowerCase().includes(normalizedQuery)
      || destination.keywords.some((value) => value.toLowerCase().includes(normalizedQuery));
  });

  const focusResult = (index: number) => {
    if (visibleDestinations.length === 0) return;
    const wrappedIndex = (index + visibleDestinations.length) % visibleDestinations.length;
    resultRefs.current[wrappedIndex]?.focus();
  };

  const activateDestination = (destination: AppDestination) => {
    const current = isDestinationCurrent(destination, pathname);
    restoreOpenerRef.current = false;
    dismiss();
    if (current) {
      document.getElementById("main-content")?.focus();
      return;
    }
    navigate(destination.to);
  };

  const handleFilterKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (visibleDestinations.length === 0) return;
    if (event.key === "Enter") {
      event.preventDefault();
      activateDestination(visibleDestinations[0]);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      focusResult(0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusResult(visibleDestinations.length - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusResult(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusResult(visibleDestinations.length - 1);
    }
  };

  const handleResultKeyDown = (event: ReactKeyboardEvent<HTMLAnchorElement>, index: number) => {
    if (visibleDestinations.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusResult(index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusResult(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusResult(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusResult(visibleDestinations.length - 1);
    }
  };

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    dismiss();
  };

  return <>
    <button className="inline-flex min-h-11 items-center rounded border px-3 py-2" type="button" onClick={openPalette}>Navigate</button>
    <dialog
      ref={dialogRef}
      aria-labelledby="quick-navigation-title"
      className="quick-navigation-dialog rounded-lg p-0 shadow-xl"
      onCancel={handleCancel}
    >
      <div className="w-full max-w-lg p-5">
        <div className="flex items-center justify-between gap-4">
          <h2 id="quick-navigation-title" className="text-lg font-semibold">Navigate</h2>
          <button className="inline-flex min-h-11 items-center rounded border px-3 py-2" type="button" onClick={() => dismiss()}>Close</button>
        </div>
        <label className="mt-4 block text-sm font-medium" htmlFor="navigation-filter">Navigation filter</label>
        <input
          ref={filterRef}
          id="navigation-filter"
          className="mt-1 w-full rounded border px-3 py-2"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={handleFilterKeyDown}
          autoComplete="off"
        />
        <nav aria-label="Quick navigation destinations" className="mt-4 grid gap-1">
          {visibleDestinations.map((destination, index) => {
            const current = isDestinationCurrent(destination, pathname);
            return <Link
              key={destination.to}
              to={destination.to}
              ref={(element) => { resultRefs.current[index] = element; }}
              aria-current={isOpen && current ? "page" : undefined}
              className="rounded px-3 py-2"
              onClick={(event) => {
                event.preventDefault();
                activateDestination(destination);
              }}
              onKeyDown={(event) => handleResultKeyDown(event, index)}
            >{destination.label}</Link>;
          })}
          {visibleDestinations.length === 0 ? <p role="status">No destinations found.</p> : null}
        </nav>
      </div>
    </dialog>
  </>;
}
