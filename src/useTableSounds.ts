import { useRef, useState } from "react";
/** Tiny synthesized card noises, generated locally; enabled only by a user gesture. */
export function useTableSounds() {
  const [enabled, setEnabled] = useState(false);
  const context = useRef<AudioContext | null>(null);
  const active = useRef(false);
  const play = () => {
    if (
      !active.current ||
      !context.current ||
      context.current.state !== "running"
    )
      return;
    const ctx = context.current;
    for (let i = 0; i < 2; i++) {
      const source = ctx.createOscillator(),
        gain = ctx.createGain();
      const time = ctx.currentTime + i * 0.045;
      source.type = "triangle";
      source.frequency.setValueAtTime(i ? 420 : 760, time);
      source.frequency.exponentialRampToValueAtTime(180, time + 0.04);
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(0.035, time + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.055);
      source.connect(gain);
      gain.connect(ctx.destination);
      source.start(time);
      source.stop(time + 0.06);
    }
  };
  const toggle = async () => {
    if (active.current) {
      active.current = false;
      setEnabled(false);
      return;
    }
    try {
      context.current ??= new AudioContext();
      await context.current.resume();
      active.current = true;
      setEnabled(true);
      play();
    } catch {
      active.current = false;
      setEnabled(false);
    }
  };
  return { enabled, toggle, play };
}
