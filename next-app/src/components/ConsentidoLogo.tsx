/**
 * Logo oficial Con-sentido.
 *
 * `BrandLogo` usa el PNG original en `public/logo.png` (incluye el wordmark "con-sentido"
 * arqueado + la carita). Es la imagen real de la marca; úsala en todos los lugares.
 *
 * Los componentes SVG (ConsentidoMark / ConsentidoWordmark) son una recreación vectorial
 * de respaldo, por si en algún punto se necesita un lockup horizontal o un ícono suelto.
 */

export function BrandLogo({ size = 48, className = "" }: { size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.png"
      alt="Con-sentido — Centro Terapéutico"
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, objectFit: "contain", display: "block" }}
    />
  );
}

export function ConsentidoMark({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 110 112"
      width={size}
      height={size * (112 / 110)}
      className={className}
      role="img"
      aria-label="Con-sentido"
      fill="none"
    >
      <g stroke="#FBB034" strokeWidth="6" strokeLinecap="round">
        <line x1="40" y1="21" x2="35" y2="8" />
        <line x1="51" y1="17" x2="51" y2="3" />
        <line x1="61" y1="21" x2="67" y2="9" />
      </g>
      <path d="M 68 33.5 A 28 28 0 1 0 68 76.5" stroke="#F0567A" strokeWidth="11" strokeLinecap="round" />
      <path d="M 56.9 45.2 A 12 12 0 1 0 56.9 64.8" stroke="#9B5DE5" strokeWidth="7" strokeLinecap="round" />
      <path d="M 80 42 L 80 64 L 98 64" stroke="#2BC4AE" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="84" cy="52" r="3.4" fill="#2BC4AE" />
      <circle cx="93" cy="52" r="3.4" fill="#2BC4AE" />
      <path d="M 30 86 Q 60 109 100 84" stroke="#43BCEC" strokeWidth="9" strokeLinecap="round" />
    </svg>
  );
}

/** Wordmark "con-sentido" con cada sílaba en su color de marca (para lockups horizontales). */
export function ConsentidoWordmark({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <span className={className} style={{ fontWeight: 800, letterSpacing: "-0.01em", whiteSpace: "nowrap", ...style }}>
      <span style={{ color: "#F0567A" }}>con</span>
      <span style={{ color: "#B4B0A8" }}>-</span>
      <span style={{ color: "#FBB034" }}>sen</span>
      <span style={{ color: "#2BC4AE" }}>ti</span>
      <span style={{ color: "#43BCEC" }}>do</span>
    </span>
  );
}
