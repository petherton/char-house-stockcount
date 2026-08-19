export default function NotAuthorized() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="mb-3 text-xl font-bold text-navy">Not authorised</h1>
        <p className="text-sm text-gray-600">
          Your account isn&apos;t on the approved staff list for this app
          yet. Ask a manager to add you, or call IT on{" "}
          <span className="font-medium">0428 646 689</span>.
        </p>
      </div>
    </main>
  );
}
