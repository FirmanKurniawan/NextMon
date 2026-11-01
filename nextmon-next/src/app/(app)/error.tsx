'use client';
import { useEffect, useState } from 'react';

const TEXT: Record<string, { title: string; msg: string; back: string; retry: string }> = {
  id: { title: 'Kesalahan server', msg: 'Terjadi kesalahan. Periksa log server.', back: 'Kembali ke dasbor', retry: 'Coba lagi' },
  en: { title: 'Server error', msg: 'Something went wrong. Check the server log.', back: 'Back to dashboard', retry: 'Try again' },
};

/** Error boundary of the signed-in app (twin of the PHP 500 page): the shell stays, the page body shows a friendly message. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [lang, setLang] = useState('en');
  useEffect(() => {
    setLang(document.documentElement.lang === 'id' ? 'id' : 'en');
  }, []);
  const t = TEXT[lang]!;
  return (
    <div className="card glass" style={{ maxWidth: 640, margin: 'var(--s6) auto' }}>
      <div className="card-b">
        <div className="empty">
          <h3>500 {t.title}</h3>
          <p>{t.msg}</p>
          {error.digest ? <p className="muted mono">{error.digest}</p> : null}
          <div className="row" style={{ justifyContent: 'center', marginTop: 'var(--s3)' }}>
            <button className="btn" type="button" onClick={() => reset()}>
              {t.retry}
            </button>
            <a className="btn btn-primary" href="/">
              {t.back}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
