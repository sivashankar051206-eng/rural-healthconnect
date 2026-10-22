import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n/I18nProvider';
import { api, newIdempotencyKey } from '../services/api';
import { detectIntent, detectYesNo, type Intent } from './intents';
import { listenOnce, recognitionSupported, speak, stopListening, stopSpeaking, type ListenError } from './speech';
import { Icon } from '../components/Icon';
import { errorMessage } from '../components/Feedback';

/**
 * Voice assistant pipeline (spec §54):
 *   Speech-to-Text → Intent detection → Permission check → Action → Confirmation (if required) → Text-to-Speech
 *
 * "Permission check" is not done here: every action calls the normal authenticated API,
 * so the backend authorizes voice actions exactly like button presses. The assistant
 * has no elevated privileges and never reads medical details aloud.
 */
type Pending =
  | { kind: 'book'; doctorId: string; doctorName: string; startsAt: string; prompt: string }
  | { kind: 'cancel'; appointmentId: string; prompt: string };

interface DoctorLite {
  id: string;
  fullName: string;
}
interface Slot {
  startsAt: string;
}
interface Appt {
  id: string;
  doctorName: string;
  startsAt: string;
  status: string;
}

const ROUTES: Partial<Record<Intent, { path: string; page: string }>> = {
  TALK_TO_DOCTOR: { path: '/patient/consultation', page: 'page.talk' },
  BOOK: { path: '/patient/doctors', page: 'page.book' },
  MEDICINES: { path: '/patient/prescriptions', page: 'page.medicines' },
  APPOINTMENTS: { path: '/patient/appointments', page: 'page.appointments' },
  RECORDS: { path: '/patient/records', page: 'page.records' },
  HELP: { path: '/patient/help', page: 'page.help' },
  HOME: { path: '/patient/dashboard', page: 'page.home' },
};

function tomorrowLocal(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() + 86_400_000));
}

export function VoiceAssistant({ onEmergency }: { onEmergency: () => void }) {
  const { t, speechLocale, voiceIntents, formatDateTime } = useI18n();
  const navigate = useNavigate();
  const [state, setState] = useState<'idle' | 'listening' | 'working'>('idle');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const supported = recognitionSupported();
  const mounted = useRef(true);

  useEffect(
    () => () => {
      mounted.current = false;
      stopListening();
      stopSpeaking();
    },
    [],
  );

  const say = useCallback(
    async (text: string) => {
      setMessage(text);
      await speak(text, speechLocale);
    },
    [speechLocale],
  );

  const onListenError = useCallback(
    (e: unknown) => {
      const err = e as ListenError;
      if (err === 'denied') setMessage(t('voice.micDenied'));
      else if (err === 'unsupported') setMessage(t('voice.unsupported'));
      else if (err === 'network') setMessage(t('common.networkWeak'));
      else if (err !== 'aborted') void say(t('voice.notUnderstood'));
    },
    [t, say],
  );

  const execute = useCallback(
    async (p: Pending) => {
      setState('working');
      try {
        if (p.kind === 'book') {
          await api.post('/patient/appointments', { doctorId: p.doctorId, startsAt: p.startsAt, mode: 'VIDEO' }, { 'Idempotency-Key': newIdempotencyKey() });
          await say(t('voice.booked'));
        } else {
          await api.post(`/patient/appointments/${p.appointmentId}/cancel`, {});
          await say(t('voice.cancelled'));
        }
        navigate('/patient/appointments');
      } catch (e) {
        await say(errorMessage(e, t));
      } finally {
        if (mounted.current) setState('idle');
      }
    },
    [navigate, say, t],
  );

  const resolveConfirmation = useCallback(
    async (answer: 'YES' | 'NO', p: Pending) => {
      setPending(null);
      if (answer === 'YES') await execute(p);
      else await say(t('voice.notDone'));
    },
    [execute, say, t],
  );

  /** Ask for yes/no by voice; buttons are always available as well. */
  const askConfirmation = useCallback(
    async (p: Pending) => {
      setPending(p);
      await say(p.prompt);
      if (!supported) return;
      try {
        setState('listening');
        const alts = await listenOnce(speechLocale);
        const yn = detectYesNo(alts, voiceIntents);
        if (yn) await resolveConfirmation(yn, p);
        else setMessage(t('voice.sayYesNo'));
      } catch {
        setMessage(t('voice.sayYesNo'));
      } finally {
        if (mounted.current) setState('idle');
      }
    },
    [say, supported, speechLocale, voiceIntents, resolveConfirmation, t],
  );

  const planBookTomorrow = useCallback(async () => {
    setState('working');
    setMessage(t('voice.searching'));
    try {
      const { doctors } = await api.get<{ doctors: DoctorLite[] }>('/patient/doctors?pageSize=5');
      const date = tomorrowLocal();
      for (const d of doctors) {
        const { slots } = await api.get<{ slots: Slot[] }>(`/patient/doctors/${d.id}/slots?date=${date}`);
        if (slots.length) {
          const prompt = t('voice.confirmBook', { doctor: d.fullName, time: formatDateTime(slots[0].startsAt) });
          setState('idle');
          await askConfirmation({ kind: 'book', doctorId: d.id, doctorName: d.fullName, startsAt: slots[0].startsAt, prompt });
          return;
        }
      }
      await say(t('voice.noSlots'));
      navigate('/patient/doctors');
    } catch (e) {
      await say(errorMessage(e, t));
    } finally {
      if (mounted.current) setState((s) => (s === 'working' ? 'idle' : s));
    }
  }, [askConfirmation, formatDateTime, navigate, say, t]);

  const planCancel = useCallback(async () => {
    setState('working');
    try {
      const { appointments } = await api.get<{ appointments: Appt[] }>('/patient/appointments?scope=upcoming&pageSize=5');
      const next = appointments.find((a) => a.status === 'SCHEDULED' || a.status === 'CONFIRMED');
      if (!next) {
        await say(t('voice.noAppointments'));
        return;
      }
      const prompt = t('voice.confirmCancel', { doctor: next.doctorName, time: formatDateTime(next.startsAt) });
      setState('idle');
      await askConfirmation({ kind: 'cancel', appointmentId: next.id, prompt });
    } catch (e) {
      await say(errorMessage(e, t));
    } finally {
      if (mounted.current) setState((s) => (s === 'working' ? 'idle' : s));
    }
  }, [askConfirmation, formatDateTime, say, t]);

  const handle = useCallback(
    async (alts: string[]) => {
      const intent = detectIntent(alts, voiceIntents);
      switch (intent) {
        case 'EMERGENCY':
          onEmergency();
          await say(t('emergency.text'));
          return;
        case 'OTHER_PATIENT':
          await say(t('voice.denied'));
          return;
        case 'BOOK_TOMORROW':
          await planBookTomorrow();
          return;
        case 'CANCEL_APPOINTMENT':
          await planCancel();
          return;
        case 'HELP':
          navigate('/patient/help');
          await say(t('voice.helpText'));
          return;
        case 'UNKNOWN':
          await say(t('voice.notUnderstood'));
          return;
        default: {
          const r = ROUTES[intent];
          if (r) {
            navigate(r.path);
            await say(t('voice.opened', { page: t(r.page) }));
          }
        }
      }
    },
    [voiceIntents, onEmergency, say, t, planBookTomorrow, planCancel, navigate],
  );

  const start = async () => {
    if (state !== 'idle') {
      stopListening();
      setState('idle');
      return;
    }
    if (!supported) {
      setMessage(t('voice.unsupported'));
      return;
    }
    stopSpeaking();
    setPending(null);
    setState('listening');
    setMessage(t('voice.listening'));
    try {
      const alts = await listenOnce(speechLocale);
      setState('working');
      await handle(alts);
    } catch (e) {
      onListenError(e);
    } finally {
      if (mounted.current) setState((s) => (s === 'listening' || s === 'working' ? 'idle' : s));
    }
  };

  return (
    <div className="voice">
      {(message || pending) && (
        <div className="voice-bubble" role="status" aria-live="assertive">
          <p>{pending ? pending.prompt : message}</p>
          {pending && (
            <div className="voice-confirm">
              <button type="button" className="btn btn-primary" onClick={() => void resolveConfirmation('YES', pending)}>
                {t('common.yes')}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => void resolveConfirmation('NO', pending)}>
                {t('common.no')}
              </button>
            </div>
          )}
        </div>
      )}
      <button
        type="button"
        className={`mic-btn ${state}`}
        onClick={() => void start()}
        aria-label={t('voice.tapToSpeak')}
        aria-pressed={state === 'listening'}
      >
        <Icon name="mic" size={34} />
        <span>{state === 'listening' ? t('voice.listening') : t('voice.button')}</span>
      </button>
    </div>
  );
}
