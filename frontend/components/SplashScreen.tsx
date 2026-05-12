'use client';

import { useEffect, useRef, useState } from 'react';

const SPLASH_KEY = 'splashShown';
const DURATION = 3000;
const FADE_MS = 500;

export default function SplashScreen() {
  const [phase, setPhase] = useState<'in' | 'out' | 'hidden'>('in');
  const [progress, setProgress] = useState(0);
  const [chickX, setChickX] = useState(-40);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (sessionStorage.getItem(SPLASH_KEY)) {
      setPhase('hidden');
      return;
    }

    const startTime = performance.now();
    const screenW = window.innerWidth;

    const tick = (now: number) => {
      const p = Math.min((now - startTime) / DURATION, 1);
      setProgress(p * 100);
      setChickX(-40 + p * (screenW + 80));

      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setPhase('out');
        setTimeout(() => {
          setPhase('hidden');
          sessionStorage.setItem(SPLASH_KEY, 'true');
        }, FADE_MS);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  if (phase === 'hidden') return null;

  return (
    <>
      <style>{`
        @keyframes splash-logo-in {
          from { opacity: 0; transform: scale(0.92); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes chick-bob {
          0%, 100% { transform: translateY(0); }
          50%       { transform: translateY(-3px); }
        }
        @keyframes leg-l {
          0%, 100% { transform: rotate(-25deg); }
          50%       { transform: rotate(25deg); }
        }
        @keyframes leg-r {
          0%, 100% { transform: rotate(25deg); }
          50%       { transform: rotate(-25deg); }
        }
      `}</style>

      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          background: '#0D0D0D',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: phase === 'out' ? 0 : 1,
          transition: phase === 'out' ? `opacity ${FADE_MS}ms ease` : 'opacity 0.4s ease',
          pointerEvents: phase === 'out' ? 'none' : 'all',
        }}
      >
        {/* Logo + title */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 20,
            animation: 'splash-logo-in 0.5s ease forwards',
          }}
        >
          <video
            src="/images/feature-1.mp4"
            autoPlay
            loop
            muted
            playsInline
            style={{
              width: '60%',
              maxWidth: '600px',
              borderRadius: '12px',
            }}
          />
          <span
            style={{
              fontFamily: '"Press Start 2P", monospace',
              color: '#F5C518',
              fontSize: 22,
              letterSpacing: 5,
            }}
          >
            RIAL CHICK
          </span>
        </div>

        {/* Progress bar */}
        <div
          style={{
            marginTop: 44,
            width: 280,
            height: 6,
            background: '#1C1C1C',
            borderRadius: 3,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${progress}%`,
              background: '#F5C518',
              boxShadow: '0 0 8px #F5C518aa',
              borderRadius: 3,
            }}
          />
        </div>

        {/* Walking chick strip */}
        <div
          style={{
            position: 'absolute',
            bottom: 48,
            left: 0,
            width: '100%',
            height: 44,
            overflow: 'hidden',
            pointerEvents: 'none',
          }}
        >
          <PixelChick x={chickX} />
        </div>
      </div>
    </>
  );
}

const S = 4; // px per pixel-unit

function PixelChick({ x }: { x: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 0,
        left: x,
        width: 11 * S,
        height: 11 * S,
        animation: 'chick-bob 0.28s ease-in-out infinite',
      }}
    >
      {/* comb */}
      <Px top={0} left={2} w={2} h={1} color="#CC3333" />
      {/* head */}
      <Px top={1} left={1} w={4} h={3} color="#FFFFFF" />
      {/* eye */}
      <Px top={2} left={3} w={1} h={1} color="#0D0D0D" />
      {/* beak */}
      <Px top={3} left={5} w={2} h={1} color="#F5C518" />
      {/* body */}
      <Px top={3} left={0} w={6} h={4} color="#FFFFFF" />
      {/* tail feather */}
      <Px top={3} left={6} w={2} h={2} color="#FFFFFF" />
      <Px top={2} left={7} w={1} h={1} color="#FFFFFF" />
      {/* leg left */}
      <div
        style={{
          position: 'absolute',
          top: 7 * S,
          left: 1 * S,
          width: 1 * S,
          height: 2 * S,
          background: '#F5C518',
          transformOrigin: 'top center',
          animation: 'leg-l 0.28s linear infinite',
        }}
      />
      {/* foot left */}
      <div
        style={{
          position: 'absolute',
          top: 9 * S,
          left: 0,
          width: 2 * S,
          height: 1 * S,
          background: '#F5C518',
          transformOrigin: 'top center',
          animation: 'leg-l 0.28s linear infinite',
        }}
      />
      {/* leg right */}
      <div
        style={{
          position: 'absolute',
          top: 7 * S,
          left: 3 * S,
          width: 1 * S,
          height: 2 * S,
          background: '#F5C518',
          transformOrigin: 'top center',
          animation: 'leg-r 0.28s linear infinite',
        }}
      />
      {/* foot right */}
      <div
        style={{
          position: 'absolute',
          top: 9 * S,
          left: 2 * S,
          width: 2 * S,
          height: 1 * S,
          background: '#F5C518',
          transformOrigin: 'top center',
          animation: 'leg-r 0.28s linear infinite',
        }}
      />
    </div>
  );
}

function Px({
  top, left, w, h, color,
}: {
  top: number; left: number; w: number; h: number; color: string;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top: top * S,
        left: left * S,
        width: w * S,
        height: h * S,
        background: color,
      }}
    />
  );
}
