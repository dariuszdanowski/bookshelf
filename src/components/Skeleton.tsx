/**
 * Generic loading placeholder — gray pulsing div. Substrate component dla
 * przyszłych widoków (S-03 photo upload progress, S-04 book candidates loading,
 * S-08 search results loading). Brak konsumenta w MVP M1 — tylko surowy
 * primitive, props pozwalają na elastyczne osadzenie.
 *
 * Accessibility: `role="status"` + domyślny aria-label „Ładowanie" zapewnia
 * komunikat dla SR; konsument może podać własny label (np. „Ładowanie listy
 * książek").
 */

type SkeletonProps = {
  className?: string;
  width?: string | number;
  height?: string | number;
  'aria-label'?: string;
};

const BASE_CLASS = 'animate-pulse bg-gray-200 rounded';

export default function Skeleton({
  className,
  width,
  height,
  'aria-label': ariaLabel = 'Ładowanie',
}: SkeletonProps) {
  const mergedClassName = className ? `${BASE_CLASS} ${className}` : BASE_CLASS;

  const style: React.CSSProperties | undefined =
    width !== undefined || height !== undefined ? { width, height } : undefined;

  return <div role="status" aria-label={ariaLabel} className={mergedClassName} style={style} />;
}
