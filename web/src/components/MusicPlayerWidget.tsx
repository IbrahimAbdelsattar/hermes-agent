import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Music2,
  Shuffle,
  Repeat,
  Volume2,
  VolumeX,
  ListMusic,
  Disc3,
  Upload,
  Radio,
} from 'lucide-react';
import { apiFetch } from '@/utils/jarvisApiClient';
import type { MusicTrack, MusicCommand } from '@/types/jarvis';

interface MusicPlayerWidgetProps {
  command?: MusicCommand | null;
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds) || seconds <= 0) {
    return '--:--';
  }
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Built-in Demo Cyberpunk Ambient Synthesizer using Web Audio API
class CyberSynthEngine {
  private ctx: AudioContext | null = null;
  private osc1: OscillatorNode | null = null;
  private osc2: OscillatorNode | null = null;
  private gainNode: GainNode | null = null;
  private isPlaying = false;

  public start(volume = 0.8) {
    if (this.isPlaying) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.gainNode = this.ctx.createGain();
      this.gainNode.gain.setValueAtTime(volume * 0.15, this.ctx.currentTime);
      this.gainNode.connect(this.ctx.destination);

      // Deep drone
      this.osc1 = this.ctx.createOscillator();
      this.osc1.type = 'sawtooth';
      this.osc1.frequency.setValueAtTime(55, this.ctx.currentTime); // A1 note

      // Shimmer detune
      this.osc2 = this.ctx.createOscillator();
      this.osc2.type = 'sine';
      this.osc2.frequency.setValueAtTime(110.5, this.ctx.currentTime); // A2 slight detune

      this.osc1.connect(this.gainNode);
      this.osc2.connect(this.gainNode);

      this.osc1.start();
      this.osc2.start();
      this.isPlaying = true;
    } catch (e) {
      console.warn('Web Audio synth failed:', e);
    }
  }

  public stop() {
    if (!this.isPlaying) return;
    try {
      this.osc1?.stop();
      this.osc2?.stop();
      this.osc1?.disconnect();
      this.osc2?.disconnect();
      this.ctx?.close();
    } catch {
      // ignore
    }
    this.isPlaying = false;
  }

  public setVolume(volume: number) {
    if (this.gainNode && this.ctx) {
      this.gainNode.gain.setValueAtTime(volume * 0.15, this.ctx.currentTime);
    }
  }

  public active() {
    return this.isPlaying;
  }
}

const DEFAULT_DEMO_TRACKS: MusicTrack[] = [
  {
    id: 'track-cyber-1',
    title: 'Mark 85 Cyber Sentinel (Ambient Drone)',
    artist: 'JARVIS Audio Core',
    duration: 180,
    path: 'synthetic-ambient',
    sizeBytes: 1024,
  },
  {
    id: 'track-cyber-2',
    title: 'Neon Arc Reactor Pulse',
    artist: 'Stark Holographic Acoustics',
    duration: 240,
    path: 'synthetic-ambient',
    sizeBytes: 1024,
  },
];

export const MusicPlayerWidget: React.FC<MusicPlayerWidgetProps> = ({ command: _command }) => {
  const [tracks, setTracks] = useState<MusicTrack[]>(DEFAULT_DEMO_TRACKS);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState<number | null>(180);
  const [volume, setVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);
  const [isShuffle, setIsShuffle] = useState(false);
  const [isRepeat, setIsRepeat] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const synthRef = useRef<CyberSynthEngine>(new CyberSynthEngine());
  const timerRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Scan API music library if available
  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/music/library')
      .then((res) => {
        if (!res.ok) throw new Error(`API ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        const list: MusicTrack[] = Array.isArray(data?.tracks) && data.tracks.length > 0 ? data.tracks : [];
        if (list.length > 0) {
          setTracks(list);
          setCurrentIndex(0);
          setError(null);
        }
      })
      .catch(() => {
        // Keep default ambient cyber tracks
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const currentTrack = tracks[currentIndex] ?? null;

  // Handle Play/Pause
  const togglePlay = () => {
    if (!currentTrack) return;

    if (isPlaying) {
      // Pause
      if (currentTrack.path === 'synthetic-ambient') {
        synthRef.current.stop();
      } else if (audioRef.current) {
        audioRef.current.pause();
      }
      clearInterval(timerRef.current);
      setIsPlaying(false);
    } else {
      // Play
      if (currentTrack.path === 'synthetic-ambient') {
        synthRef.current.start(isMuted ? 0 : volume);
        timerRef.current = setInterval(() => {
          setCurrentTime((prev) => {
            const next = prev + 1;
            if (next >= (currentTrack.duration || 180)) {
              if (isRepeat) return 0;
              playNext();
              return 0;
            }
            return next;
          });
        }, 1000);
        setIsPlaying(true);
      } else if (audioRef.current) {
        audioRef.current
          .play()
          .then(() => setIsPlaying(true))
          .catch((err) => {
            console.warn('Audio play error, using synth:', err);
            synthRef.current.start(isMuted ? 0 : volume);
            setIsPlaying(true);
          });
      }
    }
  };

  const playTrackAt = useCallback(
    (index: number) => {
      synthRef.current.stop();
      clearInterval(timerRef.current);
      setCurrentIndex(index);
      setCurrentTime(0);
      const track = tracks[index];
      if (!track) return;
      setDuration(track.duration || 180);

      if (track.path === 'synthetic-ambient') {
        synthRef.current.start(isMuted ? 0 : volume);
        timerRef.current = setInterval(() => {
          setCurrentTime((prev) => {
            const next = prev + 1;
            if (next >= (track.duration || 180)) {
              if (isRepeat) return 0;
              playNext();
              return 0;
            }
            return next;
          });
        }, 1000);
        setIsPlaying(true);
      } else if (audioRef.current) {
        audioRef.current.src = track.path;
        audioRef.current
          .play()
          .then(() => setIsPlaying(true))
          .catch(() => {
            synthRef.current.start(isMuted ? 0 : volume);
            setIsPlaying(true);
          });
      }
    },
    [tracks, isMuted, volume, isRepeat]
  );

  const playNext = useCallback(() => {
    if (tracks.length === 0) return;
    const next = isShuffle
      ? Math.floor(Math.random() * tracks.length)
      : (currentIndex + 1) % tracks.length;
    playTrackAt(next);
  }, [tracks.length, isShuffle, currentIndex, playTrackAt]);

  const playPrev = useCallback(() => {
    if (tracks.length === 0) return;
    const prev = (currentIndex - 1 + tracks.length) % tracks.length;
    playTrackAt(prev);
  }, [tracks.length, currentIndex, playTrackAt]);

  useEffect(() => {
    synthRef.current.setVolume(isMuted ? 0 : volume);
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  // Clean up audio on unmount
  useEffect(() => {
    return () => {
      synthRef.current.stop();
      clearInterval(timerRef.current);
    };
  }, []);

  // Handle local file upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newTracks: MusicTrack[] = Array.from(files).map((f, i) => ({
      id: `local-${Date.now()}-${i}`,
      title: f.name.replace(/\.[^/.]+$/, ''),
      artist: 'Local Audio File',
      duration: 120,
      path: URL.createObjectURL(f),
      sizeBytes: f.size,
    }));

    setTracks((prev) => [...newTracks, ...prev]);
    playTrackAt(0);
  };

  const progress = duration && duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="w-full h-full flex flex-col rounded-xl bg-[#040d1a]/95 border border-[#00f0ff]/30 shadow-[0_0_25px_rgba(0,240,255,0.08)] overflow-hidden font-mono text-xs">
      {/* Header Deck */}
      <div className="px-4 py-3 border-b border-[#00f0ff]/20 bg-[#071526]/80 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="size-8 rounded-lg bg-[#00f0ff]/10 border border-[#00f0ff]/40 flex items-center justify-center text-[#00f0ff]">
            <Music2 className="size-4 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-[#00f0ff] tracking-wide">JARVIS AUDIO DECK</span>
              <span className="text-[10px] px-2 py-0.2 rounded bg-amber-400/10 text-amber-300 border border-amber-400/30">
                HOLOGRAPHIC
              </span>
            </div>
            <p className="text-[11px] text-[#80f7ff]/60">Ambient Synth & Media Queue</p>
          </div>
        </div>

        {/* Upload & Audio Mode */}
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            multiple
            onChange={handleFileUpload}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-2.5 py-1 rounded bg-[#00f0ff]/10 hover:bg-[#00f0ff]/20 text-[#00f0ff] border border-[#00f0ff]/30 flex items-center gap-1.5 transition-all text-xs"
            title="Upload audio tracks"
          >
            <Upload className="size-3" /> Load Audio
          </button>
        </div>
      </div>

      {/* Now Playing Banner */}
      <div className="p-4 bg-[#051424]/90 border-b border-[#00f0ff]/15">
        {currentTrack ? (
          <div className="flex items-center gap-3">
            <div className="size-12 rounded-xl bg-[#071d33] border border-[#00f0ff]/40 flex items-center justify-center text-[#00f0ff] shrink-0 shadow-[0_0_15px_rgba(0,240,255,0.2)]">
              <Disc3 className={`size-6 ${isPlaying ? 'animate-spin' : ''}`} style={{ animationDuration: '4s' }} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-cyan-100 truncate">{currentTrack.title}</p>
              <p className="text-[11px] text-cyan-400/60 truncate flex items-center gap-1 mt-0.5">
                <Radio className="size-3 text-amber-400" /> {currentTrack.artist}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs text-amber-400 font-bold tabular-nums">{formatDuration(currentTime)}</p>
              <p className="text-[10px] text-cyan-400/50 tabular-nums">
                {formatDuration(duration ?? currentTrack.duration)}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-cyan-400/50 py-2 text-center tracking-widest">NO TRACK SELECTED</p>
        )}

        {/* Seek Progress Bar */}
        <div className="mt-4">
          <input
            type="range"
            min={0}
            max={duration && duration > 0 ? duration : 100}
            step={0.5}
            value={currentTime}
            onChange={(e) => {
              const val = Number(e.target.value);
              setCurrentTime(val);
              if (audioRef.current && currentTrack?.path !== 'synthetic-ambient') {
                audioRef.current.currentTime = val;
              }
            }}
            className="w-full h-1.5 appearance-none rounded-full bg-cyan-950 outline-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, #00f0ff ${progress}%, rgba(0,240,255,0.15) ${progress}%)`,
            }}
          />
        </div>

        {/* Transport Controls */}
        <div className="mt-3 flex items-center justify-center gap-4">
          <button
            onClick={() => setIsShuffle((prev) => !prev)}
            className={`p-2 rounded-lg transition-all ${
              isShuffle ? 'bg-amber-400/20 text-[#ffb700] border border-amber-400/40' : 'text-cyan-400/50 hover:text-cyan-300'
            }`}
            title="Toggle Shuffle"
          >
            <Shuffle className="size-4" />
          </button>

          <button
            onClick={playPrev}
            className="p-2 text-cyan-300 hover:text-amber-400 transition-colors"
            title="Previous Track"
          >
            <SkipBack className="size-5" />
          </button>

          <button
            onClick={togglePlay}
            className="size-12 rounded-full bg-gradient-to-br from-[#00f0ff] to-[#0088ff] text-[#040d1a] flex items-center justify-center shadow-[0_0_20px_rgba(0,240,255,0.4)] hover:shadow-[0_0_30px_rgba(0,240,255,0.6)] transition-all font-bold"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause className="size-5" /> : <Play className="size-5 ml-0.5" />}
          </button>

          <button
            onClick={playNext}
            className="p-2 text-cyan-300 hover:text-amber-400 transition-colors"
            title="Next Track"
          >
            <SkipForward className="size-5" />
          </button>

          <button
            onClick={() => setIsRepeat((prev) => !prev)}
            className={`p-2 rounded-lg transition-all ${
              isRepeat ? 'bg-amber-400/20 text-[#ffb700] border border-amber-400/40' : 'text-cyan-400/50 hover:text-cyan-300'
            }`}
            title="Toggle Repeat"
          >
            <Repeat className="size-4" />
          </button>
        </div>

        {/* Volume Bar */}
        <div className="mt-3 flex items-center gap-2 max-w-xs mx-auto">
          <button
            onClick={() => setIsMuted(!isMuted)}
            className="text-cyan-400 hover:text-cyan-200 transition-colors"
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted || volume === 0 ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={isMuted ? 0 : volume}
            onChange={(e) => {
              const val = Number(e.target.value);
              setVolume(val);
              setIsMuted(val === 0);
            }}
            className="w-full h-1 appearance-none rounded-full bg-cyan-950 outline-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, #00f0ff ${(isMuted ? 0 : volume) * 100}%, rgba(0,240,255,0.15) ${(isMuted ? 0 : volume) * 100}%)`,
            }}
          />
        </div>
      </div>

      {/* Track List Queue */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1.5">
        <div className="flex items-center gap-2 px-2 pb-1 text-[10px] tracking-widest text-cyan-400/60 font-bold uppercase">
          <ListMusic className="size-3.5" />
          AUDIO LIBRARY QUEUE ({tracks.length})
        </div>

        {error && (
          <div className="p-2 rounded bg-red-950/40 border border-red-500/30 text-red-300 text-[11px]">
            {error}
          </div>
        )}

        {tracks.map((t, idx) => {
          const isSelected = idx === currentIndex;
          return (
            <button
              key={t.id}
              onClick={() => playTrackAt(idx)}
              className={`w-full flex items-center justify-between p-2.5 rounded-lg text-left transition-all border ${
                isSelected
                  ? 'bg-[#00f0ff]/10 border-[#00f0ff]/40 text-[#00f0ff]'
                  : 'bg-[#06182c]/40 border-transparent hover:border-[#00f0ff]/20 text-slate-300'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <span className="size-5 rounded flex items-center justify-center text-[10px] bg-[#00f0ff]/10 text-[#00f0ff] shrink-0 font-bold">
                  {isSelected && isPlaying ? '▶' : idx + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-xs">{t.title}</p>
                  <p className="truncate text-[10px] text-cyan-400/60">{t.artist}</p>
                </div>
              </div>
              <span className="text-[10px] text-cyan-400/50 tabular-nums ml-2 shrink-0">
                {formatDuration(t.duration)}
              </span>
            </button>
          );
        })}
      </div>

      <audio
        ref={audioRef}
        preload="metadata"
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onEnded={playNext}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
      />
    </div>
  );
};

export default MusicPlayerWidget;
