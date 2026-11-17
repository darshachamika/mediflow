import { useCallback, useEffect, useRef, useState } from "react";
import { isCheckInCode, readCheckInQr } from "./check-in-qr";

export function useCheckInCamera() {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream>(null);
  const frame = useRef(0);
  const generation = useRef(0);
  const [active, setActive] = useState(false);

  const release = useCallback(() => {
    generation.current++;
    cancelAnimationFrame(frame.current);
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  }, []);

  const stop = useCallback(() => {
    release();
    setActive(false);
  }, [release]);

  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === "hidden") stop();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", stop);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", stop);
      release();
    };
  }, [release, stop]);

  async function start(onCode: (code: string) => void, report: (message: string) => void) {
    if (!navigator.mediaDevices?.getUserMedia || !video.current) {
      report("Camera unavailable. Use HTTPS or localhost, upload a QR image, or find the token manually.");
      return;
    }
    const request = ++generation.current;
    const preview = video.current;
    setActive(true);
    report("Starting camera…");
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      if (generation.current !== request) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      media.getVideoTracks().forEach((track) => track.addEventListener("ended", () => {
        if (generation.current !== request) return;
        stop();
        report("The camera disconnected. Restart it, upload a QR image, or find the token manually.");
      }, { once: true }));
      preview.srcObject = media;
      await preview.play();
      if (generation.current !== request) return;
      const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Cannot read camera frames");
      report("Center the patient's QR code in the camera preview.");
      const startedAt = performance.now();
      let lastRead = 0;
      let warned = false;

      function scan(now: number) {
        if (generation.current !== request || !context) return;
        if (preview.videoWidth > 0 && preview.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && now - lastRead >= 120) {
          lastRead = now;
          const code = readCheckInQr(context, preview, preview.videoWidth, preview.videoHeight);
          if (code && isCheckInCode(code)) {
            stop();
            onCode(code);
            return;
          }
          if (code || (!warned && now - startedAt >= 8000)) {
            warned = true;
            report("No readable SuwaDora check-in QR yet. Hold it steady in good light, or upload an image.");
          }
        }
        frame.current = requestAnimationFrame(scan);
      }
      frame.current = requestAnimationFrame(scan);
    } catch (error) {
      if (generation.current !== request) return;
      stop();
      report(error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")
        ? "Camera permission denied. Allow camera access, upload a QR image, or find the token manually."
        : "Could not start the camera. Upload a QR image or find the token manually.");
    }
  }

  return { active, video, start, stop };
}
