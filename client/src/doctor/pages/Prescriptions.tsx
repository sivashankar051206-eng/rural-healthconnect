import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../services/api';
import { useApi, useSubmit } from '../../hooks/useApi';
import { Alert, Empty, errorMessage, Spinner } from '../../components/Feedback';
import { fmtDate, fmtDateTime } from '../../utils/format';
import { Pager, StatusPill } from './DoctorAppointments';

interface Item {
  medicineName: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string | null;
}
interface Rx {
  id: string;
  version: number;
  previousVersionId: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'SUPERSEDED' | 'CANCELLED';
  notes: string | null;
  finalizedAt: string | null;
  createdAt: string;
  cancelReason: string | null;
  contentHash: string | null;
  doctor: { name: string; qualification: string; registrationNumber: string };
  patient: { name: string; patientCode: string };
  items: (Item & { position: number })[];
}

export function DoctorPrescriptions() {
  const [page, setPage] = useState(1);
  const { data, loading, error } = useApi<{ prescriptions: { id: string; version: number; status: string; patientName: string; patientCode: string; createdAt: string; finalizedAt: string | null }[] }>(
    `/doctor/prescriptions?page=${page}&pageSize=25`,
  );
  return (
    <>
      <header className="page-head">
        <h1>Prescription history</h1>
        <p className="muted">To write a new prescription, open a patient chart or a consultation.</p>
      </header>
      {loading && !data ? (
        <Spinner />
      ) : error ? (
        <Alert>{errorMessage(error)}</Alert>
      ) : !data?.prescriptions.length ? (
        <Empty>No prescriptions yet.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Patient</th>
                <th>Version</th>
                <th>Status</th>
                <th aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {data.prescriptions.map((p) => (
                <tr key={p.id}>
                  <td>{fmtDate(p.finalizedAt ?? p.createdAt)}</td>
                  <td>
                    {p.patientName} <span className="muted mono">{p.patientCode}</span>
                  </td>
                  <td>v{p.version}</td>
                  <td>
                    <StatusPill status={p.status} />
                  </td>
                  <td>
                    <Link className="btn btn-small btn-ghost" to={`/doctor/prescriptions/${p.id}`}>
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} setPage={setPage} hasMore={(data?.prescriptions.length ?? 0) === 25} />
    </>
  );
}

const emptyItem = (): Item => ({ medicineName: '', dosage: '', frequency: '', duration: '', instructions: '' });

function ItemsEditor({ items, setItems }: { items: Item[]; setItems: (i: Item[]) => void }) {
  const update = (i: number, k: keyof Item, v: string) => setItems(items.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)));
  return (
    <div className="table-wrap">
      <table className="data-table rx-edit">
        <thead>
          <tr>
            <th>#</th>
            <th>Medicine</th>
            <th>Dosage</th>
            <th>Frequency</th>
            <th>Duration</th>
            <th>Instructions</th>
            <th aria-label="Remove" />
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>
                <input value={it.medicineName} onChange={(e) => update(i, 'medicineName', e.target.value)} aria-label={`Medicine ${i + 1}`} maxLength={160} placeholder="e.g. Paracetamol 500 mg" />
              </td>
              <td>
                <input value={it.dosage} onChange={(e) => update(i, 'dosage', e.target.value)} aria-label={`Dosage ${i + 1}`} maxLength={80} placeholder="1 tablet" />
              </td>
              <td>
                <input value={it.frequency} onChange={(e) => update(i, 'frequency', e.target.value)} aria-label={`Frequency ${i + 1}`} maxLength={80} placeholder="Twice a day" />
              </td>
              <td>
                <input value={it.duration} onChange={(e) => update(i, 'duration', e.target.value)} aria-label={`Duration ${i + 1}`} maxLength={80} placeholder="5 days" />
              </td>
              <td>
                <input value={it.instructions ?? ''} onChange={(e) => update(i, 'instructions', e.target.value)} aria-label={`Instructions ${i + 1}`} maxLength={300} placeholder="After food" />
              </td>
              <td>
                <button type="button" className="link-btn" onClick={() => setItems(items.filter((_, idx) => idx !== i))} disabled={items.length === 1} aria-label={`Remove item ${i + 1}`}>
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="btn btn-small btn-secondary" onClick={() => setItems([...items, emptyItem()])} disabled={items.length >= 30}>
        + Add medicine
      </button>
    </div>
  );
}

const clean = (items: Item[]) =>
  items
    .filter((i) => i.medicineName.trim())
    .map((i) => ({ ...i, instructions: i.instructions?.trim() ? i.instructions : null }));

/**
 * Workflow (spec §43): draft → review → sign with password → ACTIVE (immutable).
 * Corrections create a new version; the previous one becomes SUPERSEDED.
 */
export function PrescriptionEditor() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const isNew = !id;
  const { data, loading, error, reload } = useApi<{ prescription: Rx }>(id ? `/doctor/prescriptions/${id}` : null);
  const rx = data?.prescription;
  const [items, setItems] = useState<Item[]>([emptyItem()]);
  const [notes, setNotes] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const { busy, run } = useSubmit();

  useEffect(() => {
    if (rx) {
      setItems(rx.items.map(({ position: _p, ...rest }) => rest));
      setNotes(rx.notes ?? '');
    }
  }, [rx]);

  const guard = (fn: () => Promise<void>) =>
    void run(async () => {
      setMsg(null);
      try {
        await fn();
      } catch (e) {
        setMsg({ kind: 'error', text: errorMessage(e) });
      }
    });

  const saveDraft = () =>
    guard(async () => {
      if (!clean(items).length) throw new Error('Add at least one medicine.');
      if (isNew) {
        const r = await api.post<{ prescription: Rx }>('/doctor/prescriptions', {
          patientId: sp.get('patientId'),
          consultationId: sp.get('consultationId') || null,
          notes: notes || null,
          items: clean(items),
        });
        navigate(`/doctor/prescriptions/${r.prescription.id}`, { replace: true });
      } else {
        await api.put(`/doctor/prescriptions/${id}`, { notes: notes || null, items: clean(items) });
        setMsg({ kind: 'success', text: 'Draft saved.' });
        void reload();
      }
    });

  const finalize = () =>
    guard(async () => {
      await api.put(`/doctor/prescriptions/${id}`, { notes: notes || null, items: clean(items) });
      await api.post(`/doctor/prescriptions/${id}/finalize`, { password });
      setPassword('');
      setReviewing(false);
      setMsg({ kind: 'success', text: 'Prescription signed. It is now final and visible to the patient.' });
      void reload();
    });

  const revise = () =>
    guard(async () => {
      const r = await api.post<{ prescription: Rx }>(`/doctor/prescriptions/${id}/revise`);
      navigate(`/doctor/prescriptions/${r.prescription.id}`);
    });

  const cancel = () =>
    guard(async () => {
      const reason = window.prompt('Reason for cancelling this prescription?');
      if (!reason || reason.trim().length < 3) return;
      await api.post(`/doctor/prescriptions/${id}/cancel`, { reason });
      void reload();
    });

  if (!isNew && loading && !data) return <Spinner />;
  if (!isNew && (error || !rx)) return <Alert>{errorMessage(error)}</Alert>;
  if (isNew && !sp.get('patientId')) return <Alert>Open a patient chart or consultation to start a prescription.</Alert>;

  const editable = isNew || rx?.status === 'DRAFT';

  return (
    <>
      <header className="page-head chart-head">
        <div>
          <h1>{isNew ? 'New prescription' : `Prescription v${rx!.version}`}</h1>
          {rx && (
            <p className="muted">
              {rx.patient.name} <span className="mono">{rx.patient.patientCode}</span> · <StatusPill status={rx.status} />
              {rx.finalizedAt && ` · signed ${fmtDateTime(rx.finalizedAt)}`}
              {rx.previousVersionId && (
                <>
                  {' '}
                  · corrects <Link to={`/doctor/prescriptions/${rx.previousVersionId}`}>previous version</Link>
                </>
              )}
            </p>
          )}
        </div>
      </header>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      {editable ? (
        <section className="panel">
          <ItemsEditor items={items} setItems={setItems} />
          <label className="block-label">
            Notes for the patient (optional)
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={1000} />
          </label>
          <div className="row">
            <button className="btn btn-secondary" disabled={busy} onClick={saveDraft}>
              Save draft
            </button>
            {!isNew && (
              <button className="btn btn-primary" disabled={busy} onClick={() => setReviewing(true)}>
                Review & sign
              </button>
            )}
            {!isNew && (
              <button className="btn btn-ghost" disabled={busy} onClick={cancel}>
                Discard draft
              </button>
            )}
          </div>
          {reviewing && (
            <div className="review-box" role="dialog" aria-label="Review and sign">
              <h2>Review before signing</h2>
              <ol>
                {clean(items).map((i, idx) => (
                  <li key={idx}>
                    <strong>{i.medicineName}</strong> — {i.dosage}, {i.frequency}, for {i.duration}
                    {i.instructions ? ` (${i.instructions})` : ''}
                  </li>
                ))}
              </ol>
              <p className="muted">Once signed, this prescription cannot be edited. Corrections create a new version.</p>
              <label>
                Confirm with your password to sign
                <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
              <div className="row">
                <button className="btn btn-primary" disabled={busy || !password} onClick={finalize}>
                  Sign prescription
                </button>
                <button className="btn btn-secondary" onClick={() => setReviewing(false)}>
                  Back
                </button>
              </div>
            </div>
          )}
        </section>
      ) : (
        <section className="panel">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Medicine</th>
                <th>Dosage</th>
                <th>Frequency</th>
                <th>Duration</th>
                <th>Instructions</th>
              </tr>
            </thead>
            <tbody>
              {rx!.items.map((i) => (
                <tr key={i.position}>
                  <td>{i.position}</td>
                  <td>{i.medicineName}</td>
                  <td>{i.dosage}</td>
                  <td>{i.frequency}</td>
                  <td>{i.duration}</td>
                  <td>{i.instructions ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rx!.notes && <p>Notes: {rx!.notes}</p>}
          {rx!.cancelReason && <p className="muted">Cancelled: {rx!.cancelReason}</p>}
          {rx!.contentHash && (
            <p className="muted">
              Integrity hash: <code className="mono">{rx!.contentHash.slice(0, 16)}…</code>
            </p>
          )}
          {rx!.status === 'ACTIVE' && (
            <div className="row">
              <button className="btn btn-primary" disabled={busy} onClick={revise}>
                Create corrected version
              </button>
              <button className="btn btn-danger" disabled={busy} onClick={cancel}>
                Stop / cancel
              </button>
            </div>
          )}
        </section>
      )}
    </>
  );
}
