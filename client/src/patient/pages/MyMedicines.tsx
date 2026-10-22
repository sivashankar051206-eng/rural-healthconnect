import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { useApi } from '../../hooks/useApi';
import { Alert, Empty, errorMessage, Spinner } from '../../components/Feedback';
import { Watermarked } from '../../components/Watermark';
import { Icon } from '../../components/Icon';

interface RxSummary {
  id: string;
  version: number;
  status: 'ACTIVE' | 'SUPERSEDED' | 'CANCELLED';
  doctorName: string;
  finalizedAt: string | null;
  createdAt: string;
  itemCount: number;
}
interface RxItem {
  position: number;
  medicineName: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string | null;
}
interface Rx {
  id: string;
  version: number;
  status: string;
  notes: string | null;
  finalizedAt: string | null;
  verificationCode: string | null;
  doctor: { name: string; qualification: string; registrationNumber: string };
  patient: { name: string; patientCode: string };
  items: RxItem[];
  watermark: { patientName: string; patientCode: string; viewedAt: string; label: string };
}

/** "My Medicines": list only (no medicine names are fetched until the patient opens one). */
export function MyMedicines() {
  const { t, formatDate } = useI18n();
  const { data, loading, error } = useApi<{ prescriptions: RxSummary[] }>('/patient/prescriptions');
  if (loading && !data) return <Spinner label={t('common.loading')} />;
  if (error || !data) return <Alert>{errorMessage(error, t)}</Alert>;
  return (
    <section>
      <h1 className="p-title">{t('med.title')}</h1>
      {data.prescriptions.length ? (
        <ul className="rx-list">
          {data.prescriptions.map((p) => (
            <li key={p.id}>
              <Link to={`/patient/prescriptions/${p.id}`} className={`rx-card rx-${p.status}`}>
                <Icon name="pill" size={36} />
                <span>
                  <strong>{t('med.from', { doctor: p.doctorName })}</strong>
                  <span className="muted">{formatDate(p.finalizedAt ?? p.createdAt)}</span>
                  <span className={`status status-${p.status}`}>{t(`med.status${p.status}`)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>{t('med.none')}</Empty>
      )}
    </section>
  );
}

/**
 * Secure prescription viewer:
 * - data comes from an authenticated, audited, no-store API (never a file URL);
 * - no download button; print, copy, selection and context menu are disabled;
 * - a dynamic watermark identifies the viewer and time to discourage sharing.
 * Screenshots/photos remain possible — the protection goal is preventing UNAUTHORIZED ACCESS.
 */
export function MedicineView() {
  const { id } = useParams();
  const { t, formatDateTime } = useI18n();
  // Privacy prompt first: don't fetch or show medical details until the patient chooses to.
  const [reveal, setReveal] = useState(false);
  const { data, error, loading } = useApi<{ prescription: Rx }>(reveal && id ? `/patient/prescriptions/${id}` : null);

  if (!reveal) {
    return (
      <section>
        <h1 className="p-title">{t('med.title')}</h1>
        <Alert kind="info">{t('med.privacyAsk')}</Alert>
        <button type="button" className="btn btn-primary btn-block btn-big" onClick={() => setReveal(true)}>
          {t('med.showNow')}
        </button>
        <Link to="/patient/prescriptions" className="btn btn-secondary btn-block">
          {t('common.back')}
        </Link>
      </section>
    );
  }
  if (loading || (!data && !error)) return <Spinner label={t('common.loading')} />;
  if (error || !data) return <Alert>{errorMessage(error, t)}</Alert>;

  const rx = data.prescription;
  const wm = [rx.watermark.patientName, rx.watermark.patientCode, formatDateTime(rx.watermark.viewedAt), t('med.confidential')];

  return (
    <section>
      <h1 className="p-title">{t('med.title')}</h1>
      <Watermarked lines={wm}>
        <article className="rx-doc" aria-label={t('med.confidential')}>
          <header className="rx-head">
            <div>
              <strong>{rx.doctor.name}</strong>
              <div className="muted">
                {rx.doctor.qualification} · Reg. {rx.doctor.registrationNumber}
              </div>
            </div>
            <span className={`status status-${rx.status}`}>{t(`med.status${rx.status}`)}</span>
          </header>
          <p className="muted">
            {rx.patient.name} · {rx.patient.patientCode} · {rx.finalizedAt ? formatDateTime(rx.finalizedAt) : ''} · v{rx.version}
          </p>
          <ol className="rx-items">
            {rx.items.map((it) => (
              <li key={it.position}>
                <h3>{it.medicineName}</h3>
                <dl>
                  <dt>{t('med.dosage')}</dt>
                  <dd>{it.dosage}</dd>
                  <dt>{t('med.frequency')}</dt>
                  <dd>{it.frequency}</dd>
                  <dt>{t('med.duration')}</dt>
                  <dd>{it.duration}</dd>
                  {it.instructions && (
                    <>
                      <dt>{t('med.instructions')}</dt>
                      <dd>{it.instructions}</dd>
                    </>
                  )}
                </dl>
              </li>
            ))}
          </ol>
          {rx.notes && (
            <p>
              <strong>{t('med.doctorNote')}:</strong> {rx.notes}
            </p>
          )}
          {rx.verificationCode && (
            <p className="rx-verify">
              {t('med.verify')}: <code>{rx.verificationCode}</code>
            </p>
          )}
          <p className="rx-foot">
            {t('med.confidential')} — {t('med.privacy')}
          </p>
        </article>
      </Watermarked>
      <p className="muted">{t('med.showPharmacist')}</p>
      <Link to="/patient/prescriptions" className="btn btn-secondary btn-block">
        {t('common.back')}
      </Link>
    </section>
  );
}
