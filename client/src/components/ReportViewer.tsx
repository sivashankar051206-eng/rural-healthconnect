import { useEffect, useState } from 'react';
import { requestBlob } from '../services/api';
import { errorMessage } from './Feedback';

/**
 * Loads a report ON DEMAND (never automatically — saves bandwidth) through the
 * authenticated API and shows it from an in-memory blob URL that is revoked on close.
 * No storage path or public URL ever reaches the browser.
 */
export function ReportViewer({
  path,
  mimeType,
  title,
  labels,
  t,
}: {
  path: string;
  mimeType: string;
  title: string;
  labels: { open: string; close: string };
  t?: (k: string) => string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  const open = async () => {
    setLoading(true);
    setErr('');
    try {
      const blob = await requestBlob(path);
      setUrl(URL.createObjectURL(blob));
    } catch (e) {
      setErr(errorMessage(e, t));
    } finally {
      setLoading(false);
    }
  };

  if (!url) {
    return (
      <>
        <button type="button" className="btn btn-small" onClick={open} disabled={loading} aria-label={`${labels.open}: ${title}`}>
          {loading ? '…' : labels.open}
        </button>
        {err && <span className="field-error">{err}</span>}
      </>
    );
  }
  return (
    <div className="report-view" onContextMenu={(e) => e.preventDefault()}>
      {mimeType.startsWith('image/') ? (
        <img src={url} alt={title} />
      ) : (
        <iframe src={url} title={title} />
      )}
      <button type="button" className="btn btn-secondary btn-small" onClick={() => setUrl(null)}>
        {labels.close}
      </button>
    </div>
  );
}
