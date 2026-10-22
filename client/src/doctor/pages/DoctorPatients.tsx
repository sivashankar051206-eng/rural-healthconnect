import { useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../services/api';
import { useApi, useSubmit } from '../../hooks/useApi';
import { Alert, Empty, errorMessage, Spinner } from '../../components/Feedback';
import { ReportViewer } from '../../components/ReportViewer';
import { fmtDate, fmtDateTime, titleCase } from '../../utils/format';
import { Pager, StatusPill } from './DoctorAppointments';

interface PatientRow {
  id: string;
  patientCode: string;
  fullName: string;
  lastVisit: string;
}

/** Search is scoped by the backend to patients this doctor is authorized for. */
export function DoctorPatients() {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const { data, loading, error } = useApi<{ patients: PatientRow[] }>(`/doctor/patients?page=${page}&pageSize=25${search ? `&q=${encodeURIComponent(search)}` : ''}`);
  return (
    <>
      <header className="page-head">
        <h1>My patients</h1>
        <p className="muted">Only patients with a confirmed, ongoing or completed appointment with you are listed.</p>
      </header>
      <form className="filters" role="search" onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); setPage(1); }}>
        <label>
          Name or patient ID
          <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={80} />
        </label>
        <button className="btn btn-primary btn-small">Search</button>
      </form>
      {loading && !data ? (
        <Spinner />
      ) : error ? (
        <Alert>{errorMessage(error)}</Alert>
      ) : !data?.patients.length ? (
        <Empty>No patients found.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Patient</th>
                <th>Patient ID</th>
                <th>Last appointment</th>
                <th aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {data.patients.map((p) => (
                <tr key={p.id}>
                  <td>{p.fullName}</td>
                  <td className="mono">{p.patientCode}</td>
                  <td>{fmtDateTime(p.lastVisit)}</td>
                  <td>
                    <Link className="btn btn-small btn-ghost" to={`/doctor/patients/${p.id}`}>
                      Open chart
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} setPage={setPage} hasMore={(data?.patients.length ?? 0) === 25} />
    </>
  );
}

interface RecordRow {
  id: string;
  entryType: string;
  title: string;
  details: string | null;
  status: string;
  visibleToPatient: boolean;
  createdAt: string;
  createdByName: string;
}
interface Chart {
  profile: { patientCode: string; fullName: string; dateOfBirth: string; gender: string | null; village: string | null; emergencyContactName: string | null };
  records: RecordRow[];
  corrections: { recordId: string; reason: string; correctedByName: string; createdAt: string }[];
  reports: { id: string; title: string; mimeType: string; sizeBytes: number; scanStatus: string; uploadedByName: string; createdAt: string }[];
  prescriptions: { id: string; version: number; status: string; doctorName: string; finalizedAt: string | null; createdAt: string; itemCount: number }[];
  consultations: { id: string; doctorName: string; startedAt: string; status: string }[];
}

function age(dob: string) {
  const d = new Date(dob);
  const n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a -= 1;
  return a;
}

export function PatientChart() {
  const { patientId } = useParams();
  const { data, loading, error, reload } = useApi<Chart>(`/doctor/patients/${patientId}`);
  const [showHistory, setShowHistory] = useState(false);
  if (loading && !data) return <Spinner />;
  if (error || !data) return <Alert>{errorMessage(error)}</Alert>;
  const p = data.profile;
  const records = data.records.filter((r) => showHistory || r.status === 'ACTIVE');
  const byType = (t: string) => records.filter((r) => r.entryType === t);

  return (
    <>
      <header className="page-head chart-head">
        <div>
          <h1>{p.fullName}</h1>
          <p className="muted">
            <span className="mono">{p.patientCode}</span> · {age(p.dateOfBirth)} y {p.gender ? `· ${titleCase(p.gender)}` : ''} {p.village ? `· ${p.village}` : ''}
          </p>
        </div>
        <Link className="btn btn-primary" to={`/doctor/prescriptions/new?patientId=${patientId}`}>
          New prescription
        </Link>
      </header>

      <div className="chart-grid">
        {(['ALLERGY', 'DIAGNOSIS', 'MEDICATION', 'NOTE'] as const).map((type) => (
          <section className={`panel ${type === 'ALLERGY' ? 'panel-alert' : ''}`} key={type}>
            <h2>{{ ALLERGY: 'Allergies', DIAGNOSIS: 'Diagnoses', MEDICATION: 'Current medications', NOTE: 'Clinical notes' }[type]}</h2>
            {byType(type).length ? (
              <ul className="rec-list">
                {byType(type).map((r) => (
                  <RecordItem key={r.id} r={r} onChanged={() => void reload()} />
                ))}
              </ul>
            ) : (
              <Empty>None recorded.</Empty>
            )}
          </section>
        ))}
      </div>
      <label className="inline-check">
        <input type="checkbox" checked={showHistory} onChange={(e) => setShowHistory(e.target.checked)} /> Show corrected / entered-in-error history ({data.corrections.length} corrections)
      </label>

      <AddRecord patientId={patientId!} onAdded={() => void reload()} />

      <section className="panel">
        <h2>Diagnostic reports</h2>
        {data.reports.length ? (
          <table className="data-table">
            <tbody>
              {data.reports.map((r) => (
                <tr key={r.id}>
                  <td>{r.title}</td>
                  <td>{fmtDate(r.createdAt)}</td>
                  <td>{r.uploadedByName}</td>
                  <td>{r.scanStatus === 'CLEAN' ? <span className="pill pill-COMPLETED">Scanned</span> : <span className="pill pill-SCHEDULED">Not scanned</span>}</td>
                  <td>
                    <ReportViewer path={`/doctor/reports/${r.id}/file`} mimeType={r.mimeType} title={r.title} labels={{ open: 'View', close: 'Close' }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>No reports.</Empty>
        )}
        <UploadReport patientId={patientId!} onDone={() => void reload()} />
      </section>

      <div className="chart-grid">
        <section className="panel">
          <h2>Prescriptions</h2>
          {data.prescriptions.length ? (
            <ul className="rec-list">
              {data.prescriptions.map((rx) => (
                <li key={rx.id}>
                  <Link to={`/doctor/prescriptions/${rx.id}`}>
                    v{rx.version} · {rx.doctorName} · {fmtDate(rx.finalizedAt ?? rx.createdAt)} · {rx.itemCount} item(s)
                  </Link>{' '}
                  <StatusPill status={rx.status} />
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No prescriptions.</Empty>
          )}
        </section>
        <section className="panel">
          <h2>Previous consultations</h2>
          {data.consultations.length ? (
            <ul className="rec-list">
              {data.consultations.map((c) => (
                <li key={c.id}>
                  {fmtDateTime(c.startedAt)} · {c.doctorName} <StatusPill status={c.status} />
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No consultations yet.</Empty>
          )}
        </section>
      </div>
    </>
  );
}

function RecordItem({ r, onChanged }: { r: RecordRow; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(r.title);
  const [details, setDetails] = useState(r.details ?? '');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const { busy, run } = useSubmit();
  const submit = (enteredInError: boolean) =>
    void run(async () => {
      setErr('');
      try {
        await api.post(`/doctor/records/${r.id}/correct`, { title, details: details || null, reason, enteredInError });
        setEditing(false);
        onChanged();
      } catch (e) {
        setErr(errorMessage(e));
      }
    });
  return (
    <li className={r.status !== 'ACTIVE' ? 'struck' : ''}>
      <strong>{r.title}</strong> {r.status !== 'ACTIVE' && <StatusPill status={r.status} />} {!r.visibleToPatient && <span className="pill">Clinician only</span>}
      {r.details && <p>{r.details}</p>}
      <div className="muted">
        {r.createdByName} · {fmtDateTime(r.createdAt)}
        {r.status === 'ACTIVE' && (
          <button type="button" className="link-btn" onClick={() => setEditing((v) => !v)}>
            Correct
          </button>
        )}
      </div>
      {editing && (
        <div className="inline-form">
          <p className="muted">Corrections never overwrite: the original is kept and marked corrected, with your reason.</p>
          <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Corrected title" maxLength={200} />
          <textarea value={details} onChange={(e) => setDetails(e.target.value)} aria-label="Corrected details" rows={2} maxLength={4000} />
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for correction (required)" aria-label="Reason" maxLength={500} />
          <div className="row">
            <button className="btn btn-small btn-primary" disabled={busy || reason.trim().length < 3} onClick={() => submit(false)}>
              Save correction
            </button>
            <button className="btn btn-small btn-danger" disabled={busy || reason.trim().length < 3} onClick={() => submit(true)}>
              Mark entered in error
            </button>
          </div>
          {err && <span className="field-error">{err}</span>}
        </div>
      )}
    </li>
  );
}

export function AddRecord({ patientId, consultationId, onAdded }: { patientId: string; consultationId?: string; onAdded: () => void }) {
  const [entryType, setType] = useState(consultationId ? 'NOTE' : 'DIAGNOSIS');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [visible, setVisible] = useState(true);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const { busy, run } = useSubmit();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      try {
        await api.post(`/doctor/patients/${patientId}/records`, { entryType, title, details: details || null, consultationId: consultationId ?? null, visibleToPatient: visible });
        setTitle('');
        setDetails('');
        setMsg({ kind: 'success', text: 'Saved to the record.' });
        onAdded();
      } catch (e2) {
        setMsg({ kind: 'error', text: errorMessage(e2) });
      }
    });
  };
  return (
    <form className="panel staff-form" onSubmit={submit}>
      <h2>Add to record</h2>
      <div className="form-row">
        <label>
          Type
          <select value={entryType} onChange={(e) => setType(e.target.value)}>
            <option value="NOTE">Clinical note</option>
            <option value="DIAGNOSIS">Diagnosis</option>
            <option value="ALLERGY">Allergy</option>
            <option value="MEDICATION">Current medication</option>
          </select>
        </label>
        <label className="grow">
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
        </label>
      </div>
      <label>
        Details
        <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={3} maxLength={4000} />
      </label>
      <label className="inline-check">
        <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} /> Visible to patient
      </label>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <button className="btn btn-primary btn-small" disabled={busy}>
        Save
      </button>
    </form>
  );
}

function UploadReport({ patientId, onDone }: { patientId: string; onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [err, setErr] = useState('');
  const { busy, run } = useSubmit();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    void run(async () => {
      setErr('');
      try {
        const form = new FormData();
        form.append('title', title);
        form.append('file', file);
        await api.upload(`/doctor/patients/${patientId}/reports`, form);
        setTitle('');
        if (fileRef.current) fileRef.current.value = '';
        onDone();
      } catch (e2) {
        setErr(errorMessage(e2));
      }
    });
  };
  return (
    <form className="form-row upload-row" onSubmit={submit}>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Report title" aria-label="Report title" required maxLength={120} />
      <input ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg" aria-label="Report file" required />
      <button className="btn btn-small btn-secondary" disabled={busy}>
        Upload
      </button>
      {err && <span className="field-error">{err}</span>}
    </form>
  );
}
