"use client";

import { useEffect, type RefObject } from "react";

interface DialogFocusOptions {
  open: boolean;
  onClose: () => void;
  containerRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  lockScroll?: boolean;
}

export function useDialogFocus({
  open,
  onClose,
  containerRef,
  initialFocusRef,
  returnFocusRef,
  lockScroll = false,
}: DialogFocusOptions) {
  useEffect(() => {
    if (!open) return;
    const previousActive = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const returnTarget = returnFocusRef?.current ?? previousActive;
    const previousOverflow = document.body.style.overflow;
    const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !containerRef.current) return;
      const focusable = Array.from(containerRef.current.querySelectorAll<HTMLElement>(focusableSelector));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    if (lockScroll) document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => {
      const target = initialFocusRef?.current
        ?? containerRef.current?.querySelector<HTMLElement>(focusableSelector);
      target?.focus();
    });

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (lockScroll) document.body.style.overflow = previousOverflow;
      returnTarget?.focus();
    };
  }, [containerRef, initialFocusRef, lockScroll, onClose, open, returnFocusRef]);
}
