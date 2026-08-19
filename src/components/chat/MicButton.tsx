'use client';

import { useEffect, useRef, useState } from 'react';

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
          const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
          const formData = new FormData();
          formData.append('audio', blob, 'clip.webm');
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
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={recording ? stopRecording : startRecording}
        disabled={busy}
        aria-pressed={recording}
        aria-label={recording ? 'Stop recording' : 'Start voice input'}
        className={`flex h-10 w-10 items-center justify-center rounded-full text-white ${
          recording ? 'bg-red-600 animate-pulse' : 'bg-zinc-700 dark:bg-zinc-600'
        } disabled:opacity-50`}
      >
        {busy ? '…' : '🎤'}
      </button>
      {errorMessage && <span className="text-xs text-red-600">{errorMessage}</span>}
    </div>
  );
}
