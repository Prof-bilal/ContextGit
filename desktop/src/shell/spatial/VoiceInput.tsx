import { useEffect, useRef, useState } from "react";
import { LuMic, LuX } from "react-icons/lu";

export function encodeWav(samples: Float32Array, inputRate: number): number[] {
  const length = Math.floor((samples.length * 16000) / inputRate);
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) =>
    [...value].forEach((letter, index) =>
      view.setUint8(offset + index, letter.charCodeAt(0)),
    );
  text(0, "RIFF");
  view.setUint32(4, buffer.byteLength - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, length * 2, true);
  for (let index = 0; index < length; index++) {
    const start = Math.floor((index * inputRate) / 16000),
      end = Math.max(start + 1, Math.floor(((index + 1) * inputRate) / 16000));
    let total = 0;
    for (let i = start; i < Math.min(end, samples.length); i++)
      total += samples[i];
    const value = Math.max(-1, Math.min(1, total / (end - start)));
    view.setInt16(44 + index * 2, value * (value < 0 ? 32768 : 32767), true);
  }
  return Array.from(new Uint8Array(buffer));
}

export default function VoiceInput({
  onTranscript,
}: {
  onTranscript: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Awaited<
    ReturnType<NonNullable<typeof window.contextgit>["voiceModelStatus"]>
  > | null>(null);
  const [phase, setPhase] = useState("idle");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [transcript, setTranscript] = useState("");
  const recording = useRef<{
    stream: MediaStream;
    context: AudioContext;
    processor: ScriptProcessorNode;
    source: MediaStreamAudioSourceNode;
    chunks: Float32Array[];
    count: number;
  } | null>(null);
  const held = useRef(false);
  const mounted = useRef(true);
  const refresh = () =>
    window.contextgit
      ?.voiceModelStatus()
      .then(setStatus)
      .catch((cause) => setError(String(cause)));
  useEffect(() => {
    mounted.current = true;
    const off = window.contextgit?.onVoiceProgress((value) =>
      setProgress(Math.round((value.bytes / value.total) * 100)),
    );
    return () => {
      mounted.current = false;
      off?.();
      held.current = false;
      const active = recording.current;
      active?.stream.getTracks().forEach((track) => track.stop());
      active?.processor.disconnect();
      active?.source.disconnect();
      void active?.context.close();
    };
  }, []);
  const start = async () => {
    if (!status?.modelReady || !status.sidecarReady || phase !== "idle") return;
    held.current = true;
    setError("");
    setPhase("permission");
    let stream: MediaStream | undefined;
    let context: AudioContext | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true },
        video: false,
      });
      if (!held.current || !mounted.current) {
        stream.getTracks().forEach((track) => track.stop());
        setPhase("idle");
        return;
      }
      context = new AudioContext();
      await context.resume();
      if (!held.current || !mounted.current) {
        stream.getTracks().forEach((track) => track.stop());
        await context.close();
        setPhase("idle");
        return;
      }
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const active = {
        stream,
        context,
        processor,
        source,
        chunks: [] as Float32Array[],
        count: 0,
      };
      recording.current = active;
      processor.onaudioprocess = (event) => {
        const chunk = new Float32Array(event.inputBuffer.getChannelData(0));
        active.chunks.push(chunk);
        active.count += chunk.length;
        if (active.count > active.context.sampleRate * 120) void finish();
      };
      source.connect(processor);
      processor.connect(context.destination);
      setPhase("recording");
    } catch (cause) {
      stream?.getTracks().forEach((track) => track.stop());
      void context?.close();
      held.current = false;
      setPhase("idle");
      setError(
        cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "Microphone access was denied. Enable it in system settings and retry."
          : String(cause),
      );
    }
  };
  const finish = async () => {
    held.current = false;
    const active = recording.current;
    if (!active) return;
    recording.current = null;
    active.processor.disconnect();
    active.source.disconnect();
    active.stream.getTracks().forEach((track) => track.stop());
    await active.context.close();
    const samples = new Float32Array(active.count);
    let offset = 0;
    for (const chunk of active.chunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    if (
      samples.length < active.context.sampleRate / 4 ||
      samples.reduce((sum, value) => sum + value * value, 0) / samples.length <
        0.00001
    ) {
      setPhase("idle");
      setError("No speech detected. Hold the microphone button and try again.");
      return;
    }
    setPhase("transcribing");
    try {
      const result = await window.contextgit!.voiceTranscribe(
        encodeWav(samples, active.context.sampleRate),
      );
      if (mounted.current) setTranscript(result);
    } catch (cause) {
      if (mounted.current) setError(String(cause));
    } finally {
      if (mounted.current) setPhase("idle");
    }
  };
  const download = async () => {
    setPhase("downloading");
    setError("");
    try {
      await window.contextgit!.voiceModelDownload();
      await refresh();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setPhase("idle");
    }
  };
  return (
    <>
      <button
        className="sp-mic"
        aria-label="Voice input"
        onClick={() => {
          setOpen(true);
          void refresh();
        }}
      >
        <LuMic />
      </button>
      {open && (
        <aside className="sp-float sp-voice">
          <header>
            <div>
              <small>Local speech input</small>
              <h2>Voice command</h2>
            </div>
            <button
              aria-label="Close voice input"
              disabled={phase !== "idle"}
              onClick={() => setOpen(false)}
            >
              <LuX />
            </button>
          </header>
          <p>
            Audio stays on this device. Review the transcript before using it in
            the command bar.
          </p>
          <small>{status?.version}</small>
          {!status?.sidecarReady && (
            <p role="alert">
              The Whisper engine is unavailable in this installation.
            </p>
          )}
          {!status?.modelReady && (
            <button
              disabled={phase !== "idle"}
              className="sp-primary"
              onClick={() => void download()}
            >
              Download multilingual base model (148 MB)
            </button>
          )}
          {phase === "downloading" && (
            <p>
              Downloading: {progress}% <progress max={100} value={progress} />
            </p>
          )}
          <button
            className="sp-hold-record"
            disabled={
              !status?.modelReady ||
              !status.sidecarReady ||
              !["idle", "recording", "permission"].includes(phase)
            }
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              void start();
            }}
            onPointerUp={() => void finish()}
            onPointerCancel={() => void finish()}
            onKeyDown={(event) => {
              if (event.code === "Space" && !event.repeat) {
                event.preventDefault();
                void start();
              }
            }}
            onKeyUp={(event) => {
              if (event.code === "Space") {
                event.preventDefault();
                void finish();
              }
            }}
          >
            {phase === "recording"
              ? "Listening… release to transcribe"
              : phase === "transcribing"
                ? "Transcribing locally…"
                : "Hold to speak"}
          </button>
          {(phase !== "idle" || status?.busy) && (
            <button
              onClick={() => {
                held.current = false;
                void window.contextgit?.voiceCancel().then(refresh);
                if (recording.current) {
                  const active = recording.current;
                  recording.current = null;
                  active.stream.getTracks().forEach((track) => track.stop());
                  active.source.disconnect();
                  active.processor.disconnect();
                  void active.context.close();
                  setPhase("idle");
                }
              }}
            >
              Cancel
            </button>
          )}
          {error && <p role="alert">{error}</p>}
          {transcript && (
            <>
              <textarea
                aria-label="Review voice transcript"
                value={transcript}
                onChange={(event) => setTranscript(event.target.value)}
                rows={5}
              />
              <button
                className="sp-primary"
                onClick={() => {
                  onTranscript(transcript);
                  setTranscript("");
                  setOpen(false);
                }}
              >
                Use reviewed transcript
              </button>
            </>
          )}
          {status?.modelReady && phase === "idle" && (
            <button
              onClick={() =>
                void window.contextgit
                  ?.voiceModelRemove()
                  .then(refresh)
                  .catch((cause) => setError(String(cause)))
              }
            >
              Remove downloaded model
            </button>
          )}
        </aside>
      )}
    </>
  );
}
