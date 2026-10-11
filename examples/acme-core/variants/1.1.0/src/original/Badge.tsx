'use client';

/** Props every Badge implementation receives (new optional slot in 1.1.0). */
export interface BadgeProps {
  /** Short label, e.g. "In stock". */
  label: string;
  /** Color hint. */
  tone?: 'info' | 'success';
}

/** The SDK's default Badge. Reachable ONLY as '@acme/core/original/Badge'. */
export function Badge({ label, tone = 'info' }: BadgeProps) {
  return (
    <span className={`acme-badge acme-badge-${tone}`} data-sd="SDK_DEFAULT_BADGE">
      {label}
    </span>
  );
}
