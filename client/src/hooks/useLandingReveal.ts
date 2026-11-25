import { useEffect } from "react";
import { initLandingReveals } from "@/lib/landingReveal";

/**
 * One page-wide observer, installed after `load` (images size the landing
 * page, so measuring sooner marks every section as above-the-fold) and
 * removed on unmount.
 */
export function useLandingReveal(): void {
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    const start = () => {
      cleanup = initLandingReveals();
    };
    if (document.readyState === "complete") {
      start();
    } else {
      window.addEventListener("load", start, { once: true });
    }
    return () => {
      window.removeEventListener("load", start);
      cleanup?.();
    };
  }, []);
}
