import { Button as Original } from '@acme/core/original/Button';
import type { SlotProps } from '@acme/core/contracts';
import { useTheme } from '../theme';

/**
 * Stunt double for the "Button" slot: WRAPS the SDK default with brand styling. Typed as SlotProps['Button'],
 * so SDK upgrades flow through. Wrapping goes through '@acme/core/original/Button' (never '@acme/core', which
 * would be this very component: [F7]).
 */
export function Button(props: SlotProps['Button']) {
  const theme = useTheme();
  return (
    <span className="brand-button" data-sd="BRAND_BUTTON" data-ctx={theme}>
      <Original {...props} />
    </span>
  );
}
