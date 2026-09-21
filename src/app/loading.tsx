export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="skeleton mb-2 h-8 w-48" />
      <div className="skeleton mb-6 h-4 w-72" />
      <div className="glass space-y-3 p-4">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-12 w-full" />)}
      </div>
    </div>
  );
}
