export default function Avatar({ url, email, size }: { url: string | null; email: string; size: number }) {
  const ini = (email || '?').slice(0, 2).toUpperCase();
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.34 }} aria-hidden="true">
      {url ? <img src={url} alt="" /> : ini}
    </span>
  );
}
