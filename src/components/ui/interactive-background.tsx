import { useEffect, useRef, useCallback, memo, useState } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { cn } from "@/lib/utils";

interface InteractiveBackgroundProps {
  className?: string;
  particleCount?: number;
  enableParticles?: boolean;
  enableGradientOrbs?: boolean;
  enableGridPattern?: boolean;
  enableNoise?: boolean;
}

export const InteractiveBackground = memo(function InteractiveBackground({
  className,
  particleCount = 35,
  enableParticles = true,
  enableGradientOrbs = true,
  enableGridPattern = true,
  enableNoise = false,
}: InteractiveBackgroundProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>();
  const nodesRef = useRef<Array<{
    x: number; y: number; baseX: number; baseY: number;
    size: number; opacity: number; phase: number; speed: number;
  }>>([]);
  const mousePosRef = useRef({ x: -1000, y: -1000 });
  const [isVisible, setIsVisible] = useState(true);

  const mouseX = useMotionValue(0.5);
  const mouseY = useMotionValue(0.5);

  const springConfig = { damping: 30, stiffness: 60, mass: 0.8 };
  const smoothMouseX = useSpring(mouseX, springConfig);
  const smoothMouseY = useSpring(mouseY, springConfig);

  const gradientX = useTransform(smoothMouseX, [0, 1], [20, 60]);
  const gradientY = useTransform(smoothMouseY, [0, 1], [20, 60]);
  const orb2X = useTransform(smoothMouseX, [0, 1], [55, 30]);
  const orb2Y = useTransform(smoothMouseY, [0, 1], [65, 35]);

  const lastMouseUpdate = useRef(0);
  const handleMouseMove = useCallback((e: MouseEvent) => {
    const now = performance.now();
    if (now - lastMouseUpdate.current < 32) return;
    lastMouseUpdate.current = now;
    mouseX.set(e.clientX / window.innerWidth);
    mouseY.set(e.clientY / window.innerHeight);
    mousePosRef.current = { x: e.clientX, y: e.clientY };
  }, [mouseX, mouseY]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { threshold: 0.1 }
    );
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [handleMouseMove]);

  // Dotted grid nodes with connections
  useEffect(() => {
    if (!enableParticles || !canvasRef.current || !isVisible) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let width = 0;
    let height = 0;

    const resizeCanvas = () => {
      const dpr = Math.min(window.devicePixelRatio, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.scale(dpr, dpr);
    };
    resizeCanvas();

    let resizeTimeout: NodeJS.Timeout;
    const handleResize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => { resizeCanvas(); initNodes(); }, 150);
    };
    window.addEventListener("resize", handleResize, { passive: true });

    const initNodes = () => {
      const spacing = Math.max(80, Math.min(width, height) / 10);
      const nodes: typeof nodesRef.current = [];
      const cols = Math.ceil(width / spacing) + 2;
      const rows = Math.ceil(height / (spacing * 0.866)) + 2;

      for (let row = -1; row < rows; row++) {
        for (let col = -1; col < cols; col++) {
          if (Math.random() > 0.55) continue;
          const offsetX = row % 2 === 0 ? 0 : spacing * 0.5;
          const x = col * spacing + offsetX + (Math.random() - 0.5) * spacing * 0.4;
          const y = row * spacing * 0.866 + (Math.random() - 0.5) * spacing * 0.3;
          nodes.push({
            x, y, baseX: x, baseY: y,
            size: Math.random() * 1.8 + 0.6,
            opacity: Math.random() * 0.3 + 0.1,
            phase: Math.random() * Math.PI * 2,
            speed: Math.random() * 0.3 + 0.1,
          });
        }
      }
      nodesRef.current = nodes.slice(0, Math.min(nodes.length, particleCount * 3));
    };

    initNodes();

    let lastFrameTime = 0;
    const targetFPS = 30;
    const frameInterval = 1000 / targetFPS;
    const connectionDistance = 180;
    const mouseRadius = 220;

    const animate = (currentTime: number) => {
      if (!isVisible) {
        animationFrameRef.current = requestAnimationFrame(animate);
        return;
      }

      const deltaTime = currentTime - lastFrameTime;
      if (deltaTime < frameInterval) {
        animationFrameRef.current = requestAnimationFrame(animate);
        return;
      }
      lastFrameTime = currentTime - (deltaTime % frameInterval);

      ctx.clearRect(0, 0, width, height);
      const mousePos = mousePosRef.current;
      const nodes = nodesRef.current;
      const time = currentTime * 0.001;

      // Draw connections
      for (let i = 0; i < nodes.length; i++) {
        const nodeA = nodes[i];
        nodeA.x = nodeA.baseX + Math.sin(time * nodeA.speed + nodeA.phase) * 6;
        nodeA.y = nodeA.baseY + Math.cos(time * nodeA.speed * 0.7 + nodeA.phase) * 4;

        // Mouse repulsion
        const dxM = mousePos.x - nodeA.x;
        const dyM = mousePos.y - nodeA.y;
        const distM = Math.sqrt(dxM * dxM + dyM * dyM);
        if (distM < mouseRadius && distM > 0) {
          const force = (mouseRadius - distM) / mouseRadius * 18;
          nodeA.x -= (dxM / distM) * force;
          nodeA.y -= (dyM / distM) * force;
        }

        for (let j = i + 1; j < nodes.length; j++) {
          const nodeB = nodes[j];
          const dx = nodeA.x - nodeB.x;
          const dy = nodeA.y - nodeB.y;
          const distSq = dx * dx + dy * dy;

          if (distSq < connectionDistance * connectionDistance) {
            const dist = Math.sqrt(distSq);
            const opacity = (1 - dist / connectionDistance) * 0.1;
            ctx.beginPath();
            ctx.moveTo(nodeA.x, nodeA.y);
            ctx.lineTo(nodeB.x, nodeB.y);
            ctx.strokeStyle = `hsla(243, 60%, 65%, ${opacity})`;
            ctx.lineWidth = 0.6;
            ctx.stroke();
          }
        }

        // Mouse connection - indigo accent
        if (distM < mouseRadius * 1.5) {
          const opacity = (1 - distM / (mouseRadius * 1.5)) * 0.15;
          ctx.beginPath();
          ctx.moveTo(nodeA.x, nodeA.y);
          ctx.lineTo(mousePos.x, mousePos.y);
          ctx.strokeStyle = `hsla(243, 75%, 70%, ${opacity})`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }

      // Draw nodes
      for (const node of nodes) {
        const gradient = ctx.createRadialGradient(
          node.x, node.y, 0, node.x, node.y, node.size * 5
        );
        gradient.addColorStop(0, `hsla(243, 65%, 70%, ${node.opacity * 0.5})`);
        gradient.addColorStop(1, `hsla(243, 65%, 70%, 0)`);

        ctx.beginPath();
        ctx.arc(node.x, node.y, node.size * 5, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(node.x, node.y, node.size, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(243, 65%, 75%, ${node.opacity * 0.9})`;
        ctx.fill();
      }

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener("resize", handleResize);
      clearTimeout(resizeTimeout);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [enableParticles, particleCount, isVisible]);

  const gradientLeft = useTransform(gradientX, (value) => `${value}%`);
  const gradientTop = useTransform(gradientY, (value) => `${value}%`);
  const secondaryOrbLeft = useTransform(orb2X, (value) => `${value}%`);
  const secondaryOrbTop = useTransform(orb2Y, (value) => `${value}%`);

  return (
    <div
      ref={containerRef}
      className={cn("fixed inset-0 -z-10 overflow-hidden pointer-events-none", className)}
    >
      {/* Deep obsidian base */}
      <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-background/90" />

      {/* Subtle dotted grid */}
      {enableGridPattern && (
        <div className="absolute inset-0 bg-grid-animated" />
      )}

      {/* Indigo gradient orbs */}
      {enableGradientOrbs && (
        <>
          <motion.div
            className="absolute w-[800px] h-[800px] rounded-full will-change-transform"
            style={{
              left: gradientLeft,
              top: gradientTop,
              x: "-50%", y: "-50%",
              background: "radial-gradient(circle, hsla(243, 75%, 59%, 0.08) 0%, hsla(263, 70%, 55%, 0.03) 40%, transparent 70%)",
              filter: "blur(70px)",
            }}
          />
          <motion.div
            className="absolute w-[500px] h-[500px] rounded-full will-change-transform"
            style={{
              left: secondaryOrbLeft,
              top: secondaryOrbTop,
              x: "-50%", y: "-50%",
              background: "radial-gradient(circle, hsla(160, 60%, 45%, 0.05) 0%, hsla(243, 75%, 59%, 0.03) 40%, transparent 70%)",
              filter: "blur(50px)",
            }}
          />
        </>
      )}

      {/* Canvas nodes */}
      {enableParticles && (
        <canvas ref={canvasRef} className="absolute inset-0" style={{ opacity: 0.65 }} />
      )}

      {/* Noise texture */}
      {enableNoise && (
        <div
          className="absolute inset-0 opacity-[0.012]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          }}
        />
      )}

      {/* Vignette */}
      <div
        className="absolute inset-0"
        style={{
          background: "radial-gradient(ellipse at center, transparent 0%, hsl(var(--background)) 100%)",
          opacity: 0.35,
        }}
      />
    </div>
  );
});
