export default function HomePage() {
  return (
    <main style={{ padding: "3rem 2rem", maxWidth: "800px", margin: "0 auto" }}>
      <h1 style={{ color: "#38bdf8" }}>⚡ TEB Webhook Lead Automation Engine</h1>
      <p style={{ color: "#94a3b8", fontSize: "1.1rem" }}>
        Engine Status: <strong style={{ color: "#4ade80" }}>Online & Processing</strong>
      </p>

      <section style={{ background: "#1e293b", padding: "1.5rem", borderRadius: "8px", marginTop: "2rem" }}>
        <h3 style={{ margin: 0, marginBottom: "0.5rem" }}>Webhook Endpoint</h3>
        <code style={{ background: "#0f172a", padding: "0.5rem 1rem", borderRadius: "4px", color: "#f43f5e", display: "inline-block" }}>
          POST /api/webhooks/teb-lead
        </code>
      </section>
    </main>
  );
}
