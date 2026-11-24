import React from "react";
import { NOVA_MODEL_NAME_DISCLAIMER } from "@shared/models";

/**
 * Carries the Nova naming note under a model picker's catalogue. Both pickers
 * render it, so the wording lives in one place.
 */
export function ModelNameDisclaimer() {
  return (
    <div className="px-2 pb-1.5 pt-1">
      <p
        className="text-[10px] leading-snug text-muted-foreground"
        data-testid="nova-model-name-disclaimer"
      >
        {NOVA_MODEL_NAME_DISCLAIMER}
      </p>
    </div>
  );
}
