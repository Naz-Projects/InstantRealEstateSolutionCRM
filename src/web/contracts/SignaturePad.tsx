import { useEffect, useImperativeHandle, useRef, useState } from "react";
import SignaturePadLib from "signature_pad";
import { findOpaqueBounds } from "@/scraper/trimSignature";
import { Button } from "@/components/ui/button";

export interface SignaturePadHandle {
  isEmpty: () => boolean;
  clear: () => void;
  /** PNG data URI cropped tight to the strokes, or null if the canvas is empty. */
  exportTrimmedPng: () => string | null;
}

interface SignaturePadProps {
  ref?: React.Ref<SignaturePadHandle>;
  /** Fired on mount, after each stroke, and on clear. */
  onChange?: (isEmpty: boolean) => void;
}

// Margin (in backing-store pixels) kept around the trimmed signature so the
// strokes are not flush against the cropped PNG's edges.
const PAD = 8;

export function SignaturePad({ ref, onChange }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePadLib | null>(null);
  // Keep the latest onChange in a ref so the mount-only effect never goes stale.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [isEmpty, setIsEmpty] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const pad = new SignaturePadLib(canvas, {
      penColor: "#111827",
      backgroundColor: "rgba(0,0,0,0)",
      minWidth: 0.7,
      maxWidth: 2.5,
    });
    padRef.current = pad;

    // HiDPI: size the backing store to devicePixelRatio. Resizing clears the
    // canvas, so save/restore the strokes around it (spec: orientation change
    // mid-signature must not wipe the drawing).
    function resizeCanvas() {
      // `canvas` is a null-checked const from the enclosing scope, but TS does
      // not flow that narrowing into this escaping listener — re-guard here.
      if (!canvas) return;
      const data = pad.toData();
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      canvas.width = canvas.offsetWidth * ratio;
      canvas.height = canvas.offsetHeight * ratio;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.scale(ratio, ratio);
      pad.clear();
      pad.fromData(data);
    }

    function handleEnd() {
      const empty = pad.isEmpty();
      setIsEmpty(empty);
      onChangeRef.current?.(empty);
    }

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    pad.addEventListener("endStroke", handleEnd);

    // Report the initial (empty) state to the parent.
    onChangeRef.current?.(true);

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      pad.removeEventListener("endStroke", handleEnd);
      pad.off();
      padRef.current = null;
    };
  }, []);

  useImperativeHandle(
    ref,
    (): SignaturePadHandle => ({
      isEmpty: () => padRef.current?.isEmpty() ?? true,
      clear: () => {
        padRef.current?.clear();
        setIsEmpty(true);
        onChangeRef.current?.(true);
      },
      exportTrimmedPng: () => {
        const canvas = canvasRef.current;
        const pad = padRef.current;
        if (!canvas || !pad || pad.isEmpty()) return null;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        const { width, height } = canvas;
        const { data } = ctx.getImageData(0, 0, width, height);
        const bounds = findOpaqueBounds(data, width, height);
        if (!bounds) return null;
        const minX = Math.max(0, bounds.minX - PAD);
        const minY = Math.max(0, bounds.minY - PAD);
        const maxX = Math.min(width - 1, bounds.maxX + PAD);
        const maxY = Math.min(height - 1, bounds.maxY + PAD);
        const w = maxX - minX + 1;
        const h = maxY - minY + 1;
        const out = document.createElement("canvas");
        out.width = w;
        out.height = h;
        const outCtx = out.getContext("2d");
        if (!outCtx) return null;
        outCtx.drawImage(canvas, minX, minY, w, h, 0, 0, w, h);
        return out.toDataURL("image/png");
      },
    }),
    [],
  );

  function handleClear() {
    padRef.current?.clear();
    setIsEmpty(true);
    onChangeRef.current?.(true);
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <canvas
          ref={canvasRef}
          className="w-full h-[180px] rounded-lg border border-slate-300 bg-white touch-none"
        />
        {isEmpty && (
          <>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="text-sm text-slate-400">Sign here</span>
            </div>
            <div className="pointer-events-none absolute left-6 right-6 bottom-9 border-b border-dashed border-slate-300" />
          </>
        )}
      </div>
      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          onClick={handleClear}
          disabled={isEmpty}
          className="h-8 text-xs text-slate-600 cursor-pointer disabled:opacity-40"
        >
          Clear
        </Button>
      </div>
    </div>
  );
}
