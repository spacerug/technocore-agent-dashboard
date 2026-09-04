"use client";

import { useEffect, useRef } from "react";

const GLYPHS = "01ABCDEFGHIJKLMNOPQRSTUVWXYZ<>[]{}アイウエオカキクケコサシスセソ";

export default function MatrixRain() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let width = 0;
    let height = 0;
    let fontSize = 16;
    let drops: number[] = [];
    let animationFrame = 0;
    let previousFrame = 0;

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      width = window.innerWidth;
      height = window.innerHeight;
      fontSize = width < 700 ? 14 : 16;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.fillStyle = "#020603";
      context.fillRect(0, 0, width, height);
      const columns = Math.ceil(width / fontSize);
      drops = Array.from({ length: columns }, () => -Math.floor(Math.random() * Math.max(1, height / fontSize)));
    };

    const draw = () => {
      context.fillStyle = "rgba(2, 6, 3, 0.13)";
      context.fillRect(0, 0, width, height);
      context.font = `700 ${fontSize}px "Courier New", monospace`;
      context.textBaseline = "top";
      for (let column = 0; column < drops.length; column += 1) {
        const glyph = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        const x = column * fontSize;
        const y = drops[column] * fontSize;
        context.fillStyle = Math.random() > 0.94 ? "#b8ffc8" : Math.random() > 0.68 ? "#39d86c" : "#157535";
        context.fillText(glyph, x, y);
        if (y > height && Math.random() > 0.975) drops[column] = -Math.floor(Math.random() * 20);
        else drops[column] += 1;
      }
    };

    const animate = (time: number) => {
      if (time - previousFrame >= 58) {
        draw();
        previousFrame = time;
      }
      animationFrame = window.requestAnimationFrame(animate);
    };

    const applyMotionPreference = () => {
      window.cancelAnimationFrame(animationFrame);
      draw();
      if (!reducedMotion.matches) animationFrame = window.requestAnimationFrame(animate);
    };

    resize();
    applyMotionPreference();
    window.addEventListener("resize", resize);
    reducedMotion.addEventListener("change", applyMotionPreference);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      reducedMotion.removeEventListener("change", applyMotionPreference);
    };
  }, []);

  return <canvas ref={canvasRef} className="matrix-rain" aria-hidden="true" />;
}
