/** The Queued mark: "QD" in the icon's gradient, with two translucent copies behind it — a little queue. */
export default function Logo({ size = 56, tile = true, breathing = false }: { size?: number; tile?: boolean; breathing?: boolean; animated?: boolean }) {
  return (
    <span className={'qd-mark' + (tile ? ' tile' : '') + (breathing ? ' breathing' : '')} style={{ width: size, height: size, borderRadius: size * 0.22, fontSize: size * 0.4 }} aria-hidden="true">
      <span className="qd-l c2">QD</span><span className="qd-l c1">QD</span><span className="qd-l front">QD</span>
    </span>
  );
}

/** Mark + word, like the end of the splash — sign-in screen and while the app starts. */
export function Brand({ size = 96, animated = false }: { size?: number; animated?: boolean }) {
  return (
    <div className="brand">
      <Logo size={size * 0.75} breathing={animated} />
      <span className="brand-text">QUEUED</span>
    </div>
  );
}
