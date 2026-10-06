export default function Home() {
  return (
    <main style={{ maxWidth: 560, margin: '0 auto', padding: '96px 24px', textAlign: 'center' }}>
      <h1 style={{ fontSize: 56, margin: 0, color: '#ffd36b' }}>Bao</h1>
      <p style={{ fontSize: 24, lineHeight: 1.35, margin: '20px 0' }}>
        Red packets for Seeker owners — and bots can&apos;t grab them.
      </p>
      <p style={{ opacity: 0.75, lineHeight: 1.5 }}>
        Drop SKR into your circle. Friends shake to grab a random share. Every grab is bound on-chain to a Seeker
        Genesis Token: one device, one grab.
      </p>
      <a
        href="https://github.com/RaYYeR220/bao/releases"
        style={{
          display: 'inline-block',
          marginTop: 28,
          padding: '16px 28px',
          borderRadius: 14,
          background: '#ffd36b',
          color: '#3a0008',
          fontWeight: 700,
          textDecoration: 'none',
        }}
      >
        Get the Android app
      </a>
    </main>
  );
}
