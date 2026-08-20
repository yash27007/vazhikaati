'use client';

import { useEffect, useRef, useState } from 'react';
import { Mic01Icon } from 'hugeicons-react';

export function MicButton({
  language,
  onTranscribed,
}: {
  language: string;
  onTranscribed: (text: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const unmountedRef = useRef(false);

  // Stop any in-flight recording and release the microphone if this
  // component unmounts mid-recording (e.g. the chat view is torn down).
  // `.stop()` on the recorder fires the existing `onstop` handler (which
  // already stops the stream's tracks) even after unmount, since it's a
  // plain closure over `stream`, not tied to React lifecycle. The
  // `streamRef` fallback covers the case where unmount happens before the
  // recorder was ever created (still awaiting `getUserMedia`).
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      } else {
        streamRef.current?.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  async function startRecording() {
    setErrorMessage(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (unmountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setBusy(true);
        try {
          const mimeType = recorder.mimeType || 'audio/webm';
          const subtype = mimeType.split('/')[1]?.split(';')[0];
          const extension = subtype && subtype.length > 0 ? subtype : 'webm';
          const blob = new Blob(chunksRef.current, { type: mimeType });
          const formData = new FormData();
          formData.append('audio', blob, `clip.${extension}`);
          if (language) formData.append('language', language);

          const response = await fetch('/api/transcribe', { method: 'POST', body: formData });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error ?? 'Transcription failed');
          onTranscribed(body.text);
        } catch {
          setErrorMessage("Couldn't hear that — try again.");
        } finally {
          setBusy(false);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setErrorMessage('Microphone access was denied or unavailable.');
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={recording ? stopRecording : startRecording}
        disabled={busy}
        aria-pressed={recording}
        aria-label={recording ? 'Stop recording' : 'Start voice input'}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40 ${
          recording
            ? 'bg-band-broken text-surface-raised ring-4 ring-band-broken-bg animate-pulse'
            : 'bg-ink text-surface hover:bg-accent hover:text-accent-ink'
        }`}
      >
        {busy ? (
          <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-current" />
        ) : (
          <Mic01Icon size={17} strokeWidth={1.8} />
        )}
      </button>
      {errorMessage && (
        <span
          role="alert"
          className="absolute top-full right-0 z-10 mt-1.5 w-36 text-right text-[0.6875rem] leading-tight text-danger"
        >
          {errorMessage}
        </span>
      )}
    </div>
  );
}
