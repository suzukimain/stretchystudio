import React, { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import { useAnimationStore } from '@/store/animationStore';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
// animationEngine utilities available if needed for track labels

/* ──────────────────────────────────────────────────────────────────────────
   Constants
────────────────────────────────────────────────────────────────────────── */

const LABEL_W   = 140;  // px — fixed node-name column width
const ROW_H     = 22;   // px — height of each track row
const RULER_H   = 20;   // px — height of the time ruler
const TRACK_PAD = 16;   // px — padding inside track area so edge frames don't clip

/* ──────────────────────────────────────────────────────────────────────────
   Small helpers
────────────────────────────────────────────────────────────────────────── */

function uid() { return Math.random().toString(36).slice(2, 9); }

/** Clamp a number to [min, max] */
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

/** Frame number from time (ms) */
function msToFrame(ms, fps) { return Math.round((ms / 1000) * fps); }

/** Time (ms) from frame number */
function frameToMs(frame, fps) { return (frame / fps) * 1000; }

/* ──────────────────────────────────────────────────────────────────────────
   Transport button (play/pause/stop/loop icons)
────────────────────────────────────────────────────────────────────────── */
function TransportBtn({ onClick, active, title, children }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={[
        'flex items-center justify-center w-6 h-6 rounded text-xs transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   Tiny numeric field (for frame/fps/speed inputs)
────────────────────────────────────────────────────────────────────────── */
function NumField({ label, value, onChange, min, max, step = 1, className = '' }) {
  const [local, setLocal] = useState(String(value));

  useEffect(() => { setLocal(String(value)); }, [value]);

  const commit = () => {
    const n = parseFloat(local);
    if (!isNaN(n)) onChange(clamp(n, min ?? -Infinity, max ?? Infinity));
    else setLocal(String(value));
  };

  return (
    <label className={`flex items-center gap-1 ${className}`}>
      <span className="text-[10px] text-muted-foreground whitespace-nowrap select-none">{label}</span>
      <input
        type="number"
        value={local}
        min={min}
        max={max}
        step={step}
        onChange={e => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); }}
        className="w-12 h-5 text-[11px] text-center bg-input border border-border rounded px-1 py-0 focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </label>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   TimelinePanel — main component
────────────────────────────────────────────────────────────────────────── */
export function TimelinePanel() {
  const anim   = useAnimationStore();
  const proj   = useProjectStore(s => s.project);
  const update = useProjectStore(s => s.updateProject);
  const sel    = useEditorStore(s => s.selection);

  const trackAreaRef = useRef(null);
  const isDraggingPlayhead = useRef(false);

  /* ── Active animation object ────────────────────────────────────────── */
  const animation = useMemo(
    () => proj.animations.find(a => a.id === anim.activeAnimationId) ?? null,
    [proj.animations, anim.activeAnimationId]
  );

  /* ── Derived values ─────────────────────────────────────────────────── */
  const fps         = anim.fps;
  const currentFrame = msToFrame(anim.currentTime, fps);
  const endFrame    = anim.endFrame;
  const startFrame  = anim.startFrame;
  const totalFrames = Math.max(endFrame - startFrame, 1);

  /* ── Auto-select animation when one exists ───────────────────────────── */
  useEffect(() => {
    if (!anim.activeAnimationId && proj.animations.length > 0) {
      anim.setActiveAnimationId(proj.animations[0].id);
      const a = proj.animations[0];
      anim.setFps(a.fps ?? 24);
      anim.setEndFrame(Math.round(((a.duration ?? 2000) / 1000) * (a.fps ?? 24)));
    }
  }, [proj.animations, anim.activeAnimationId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Create a default animation if none ─────────────────────────────── */
  const ensureAnimation = useCallback(() => {
    if (proj.animations.length > 0) return proj.animations[0].id;
    const id = uid();
    update((p) => {
      p.animations.push({
        id,
        name:     'Animation 1',
        duration: 2000,
        fps:      24,
        tracks:   [],
      });
    });
    anim.setActiveAnimationId(id);
    anim.setFps(24);
    anim.setEndFrame(48);
    return id;
  }, [proj.animations, update, anim]);

  /* ── Timeline pixel helpers ─────────────────────────────────────────── */
  const xToFrame = useCallback((clientX) => {
    const rect = trackAreaRef.current?.getBoundingClientRect();
    if (!rect) return startFrame;
    const localX = clientX - rect.left - LABEL_W - TRACK_PAD;
    const trackW = rect.width - LABEL_W - 2 * TRACK_PAD;
    const frac   = clamp(localX / trackW, 0, 1);
    return Math.round(startFrame + frac * totalFrames);
  }, [startFrame, totalFrames]);

  /* ── Playhead drag on ruler ──────────────────────────────────────────── */
  const onRulerPointerDown = useCallback((e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    isDraggingPlayhead.current = true;
    const frame = xToFrame(e.clientX);
    anim.seekFrame(clamp(frame, startFrame, endFrame));
  }, [xToFrame, anim, startFrame, endFrame]);

  const onRulerPointerMove = useCallback((e) => {
    if (!isDraggingPlayhead.current) return;
    const frame = xToFrame(e.clientX);
    anim.seekFrame(clamp(frame, startFrame, endFrame));
  }, [xToFrame, anim, startFrame, endFrame]);

  const onRulerPointerUp = useCallback(() => {
    isDraggingPlayhead.current = false;
  }, []);

  /* ── Build track rows ────────────────────────────────────────────────── */
  // Group tracks by nodeId, show one row per node that has any keyframe.
  const trackRows = useMemo(() => {
    if (!animation) return [];
    const nodeMap = new Map(proj.nodes.map(n => [n.id, n]));
    const byNode  = new Map();

    for (const track of animation.tracks) {
      if (!byNode.has(track.nodeId)) byNode.set(track.nodeId, []);
      byNode.get(track.nodeId).push(track);
    }

    return Array.from(byNode.entries())
      .map(([nodeId, tracks]) => ({
        nodeId,
        name:   nodeMap.get(nodeId)?.name ?? nodeId,
        tracks,
        // Collect all unique keyframe times across all tracks for this node
        times:  [...new Set(tracks.flatMap(t => t.keyframes.map(kf => kf.time)))].sort((a, b) => a - b),
      }));
  }, [animation, proj.nodes]);

  /* ── Delete a keyframe ───────────────────────────────────────────────── */
  const deleteKeyframe = useCallback((nodeId, timeMs) => {
    update((p) => {
      const a = p.animations.find(x => x.id === anim.activeAnimationId);
      if (!a) return;
      for (const track of a.tracks) {
        if (track.nodeId !== nodeId) continue;
        const idx = track.keyframes.findIndex(kf => kf.time === timeMs);
        if (idx >= 0) track.keyframes.splice(idx, 1);
      }
      // Remove empty tracks
      a.tracks = a.tracks.filter(t => t.keyframes.length > 0);
    });
  }, [update, anim.activeAnimationId]);

  /* ── Transport ───────────────────────────────────────────────────────── */
  const togglePlay = useCallback(() => {
    ensureAnimation();
    if (anim.isPlaying) anim.pause();
    else anim.play();
  }, [anim, ensureAnimation]);

  const stop = useCallback(() => {
    anim.stop();
  }, [anim]);

  /* ── Ruler tick marks ────────────────────────────────────────────────── */
  const rulerTicks = useMemo(() => {
    const step   = totalFrames <= 24  ? 1
                 : totalFrames <= 120 ? 5
                 : totalFrames <= 480 ? 10
                 : 24;
    const ticks  = [];
    for (let f = startFrame; f <= endFrame; f += step) {
      ticks.push(f);
    }
    return ticks;
  }, [startFrame, endFrame, totalFrames]);

  /* ── No animation state ──────────────────────────────────────────────── */
  const hasAnimation = proj.animations.length > 0;

  return (
    <div className="flex flex-col h-full select-none text-xs">

      {/* ── Transport bar ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-2 py-1 border-b border-border shrink-0 bg-card">
        {/* Stop */}
        <TransportBtn onClick={stop} title="Stop (return to start)">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <rect x="1" y="1" width="8" height="8" rx="1"/>
          </svg>
        </TransportBtn>

        {/* Play / Pause */}
        <TransportBtn onClick={togglePlay} active={anim.isPlaying} title={anim.isPlaying ? 'Pause' : 'Play'}>
          {anim.isPlaying ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <rect x="1.5" y="1" width="2.5" height="8" rx="0.5"/>
              <rect x="6"   y="1" width="2.5" height="8" rx="0.5"/>
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <polygon points="2,1 9,5 2,9"/>
            </svg>
          )}
        </TransportBtn>

        {/* Loop */}
        <TransportBtn onClick={() => anim.setLoop(!anim.loop)} active={anim.loop} title="Loop">
          <svg width="12" height="10" viewBox="0 0 12 10" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M1 3h8a2 2 0 0 1 0 4H3"/>
            <polyline points="1,1 1,3 3,3"/>
          </svg>
        </TransportBtn>

        <div className="w-px h-4 bg-border mx-1" />

        {/* Frame fields */}
        <NumField
          label="Frame"
          value={currentFrame}
          min={startFrame}
          max={endFrame}
          onChange={(v) => anim.seekFrame(v)}
        />
        <NumField
          label="Start"
          value={startFrame}
          min={0}
          max={endFrame - 1}
          onChange={(v) => anim.setStartFrame(v)}
        />
        <NumField
          label="End"
          value={endFrame}
          min={startFrame + 1}
          onChange={(v) => anim.setEndFrame(v)}
        />

        <div className="w-px h-4 bg-border mx-1" />

        <NumField
          label="FPS"
          value={fps}
          min={1}
          max={120}
          onChange={(v) => anim.setFps(v)}
        />

        {/* Speed slider */}
        <label className="flex items-center gap-1 ml-1">
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">Speed</span>
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={anim.speed}
            onChange={e => anim.setSpeed(parseFloat(e.target.value))}
            className="w-16 h-1 accent-primary"
          />
          <span className="text-[10px] text-muted-foreground w-6">{anim.speed.toFixed(1)}×</span>
        </label>

        <span className="flex-1" />

        {/* Animation name / selector */}
        {animation && (
          <span className="text-[10px] text-muted-foreground truncate max-w-[100px]" title={animation.name}>
            {animation.name}
          </span>
        )}

        {/* New animation */}
        {!hasAnimation && (
          <button
            onClick={ensureAnimation}
            className="text-[10px] px-2 py-0.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            + New Animation
          </button>
        )}

        {/* K key hint */}
        <span className="text-[10px] text-muted-foreground border border-border/40 px-1 py-0.5 font-mono" title="Press K to keyframe selected nodes">
          K
        </span>
      </div>

      {/* ── Track area ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto relative" ref={trackAreaRef}>
        {trackRows.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-[11px] text-muted-foreground/60">
              {hasAnimation
                ? 'Select a node and press K to add keyframes'
                : 'Create an animation to begin'}
            </p>
          </div>
        ) : (
          <div className="relative min-w-full" style={{ minHeight: RULER_H + trackRows.length * ROW_H }}>

            {/* Ruler */}
            <div
              className="sticky top-0 z-10 flex bg-card border-b border-border"
              style={{ height: RULER_H }}
              onPointerDown={onRulerPointerDown}
              onPointerMove={onRulerPointerMove}
              onPointerUp={onRulerPointerUp}
            >
              {/* Label column placeholder */}
              <div style={{ width: LABEL_W, minWidth: LABEL_W }} className="border-r border-border shrink-0" />

              {/* Tick marks — padded inner wrapper so edges don't clip */}
              <div className="relative flex-1 overflow-hidden cursor-col-resize">
                <div className="absolute inset-y-0" style={{ left: TRACK_PAD, right: TRACK_PAD }}>
                  {rulerTicks.map(f => {
                    const frac = (f - startFrame) / totalFrames;
                    return (
                      <div
                        key={f}
                        className="absolute top-0 flex flex-col items-center"
                        style={{ left: `${frac * 100}%`, transform: 'translateX(-50%)' }}
                      >
                        <div className="w-px bg-border" style={{ height: f % (fps || 24) === 0 ? 8 : 4, marginTop: f % (fps || 24) === 0 ? 0 : 4 }} />
                        {f % (fps || 24) === 0 && (
                          <span className="text-[9px] text-muted-foreground leading-none mt-0.5">
                            {f}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Track rows */}
            {trackRows.map((row, ri) => (
              <div
                key={row.nodeId}
                className={[
                  'flex border-b border-border/30',
                  sel.includes(row.nodeId) ? 'bg-primary/5' : 'hover:bg-muted/20',
                ].join(' ')}
                style={{ height: ROW_H }}
              >
                {/* Node label */}
                <div
                  className="flex items-center px-2 border-r border-border/30 shrink-0 text-[11px] text-muted-foreground overflow-hidden"
                  style={{ width: LABEL_W, minWidth: LABEL_W }}
                  title={row.name}
                >
                  <span className="truncate">{row.name}</span>
                </div>

                {/* Keyframe diamonds — padded inner wrapper */}
                <div className="relative flex-1 overflow-hidden">
                <div className="absolute inset-y-0" style={{ left: TRACK_PAD, right: TRACK_PAD }}>
                  {row.times.map(timeMs => {
                    const frame = msToFrame(timeMs, fps);
                    const frac  = (frame - startFrame) / totalFrames;
                    if (frac < 0 || frac > 1) return null;

                    const isAtPlayhead = frame === currentFrame;

                    return (
                      <button
                        key={timeMs}
                        title={`Frame ${frame} — right-click to delete`}
                        onContextMenu={e => { e.preventDefault(); deleteKeyframe(row.nodeId, timeMs); }}
                        onClick={() => anim.seekFrame(frame)}
                        className={[
                          'absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5',
                          'rotate-45 border transition-colors',
                          isAtPlayhead
                            ? 'bg-primary border-primary'
                            : 'bg-card border-primary/60 hover:bg-primary/40',
                        ].join(' ')}
                        style={{ left: `${frac * 100}%` }}
                      />
                    );
                  })}
                </div>
                </div>
              </div>
            ))}

            {/* Playhead — vertical line spanning ruler + all rows */}
            {trackRows.length > 0 && (() => {
              const frac = (currentFrame - startFrame) / totalFrames;
              if (frac < 0 || frac > 1) return null;
              return (
                <div
                  className="absolute top-0 bottom-0 w-px bg-primary/80 pointer-events-none z-20"
                  style={{ left: `calc(${LABEL_W + TRACK_PAD}px + ${frac * 100}% - ${(LABEL_W + 2 * TRACK_PAD) * frac}px)` }}
                >
                  {/* Playhead triangle head */}
                  <div className="absolute -top-0 left-1/2 -translate-x-1/2 w-0 h-0
                    border-l-[4px] border-l-transparent
                    border-r-[4px] border-r-transparent
                    border-t-[6px] border-t-primary/80" />
                </div>
              );
            })()}

          </div>
        )}
      </div>
    </div>
  );
}
