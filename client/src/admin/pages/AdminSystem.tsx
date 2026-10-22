import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../services/api';
import { useApi, useSubmit } from '../../hooks/useApi';
import { Alert, Empty, errorMessage, Spinner } from '../../components/Feedback';
import { useReauthAction } from '../../layouts/AdminLayout';
import { Pager } from '../../doctor/pages/DoctorAppointments';
import { fmtDateTime, titleCase } from '../../utils/format';

interface Log {
  id: string;
  createdAt: string;
  actorName: string | null;
  actorRole: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  result: string;
  ip: string | null;
  requestId: string | null;
  metadata: Record<string, unknown>;
}

export function AdminAuditLogs() {
  const [f, setF] = useState({ action: '', result: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page: String(page), pageSize: '50', ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) });
  const { data, loading, error } = useApi<{ logs: Log[] }>(`/admin/audit-logs?${qs}`);
  const [open, setOpen] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => {
    setF((x) => ({ ...x, [k]: k === 'action' ? e.target.value.toUpperCase().replace(/[^A-Z_]/g, '') : e.target.value }));
    setPage(1);
  };
  return (
    <>
      <header className="page-head">
        <h1>Audit logs</h1>
        <p className="muted">Append-only. Passwords, tokens and secrets are never recorded. Viewing this page is itself audited.</p>
      </header>
      <div className="filters">
        <label>
          Action
          <input value={f.action} onChange={set('action')} placeholder="e.g. PRESCRIPTION_VIEWED" />
        </label>
        <label>
          Result
          <select value={f.result} onChange={set('result')}>
            <option value="">All</option>
            <option value="SUCCESS">Success</option>
            <option value="DENIED">Denied</option>
            <option value="FAILURE">Failure</option>
          </select>
        </label>
        <label>
          From
          <input type="date" value={f.from} onChange={set('from')} />
        </label>
        <label>
          To
          <input type="date" value={f.to} onChange={set('to')} />
        </label>
      </div>
      {loading && !data ? (
        <Spinner />
      ) : error ? (
        <Alert>{errorMessage(error)}</Alert>
      ) : !data?.logs.length ? (
        <Empty>No entries.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="data-table dense">
            <thead>
              <tr>
                <th>Time</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Resource</th>
                <th>Result</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {data.logs.map((l) => (
                <tr key={l.id} onClick={() => setOpen(open === l.id ? null : l.id)} className="clickable">
                  <td>{fmtDateTime(l.createdAt)}</td>
                  <td>
                    {l.actorName ?? '—'} <span className="muted">{l.actorRole ?? ''}</span>
                  </td>
                  <td className="mono">
                    {l.action}
                    {open === l.id && <pre className="meta">{JSON.stringify({ ...l.metadata, requestId: l.requestId }, null, 2)}</pre>}
                  </td>
                  <td className="mono muted">{l.resourceType ? `${l.resourceType}:${(l.resourceId ?? '').slice(0, 8)}` : '—'}</td>
                  <td>
                    <span className={`pill pill-${l.result}`}>{titleCase(l.result)}</span>
                  </td>
                  <td className="mono muted">{l.ip ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} setPage={setPage} hasMore={(data?.logs.length ?? 0) === 50} />
    </>
  );
}

interface Facility {
  id: string;
  name: string;
  type: string;
  district: string;
  state: string;
  address: string | null;
  phone: string | null;
  isActive: boolean;
}
const FAC_TYPES = ['PHC', 'CHC', 'DISTRICT_HOSPITAL', 'PRIVATE_HOSPITAL', 'CLINIC', 'OTHER'];
const blankFacility = { name: '', type: 'PHC', district: '', state: '', address: '', phone: '', isActive: true };

export function AdminFacilities() {
  const { data, loading, error, reload } = useApi<{ facilities: Facility[] }>('/admin/facilities');
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(blankFacility);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const { busy, run } = useSubmit();
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((x) => ({ ...x, [k]: e.target.value }));

  const edit = (f: Facility) => {
    setEditing(f.id);
    setForm({ name: f.name, type: f.type, district: f.district, state: f.state, address: f.address ?? '', phone: f.phone ?? '', isActive: f.isActive });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      try {
        const body = { ...form, address: form.address || null, phone: form.phone || null };
        if (editing) await api.put(`/admin/facilities/${editing}`, body);
        else await api.post('/admin/facilities', body);
        setMsg({ kind: 'success', text: 'Facility saved.' });
        setEditing(null);
        setForm(blankFacility);
        void reload();
      } catch (e2) {
        setMsg({ kind: 'error', text: errorMessage(e2) });
      }
    });
  };

  return (
    <>
      <header className="page-head">
        <h1>Healthcare facilities</h1>
      </header>
      <form className="panel staff-form" onSubmit={submit}>
        <h2>{editing ? 'Edit facility' : 'Add facility'}</h2>
        <div className="form-row">
          <label className="grow">
            Name
            <input value={form.name} onChange={set('name')} required maxLength={160} />
          </label>
          <label>
            Type
            <select value={form.type} onChange={set('type')}>
              {FAC_TYPES.map((t) => (
                <option key={t} value={t}>
                  {titleCase(t)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-row">
          <label className="grow">
            District
            <input value={form.district} onChange={set('district')} required maxLength={80} />
          </label>
          <label className="grow">
            State
            <input value={form.state} onChange={set('state')} required maxLength={80} />
          </label>
          <label>
            Phone
            <input value={form.phone} onChange={set('phone')} maxLength={16} />
          </label>
        </div>
        <label>
          Address
          <input value={form.address} onChange={set('address')} maxLength={300} />
        </label>
        <label className="inline-check">
          <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((x) => ({ ...x, isActive: e.target.checked }))} /> Active
        </label>
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        <div className="row">
          <button className="btn btn-primary btn-small" disabled={busy}>
            Save
          </button>
          {editing && (
            <button type="button" className="btn btn-secondary btn-small" onClick={() => { setEditing(null); setForm(blankFacility); }}>
              Cancel
            </button>
          )}
        </div>
      </form>
      {loading && !data ? (
        <Spinner />
      ) : error ? (
        <Alert>{errorMessage(error)}</Alert>
      ) : !data?.facilities.length ? (
        <Empty>No facilities yet.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>District / State</th>
                <th>Phone</th>
                <th>Status</th>
                <th aria-label="Edit" />
              </tr>
            </thead>
            <tbody>
              {data.facilities.map((f) => (
                <tr key={f.id}>
                  <td>{f.name}</td>
                  <td>{titleCase(f.type)}</td>
                  <td>
                    {f.district}, {f.state}
                  </td>
                  <td className="mono">{f.phone ?? '—'}</td>
                  <td>{f.isActive ? 'Active' : 'Inactive'}</td>
                  <td>
                    <button className="btn btn-small btn-ghost" onClick={() => edit(f)}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

interface Issue {
  id: string;
  category: string;
  description: string;
  status: string;
  adminNotes: string | null;
  reporterRole: string;
  reporterName: string;
  createdAt: string;
}

export function AdminIssues() {
  const [status, setStatus] = useState('OPEN');
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useApi<{ issues: Issue[] }>(`/admin/issues?page=${page}&pageSize=25${status ? `&status=${status}` : ''}`);
  const update = async (i: Issue, next: string) => {
    const adminNotes = next === 'RESOLVED' ? window.prompt('Resolution notes (optional)') : null;
    await api.patch(`/admin/issues/${i.id}`, { status: next, adminNotes: adminNotes || null });
    void reload();
  };
  return (
    <>
      <header className="page-head">
        <h1>Reported issues</h1>
      </header>
      <div className="filters">
        <label>
          Status
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All</option>
            <option value="OPEN">Open</option>
            <option value="IN_PROGRESS">In progress</option>
            <option value="RESOLVED">Resolved</option>
          </select>
        </label>
      </div>
      {loading && !data ? (
        <Spinner />
      ) : error ? (
        <Alert>{errorMessage(error)}</Alert>
      ) : !data?.issues.length ? (
        <Empty>No issues.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Reported</th>
                <th>By</th>
                <th>Category</th>
                <th>Description</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {data.issues.map((i) => (
                <tr key={i.id}>
                  <td>{fmtDateTime(i.createdAt)}</td>
                  <td>
                    {i.reporterName} <span className="muted">{titleCase(i.reporterRole)}</span>
                  </td>
                  <td>{titleCase(i.category)}</td>
                  <td className="wrap">
                    {i.description}
                    {i.adminNotes && <div className="muted">Notes: {i.adminNotes}</div>}
                  </td>
                  <td>
                    <span className={`pill pill-${i.status}`}>{titleCase(i.status)}</span>
                  </td>
                  <td className="row-actions">
                    {i.status === 'OPEN' && (
                      <button className="btn btn-small btn-secondary" onClick={() => void update(i, 'IN_PROGRESS')}>
                        Start
                      </button>
                    )}
                    {i.status !== 'RESOLVED' && (
                      <button className="btn btn-small btn-primary" onClick={() => void update(i, 'RESOLVED')}>
                        Resolve
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} setPage={setPage} hasMore={(data?.issues.length ?? 0) === 25} />
    </>
  );
}

const SETTING_META: Record<string, { label: string; type: 'number' | 'boolean'; min?: number; max?: number }> = {
  cancellation_window_hours: { label: 'Patients can cancel up to (hours before)', type: 'number', min: 0, max: 72 },
  max_booking_days_ahead: { label: 'Booking window (days ahead)', type: 'number', min: 1, max: 90 },
  consultation_join_early_minutes: { label: 'Doctor may start consultation early by (minutes)', type: 'number', min: 0, max: 60 },
  patient_self_upload_enabled: { label: 'Patients may upload their own reports', type: 'boolean' },
};

export function AdminSettings() {
  const { data, loading, error, reload } = useApi<{ settings: { key: string; value: unknown; updatedAt: string }[] }>('/admin/settings');
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const { exec, dialog } = useReauthAction();
  useEffect(() => {
    if (data) setValues(Object.fromEntries(data.settings.map((s) => [s.key, s.value])));
  }, [data]);

  const save = (e: FormEvent) => {
    e.preventDefault();
    const body = Object.fromEntries(Object.entries(values).filter(([k]) => k in SETTING_META));
    void exec(async () => {
      await api.put('/admin/settings', body);
      setMsg({ kind: 'success', text: 'Settings saved.' });
      void reload();
    }, 'Changing system configuration requires re-authentication.').catch((e2) => setMsg({ kind: 'error', text: errorMessage(e2) }));
  };

  if (loading && !data) return <Spinner />;
  if (error) return <Alert>{errorMessage(error)}</Alert>;
  return (
    <>
      {dialog}
      <header className="page-head">
        <h1>System configuration</h1>
      </header>
      <form className="panel staff-form" onSubmit={save}>
        {Object.entries(SETTING_META).map(([key, m]) =>
          m.type === 'boolean' ? (
            <label key={key} className="inline-check">
              <input type="checkbox" checked={Boolean(values[key])} onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.checked }))} /> {m.label}
            </label>
          ) : (
            <label key={key}>
              {m.label}
              <input type="number" min={m.min} max={m.max} value={Number(values[key] ?? 0)} onChange={(e) => setValues((v) => ({ ...v, [key]: Number(e.target.value) }))} />
            </label>
          ),
        )}
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        <button className="btn btn-primary btn-small">Save settings</button>
      </form>
    </>
  );
}

interface AdminRow {
  id: string;
  fullName: string;
  email: string;
  status: string;
  mfaEnabled: boolean;
  permissions: string[];
}

const PERM_LABELS: Record<string, string> = {
  'admin.doctors.manage': 'Manage & verify doctors',
  'admin.patients.manage': 'Manage patient accounts (non-clinical)',
  'admin.appointments.manage': 'View / cancel appointments',
  'admin.audit.view': 'View audit logs',
  'admin.facilities.manage': 'Manage facilities',
  'admin.issues.manage': 'Manage reported issues',
  'admin.settings.manage': 'Manage system configuration',
  'admin.permissions.manage': 'Manage administrator permissions',
  'clinical.breakglass': 'Break-glass clinical access (audited)',
};

export function AdminPermissions() {
  const { data, loading, error, reload } = useApi<{ admins: AdminRow[] }>('/admin/admins');
  const me = useApi<{ allPermissions: string[] }>('/admin/me');
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const { exec, dialog } = useReauthAction();
  const all = me.data?.allPermissions ?? Object.keys(PERM_LABELS);

  const current = (a: AdminRow) => draft[a.id] ?? a.permissions;
  const toggle = (a: AdminRow, p: string) => {
    const cur = current(a);
    setDraft((d) => ({ ...d, [a.id]: cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p] }));
  };
  const save = (a: AdminRow) =>
    void exec(async () => {
      await api.put(`/admin/admins/${a.id}/permissions`, { permissions: current(a) });
      setMsg({ kind: 'success', text: `Permissions updated for ${a.fullName}.` });
      setDraft((d) => {
        const { [a.id]: _removed, ...rest } = d;
        return rest;
      });
      void reload();
    }, 'Changing permissions requires re-authentication.').catch((e) => setMsg({ kind: 'error', text: errorMessage(e) }));

  return (
    <>
      {dialog}
      <header className="page-head">
        <h1>Roles & permissions</h1>
        <p className="muted">
          Roles: <strong>ADMIN</strong>, <strong>DOCTOR</strong>, <strong>PATIENT</strong>. Doctor and patient capabilities are fixed by role and resource ownership. Administrator capabilities are granted
          individually (least privilege). New administrators are created with the server CLI.
        </p>
      </header>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {loading && !data ? (
        <Spinner />
      ) : error ? (
        <Alert>{errorMessage(error)}</Alert>
      ) : (
        data?.admins.map((a) => (
          <section className="panel" key={a.id}>
            <div className="panel-head">
              <h2>
                {a.fullName} <span className="muted">{a.email}</span>
              </h2>
              <span className={`pill ${a.mfaEnabled ? 'pill-COMPLETED' : 'pill-CANCELLED'}`}>{a.mfaEnabled ? 'MFA on' : 'MFA off'}</span>
            </div>
            <div className="perm-grid">
              {all.map((p) => (
                <label key={p} className={`inline-check ${p === 'clinical.breakglass' ? 'danger' : ''}`}>
                  <input type="checkbox" checked={current(a).includes(p)} onChange={() => toggle(a, p)} /> {PERM_LABELS[p] ?? p}
                </label>
              ))}
            </div>
            {draft[a.id] && (
              <button className="btn btn-primary btn-small" onClick={() => save(a)}>
                Save changes
              </button>
            )}
          </section>
        ))
      )}
    </>
  );
}
