import { useEffect, useRef } from 'react';
import { Icon } from './Icon';

interface Labels {
  title: string;
  text: string;
  notReplacement: string;
  call108: string;
  call112: string;
  close: string;
}

/**
 * Shown for "emergency", "my chest hurts", etc. The app never attempts a diagnosis:
 * it directs the person to emergency services and states it is not a replacement.
 */
export function EmergencyDialog({ open, onClose, labels }: { open: boolean; onClose: () => void; labels: Labels }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal emergency" role="alertdialog" aria-modal="true" aria-labelledby="em-title" aria-describedby="em-text">
        <h2 id="em-title">
          <Icon name="alert" size={32} /> {labels.title}
        </h2>
        <p id="em-text" className="em-text">
          {labels.text}
        </p>
        <a className="btn btn-emergency" href="tel:108">
          <Icon name="phone" /> {labels.call108}
        </a>
        <a className="btn btn-emergency" href="tel:112">
          <Icon name="phone" /> {labels.call112}
        </a>
        <p className="em-note">{labels.notReplacement}</p>
        <button ref={closeRef} type="button" className="btn btn-secondary" onClick={onClose}>
          {labels.close}
        </button>
      </div>
    </div>
  );
}
