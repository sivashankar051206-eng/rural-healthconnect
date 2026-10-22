import { useRef, useState, type FormEvent } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { api } from '../../services/api';
import { useApi, useSubmit } from '../../hooks/useApi';
import { Alert, Empty, errorMessage, Spinner } from '../../components/Feedback';
import { ReportViewer } from '../../components/ReportViewer';

interface Entry {
  id: string;
  title: string;
  details: string | null;
  createdAt: string;
  createdByName: string;
}
interface Report {
  id: string;
  title: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}
interface Visit {
  id: string;
  doctorName: string;
  specialization: string;
  date: string;
  status: string;
}
interface Records {
  allergies: Entry[];
  conditions: Entry[];
  medications: Entry[];
  notes: Entry[];
  reports: Report[];
  visits: Visit[];
}

const MAX_BYTES = 5 * 1024 * 1024;

/** Compress large photos on the phone before upload (much faster on rural networks). */
async function compressImage(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png)$/.test(file.type) || file.size < 400_000) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.72));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

function Section({ title, items, none }: { title: string; items: Entry[]; none: string }) {
  const { formatDate } = useI18n();
  return (
    <section className="card">
      <h2>{title}</h2>
      {items.length ? (
        <ul className="entry-list">
          {items.map((e) => (
            <li key={e.id}>
              <strong>{e.title}</strong>
              {e.details && <p>{e.details}</p>}
              <span className="muted">
                {e.createdByName} · {formatDate(e.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>{none}</Empty>
      )}
    </section>
  );
}

export function MyRecords() {
  const { t, formatDate } = useI18n();
  const { data, loading, error, reload } = useApi<Records>('/patient/records');
  const [title, setTitle] = useState('');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { busy, run } = useSubmit();

  const upload = (e: FormEvent) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file || !title.trim()) return;
    void run(async () => {
      setMsg(null);
      try {
        const blob = await compressImage(file);
        if (blob.size > MAX_BYTES) throw new Error('too big');
        const name = blob === file ? file.name : file.name.replace(/\.(png|jpe?g)$/i, '') + '.jpg';
        const form = new FormData();
        form.append('title', title.trim());
        form.append('file', blob, name);
        await api.upload('/patient/reports', form);
        setMsg({ kind: 'success', text: t('records.uploaded') });
        setTitle('');
        if (fileRef.current) fileRef.current.value = '';
        void reload();
      } catch (e2) {
        const text = errorMessage(e2, t);
        setMsg({ kind: 'error', text: text === t('common.error') ? t('records.uploadFailed') : text });
      }
    });
  };

  if (loading && !data) return <Spinner label={t('common.loading')} />;
  if (error || !data) return <Alert>{errorMessage(error, t)}</Alert>;

  return (
    <div>
      <h1 className="p-title">{t('records.title')}</h1>
      <p className="muted">{t('records.privacyNote')}</p>
      <Section title={t('records.allergies')} items={data.allergies} none={t('records.none')} />
      <Section title={t('records.medications')} items={data.medications} none={t('records.none')} />
      <Section title={t('records.conditions')} items={data.conditions} none={t('records.none')} />
      <Section title={t('records.notes')} items={data.notes} none={t('records.none')} />

      <section className="card">
        <h2>{t('records.reports')}</h2>
        {data.reports.length ? (
          <ul className="entry-list">
            {data.reports.map((r) => (
              <li key={r.id}>
                <strong>{r.title}</strong> <span className="muted">{formatDate(r.createdAt)}</span>
                <ReportViewer path={`/patient/reports/${r.id}/file`} mimeType={r.mimeType} title={r.title} labels={{ open: t('records.open'), close: t('common.close') }} t={t} />
              </li>
            ))}
          </ul>
        ) : (
          <Empty>{t('records.none')}</Empty>
        )}
        <form className="p-form upload-form" onSubmit={upload}>
          <h3>{t('records.upload')}</h3>
          <label htmlFor="rtitle">{t('records.uploadTitle')}</label>
          <input id="rtitle" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required />
          <label htmlFor="rfile">{t('records.chooseFile')}</label>
          <input id="rfile" ref={fileRef} type="file" accept="image/jpeg,image/png,application/pdf" capture="environment" required />
          {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? t('common.loading') : t('records.upload')}
          </button>
        </form>
      </section>

      <section className="card">
        <h2>{t('records.visits')}</h2>
        {data.visits.length ? (
          <ul className="entry-list">
            {data.visits.map((v) => (
              <li key={v.id}>
                <strong>{v.doctorName}</strong> <span className="muted">{v.specialization}</span>
                <div className="muted">{formatDate(v.date)}</div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>{t('records.none')}</Empty>
        )}
      </section>
    </div>
  );
}
