import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../services/api';
import { useApi, useSubmit, useVisiblePolling } from '../../hooks/useApi';
import { Alert, errorMessage, Spinner } from '../../components/Feedback';
import { ChatPanel } from '../../components/ChatPanel';
import { fmtDateTime, fmtTime } from '../../utils/format';
import { AddRecord } from './DoctorPatients';
import { StatusPill } from './DoctorAppointments';

interface Consultation {
  id: string;
  appointmentId: string;
  status: 'IN_PROGRESS' | 'COMPLETED';
  mode: string;
  startedAt: string;
  endedAt: string | null;
  patientId: string;
  patientName: string;
  patientCode: string;
  videoUrl: string | null;
}

export function DoctorConsultation() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useApi<{ consultation: Consultation }>(`/doctor/consultations/${id}`);
  useVisiblePolling(() => void reload(), 30_000, data?.consultation.status === 'IN_PROGRESS');
  const { busy, run } = useSubmit();

  if (loading && !data) return <Spinner />;
  if (error || !data) return <Alert>{errorMessage(error)}</Alert>;
  const c = data.consultation;
  const open = c.status === 'IN_PROGRESS';

  const complete = () =>
    void run(async () => {
      if (!window.confirm('Mark this consultation as completed? Messaging will close.')) return;
      await api.post(`/doctor/consultations/${c.id}/complete`);
      void reload();
    });

  return (
    <>
      <header className="page-head chart-head">
        <div>
          <h1>Consultation · {c.patientName}</h1>
          <p className="muted">
            <span className="mono">{c.patientCode}</span> · started {fmtDateTime(c.startedAt)} <StatusPill status={c.status} />
          </p>
        </div>
        <div className="row">
          <Link className="btn btn-secondary" to={`/doctor/patients/${c.patientId}`}>
            Patient chart
          </Link>
          <button className="btn btn-primary" onClick={() => navigate(`/doctor/prescriptions/new?patientId=${c.patientId}&consultationId=${c.id}`)}>
            Prescribe
          </button>
          {open && (
            <button className="btn btn-danger" disabled={busy} onClick={complete}>
              Complete
            </button>
          )}
        </div>
      </header>
      <div className="chart-grid">
        <section className="panel">
          <h2>Conversation</h2>
          {open && c.videoUrl && (
            <p>
              <a className="btn btn-primary btn-small" href={c.videoUrl} target="_blank" rel="noopener noreferrer">
                Join {c.mode === 'AUDIO' ? 'voice' : 'video'} call
              </a>{' '}
              <span className="muted">Opens in a new window.</span>
            </p>
          )}
          <ChatPanel consultationId={c.id} open={open} formatTime={fmtTime} labels={{ placeholder: 'Type a message to the patient', send: 'Send', you: 'You', other: 'Patient', ended: 'Consultation completed.' }} />
        </section>
        <AddRecord patientId={c.patientId} consultationId={c.id} onAdded={() => undefined} />
      </div>
    </>
  );
}
