import { useEffect, useRef } from 'react'

/**
 * The drifting web behind the sign-in card: nodes that wander and draw a thread
 * to whichever neighbours are close enough, with a shooting star breaking
 * across it every few seconds. Decorative and `aria-hidden`; colour and
 * strength come from `--auth-web-rgb` / `--auth-web-alpha` / `--auth-streak-rgb`,
 * re-read whenever the theme class on `<html>` changes, and nothing runs at all
 * under `prefers-reduced-motion`.
 */

/* Density is per-area, not a fixed count — a count that looks calm on a laptop
   webs into a solid net on a wide monitor. One node per ~30k px² puts the
   average spacing above LINK_DIST, so most nodes hold two or three threads. */
const NODE_AREA = 30_000
const MIN_NODES = 22
const MAX_NODES = 58
const LINK_DIST = 150
const LINE_ALPHA = 0.2

/** Gap between shooting stars, and how long one takes to cross and burn out. */
const SHOOT_MIN_GAP = 2600
const SHOOT_MAX_GAP = 7000
const SHOOT_LIFE = 900

type Node = { x: number; y: number; vx: number; vy: number; r: number; alpha: number }

type Shot = { x: number; y: number; dx: number; dy: number; len: number; born: number }

/** `2 132 199` → `[2, 132, 199]`. Falls back to sky-500 if the token is missing. */
function readRgb(value: string, fallback: [number, number, number]): [number, number, number] {
  const parts = value.trim().split(/[\s,]+/).map(Number)
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return fallback
  return [parts[0], parts[1], parts[2]]
}

export function WebCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    let width = 0
    let height = 0
    let frame = 0
    let rgb: [number, number, number] = [2, 132, 199]
    let streak: [number, number, number] = [3, 105, 161]
    /* Scales the whole web at once: a dark thread on the light sky carries much
       further than a pale one does on the night sky. */
    let scale = 1
    let nextShot = SHOOT_MIN_GAP
    const nodes: Node[] = []
    const shots: Shot[] = []

    const readTokens = () => {
      const style = getComputedStyle(document.documentElement)
      rgb = readRgb(style.getPropertyValue('--auth-web-rgb'), [2, 132, 199])
      streak = readRgb(style.getPropertyValue('--auth-streak-rgb'), [3, 105, 161])
      const parsed = Number(style.getPropertyValue('--auth-web-alpha'))
      scale = Number.isFinite(parsed) && parsed > 0 ? parsed : 1
    }

    /* Back the canvas at device resolution, or the threads smear on retina. */
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const rect = canvas.getBoundingClientRect()
      width = rect.width
      height = rect.height
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const seed = () => {
      nodes.length = 0
      shots.length = 0
      const count = Math.min(MAX_NODES, Math.max(MIN_NODES, Math.round((width * height) / NODE_AREA)))
      for (let i = 0; i < count; i++) {
        nodes.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.24,
          vy: (Math.random() - 0.5) * 0.24,
          r: Math.random() * 1.2 + 1,
          alpha: Math.random() * 0.3 + 0.35,
        })
      }
    }

    /* Breaks in near the top edge, always down-and-right, at a shallow angle. */
    const spawnShot = (now: number) => {
      const angle = (Math.PI / 180) * (20 + Math.random() * 22)
      shots.push({
        x: Math.random() * width * 0.7 - width * 0.1,
        y: Math.random() * height * 0.45,
        dx: Math.cos(angle),
        dy: Math.sin(angle),
        len: 140 + Math.random() * 160,
        born: now,
      })
      nextShot = now + SHOOT_MIN_GAP + Math.random() * (SHOOT_MAX_GAP - SHOOT_MIN_GAP)
    }

    const draw = (now: number) => {
      const [r, g, b] = rgb
      ctx.clearRect(0, 0, width, height)

      /* Wrap at the edges, so the web never thins out on one side. */
      for (const n of nodes) {
        n.x += n.vx
        n.y += n.vy
        if (n.x < 0) n.x = width
        else if (n.x > width) n.x = 0
        if (n.y < 0) n.y = height
        else if (n.y > height) n.y = 0
      }

      /* A thread fades as its two nodes drift apart, so links appear and break
         rather than popping in at full strength. */
      ctx.lineWidth = 0.8
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x
          const dy = nodes[i].y - nodes[j].y
          const dist = Math.hypot(dx, dy)
          if (dist >= LINK_DIST) continue
          const alpha = (1 - dist / LINK_DIST) * LINE_ALPHA * scale
          ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`
          ctx.beginPath()
          ctx.moveTo(nodes[i].x, nodes[i].y)
          ctx.lineTo(nodes[j].x, nodes[j].y)
          ctx.stroke()
        }
      }

      for (const n of nodes) {
        ctx.beginPath()
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${r},${g},${b},${n.alpha * scale})`
        ctx.fill()
      }

      /* The shooting star rides over the web rather than through it. */
      if (now >= nextShot) spawnShot(now)

      const [kr, kg, kb] = streak
      for (let i = shots.length - 1; i >= 0; i--) {
        const shot = shots[i]
        const t = (now - shot.born) / SHOOT_LIFE
        if (t >= 1) {
          shots.splice(i, 1)
          continue
        }

        /* Travel is eased so it enters fast and burns out, and the streak fades
           in over the first fifth of its life and out over the last half. */
        const travel = (width + shot.len) * (1 - (1 - t) * (1 - t))
        const headX = shot.x + shot.dx * travel
        const headY = shot.y + shot.dy * travel
        const tailX = headX - shot.dx * shot.len
        const tailY = headY - shot.dy * shot.len
        const fade = Math.min(1, t / 0.2) * Math.min(1, (1 - t) / 0.5) * Math.max(scale, 0.6)

        const gradient = ctx.createLinearGradient(tailX, tailY, headX, headY)
        gradient.addColorStop(0, `rgba(${kr},${kg},${kb},0)`)
        gradient.addColorStop(1, `rgba(${kr},${kg},${kb},${0.8 * fade})`)
        ctx.strokeStyle = gradient
        ctx.lineWidth = 1.6
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(tailX, tailY)
        ctx.lineTo(headX, headY)
        ctx.stroke()

        ctx.beginPath()
        ctx.arc(headX, headY, 1.7, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${kr},${kg},${kb},${0.9 * fade})`
        ctx.fill()
      }

      frame = requestAnimationFrame(draw)
    }

    readTokens()
    resize()
    seed()
    frame = requestAnimationFrame(draw)

    const observer = new MutationObserver(readTokens)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

    const onResize = () => {
      resize()
      seed()
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return <canvas ref={canvasRef} className="auth-web" aria-hidden />
}
