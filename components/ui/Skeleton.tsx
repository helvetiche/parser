/**
 * Shimmering placeholder block. Size/shape it with utility classes,
 * e.g. <Skeleton className="h-4 w-32 rounded-full" />.
 */
export default function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`shimmer block rounded-md ${className}`} />;
}
