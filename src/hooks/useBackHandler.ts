import { useEffect, useRef } from 'react';

type CloseHandler = () => void;

interface StackItem {
  id: string;
  onClose: CloseHandler;
}

const stack: StackItem[] = [];
let isPoppingState = false;
let ignoreNextPopState = false;

if (typeof window !== 'undefined') {
  // Push initial dummy state so pressing back on base Dashboard doesn't navigate away
  try {
    window.history.pushState({ isBaseDashboard: true }, '');
  } catch {
    // Ignore if history API is restricted
  }

  window.addEventListener('popstate', () => {
    if (ignoreNextPopState) {
      ignoreNextPopState = false;
      return;
    }
    isPoppingState = true;
    if (stack.length > 0) {
      const top = stack.pop();
      if (top) {
        top.onClose();
      }
    } else {
      // When Form Dashboard is active (no sub-views or modals open),
      // pressing device softkey back button will have NO effect on the app (stay on Dashboard)
      try {
        window.history.pushState({ isBaseDashboard: true }, '');
      } catch {
        // Ignore
      }
    }
    isPoppingState = false;
  });
}

/**
 * Custom hook to register a back button / swipe-back gesture handler for mobile devices and browser navigation.
 * When `isOpen` is true, pressing the device back button will invoke `onClose` instead of navigating away from the app.
 */
export function useBackHandler(isOpen: boolean, onClose: CloseHandler, id: string) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;

    const currentId = `${id}_${Math.random().toString(36).substring(2, 7)}`;

    // Push browser history state if opening view/modal normally (not via popstate)
    if (!isPoppingState) {
      try {
        window.history.pushState({ backHandlerId: currentId }, '');
      } catch {
        // Ignore
      }
    }

    const item: StackItem = {
      id: currentId,
      onClose: () => onCloseRef.current(),
    };
    stack.push(item);

    return () => {
      const index = stack.findIndex((s) => s.id === currentId);
      if (index !== -1) {
        stack.splice(index, 1);
        // If closed via UI button (not popstate), pop history state to keep browser history in sync
        if (!isPoppingState && window.history.state?.backHandlerId === currentId) {
          ignoreNextPopState = true;
          try {
            window.history.back();
          } catch {
            // Ignore
          }
        }
      }
    };
  }, [isOpen, id]);
}

