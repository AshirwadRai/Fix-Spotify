// Loading skeletons — shape-matched placeholders shown while a view's data is
// in flight, instead of a bare spinner (gap #7). Pure presentational, no engine
// or shared-row coupling. One base `Skeleton` box (Tailwind animate-pulse, no
// dep) + a few composed layouts that mirror the real views so the swap is
// flicker-free. ponytail: approximate layouts, not pixel-perfect clones — the
// point is "something is loading here", and exact dimensions drift with the
// real components anyway.

export function Skeleton({ className = '' }) {
  return <div className={`bg-white/10 animate-pulse rounded ${className}`} />;
}

// One track-row placeholder (mirrors TrackRow: artwork · title/artist · time).
function RowLine() {
  return (
    <div className="flex items-center gap-3 px-4 py-2">
      <Skeleton className="w-10 h-10 rounded-md shrink-0" />
      <div className="flex-1 min-w-0 space-y-2">
        <Skeleton className="h-3.5 w-1/3" />
        <Skeleton className="h-3 w-1/4" />
      </div>
      <Skeleton className="h-3 w-10 shrink-0" />
    </div>
  );
}

// One card placeholder (mirrors HomeCard / search song-grid card).
function CardSkel({ round = false }) {
  return (
    <div className="w-40 shrink-0 p-3">
      <Skeleton className={`w-full aspect-square mb-3 ${round ? 'rounded-full' : 'rounded-md'}`} />
      <Skeleton className="h-3.5 w-3/4 mb-2" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  );
}

function rows(n, Comp) {
  return Array.from({ length: n }).map((_, i) => <Comp key={i} />);
}

// Home: greeting + a few horizontal card rows.
export function HomeSkeleton() {
  return (
    <div className="flex-1 overflow-y-auto px-6 pb-6 pt-4">
      <Skeleton className="h-8 w-48 mb-8" />
      {[0, 1, 2].map(r => (
        <section key={r} className="mb-8">
          <Skeleton className="h-6 w-40 mb-4" />
          <div className="flex gap-4 overflow-hidden">{rows(6, CardSkel)}</div>
        </section>
      ))}
    </div>
  );
}

// Album / playlist: square cover + title block, then a tracklist.
export function AlbumSkeleton() {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex items-end gap-6 px-6 pt-6 pb-6">
        <Skeleton className="w-56 h-56 rounded-md shrink-0" />
        <div className="flex flex-col gap-3 min-w-0 flex-1">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-12 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      </div>
      <div className="px-4 mt-4 space-y-1">{rows(8, RowLine)}</div>
    </div>
  );
}

// Artist: round hero image + title block, then a popular tracklist.
export function ArtistSkeleton() {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex items-end gap-6 px-6 pt-16 pb-6">
        <Skeleton className="w-48 h-48 rounded-full shrink-0" />
        <div className="flex flex-col gap-3 min-w-0 flex-1">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-14 w-1/2" />
          <Skeleton className="h-4 w-1/4" />
        </div>
      </div>
      <div className="px-4 mt-4 space-y-1">{rows(5, RowLine)}</div>
    </div>
  );
}

// Search (All tab): tab bar + top-result card + songs list.
export function SearchSkeleton() {
  return (
    <div className="flex-1 overflow-y-auto px-6 pb-4 pt-4">
      <div className="flex gap-2 mb-6">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-20 rounded-full" />)}
      </div>
      <div className="flex gap-6 mb-8">
        <div className="w-[380px] shrink-0 bg-spotify-elevated-base/40 rounded-lg p-5">
          <Skeleton className="h-4 w-24 mb-4" />
          <Skeleton className="w-24 h-24 rounded-lg mb-4" />
          <Skeleton className="h-7 w-2/3 mb-2" />
          <Skeleton className="h-4 w-1/3" />
        </div>
        <div className="flex-1 min-w-0">
          <Skeleton className="h-4 w-20 mb-4" />
          <div className="space-y-1">{rows(4, RowLine)}</div>
        </div>
      </div>
    </div>
  );
}
