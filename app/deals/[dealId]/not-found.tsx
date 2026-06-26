import Link from "next/link";

export default function DealNotFound() {
  return (
    <main className="main">
      <div className="empty-state">
        <h1>Deal not found</h1>
        <p>This deal may have been deleted or may not belong to the current workspace.</p>
        <Link className="text-link" href="/pipeline">
          Back to pipeline
        </Link>
      </div>
    </main>
  );
}
