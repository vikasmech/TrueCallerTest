import Link from "next/link";

export default function HomePage() {
  return (
    <div className="space-y-6">
      <section className="card space-y-3">
        <h1 className="text-xl font-semibold">Report and look up suspicious phone numbers</h1>
        <p className="text-sm text-slate-700">
          This private pilot lets signed-in users report suspicious calls or messages and see a
          recent, explainable community signal for an exact number. Results show how many
          independent people have reported a number recently, not whether the owner committed a
          crime.
        </p>
        <div className="flex gap-3">
          <Link href="/lookup" className="btn">
            Look up a number
          </Link>
          <Link href="/report" className="btn-secondary">
            Report a number
          </Link>
        </div>
      </section>
      <section className="card space-y-2 text-sm text-slate-700">
        <h2 className="font-semibold">What the labels mean</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b>Unknown / insufficient reports</b> — fewer than 3 eligible reporters in the last 90
            days. This is not “safe”.
          </li>
          <li>
            <b>Some suspicious reports</b> — at least 3 recent reporters, score below 60.
          </li>
          <li>
            <b>Elevated community risk signal</b> — score 60–79 and at least 5 recent reporters.
          </li>
          <li>
            <b>Strong community risk signal</b> — score 80+, at least 10 recent reporters, and no
            unresolved coordination concern.
          </li>
        </ul>
        <p>
          Fraud and marketing/spam are scored separately. Caller-ID spoofing, coordinated reports
          and number reassignment can cause false positives.
        </p>
      </section>
    </div>
  );
}
