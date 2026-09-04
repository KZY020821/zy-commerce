export function SuspendedNotice({ storeName }: { storeName: string }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{storeName} is temporarily unavailable</h1>
      <p className="max-w-md text-muted-foreground">This store has been suspended. Please check back later.</p>
    </main>
  );
}
