"use client";

import { useEffect, useRef } from "react";

const vertexShaderSource = `
  attribute vec2 position;
  void main() {
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const fragmentShaderSource = `
  precision highp float;
  uniform vec2 u_resolution;
  uniform float u_time;
  uniform vec2 u_mouse;
  uniform float u_valence;
  uniform float u_arousal;

  float random(in vec2 _st) {
      return fract(sin(dot(_st.xy, vec2(12.9898,78.233))) * 43758.5453123);
  }

  float noise(in vec2 _st) {
      vec2 i = floor(_st);
      vec2 f = fract(_st);
      float a = random(i);
      float b = random(i + vec2(1.0, 0.0));
      float c = random(i + vec2(0.0, 1.0));
      float d = random(i + vec2(1.0, 1.0));
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(a, b, u.x) +
              (c - a)* u.y * (1.0 - u.x) +
              (d - b) * u.x * u.y;
  }

  #define NUM_OCTAVES 6

  float fbm(in vec2 _st) {
      float v = 0.0;
      float a = 0.5;
      vec2 shift = vec2(100.0);
      mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.50));
      for (int i = 0; i < NUM_OCTAVES; ++i) {
          v += a * noise(_st);
          _st = rot * _st * 2.0 + shift;
          a *= 0.5;
      }
      return v;
  }

  void main() {
      // Very low scale = huge, puffy cloud shapes
      vec2 st = gl_FragCoord.xy / u_resolution.xy * 1.0;
      
      vec2 mouseDist = u_mouse / u_resolution.xy;
      float speed = 0.03 + (u_arousal * 0.08);
      float time = u_time * speed;

      // Primary cloud structure
      vec2 q = vec2(0.0);
      q.x = fbm(st + vec2(0.0, time));
      q.y = fbm(st + vec2(1.0, time * 0.6));

      vec2 r = vec2(0.0);
      r.x = fbm(st + 0.4 * q + vec2(1.7, 9.2) + time * 0.5 + (mouseDist.x * 0.15));
      r.y = fbm(st + 0.4 * q + vec2(8.3, 2.8) + time * 0.5 + (mouseDist.y * 0.15));

      float f = fbm(st + r);

      // Second FBM layer at different scale for clumpy detail
      float clumpDetail = fbm(st * 2.5 + r * 0.3 + time * 0.2);

      // Combine into distinct, clumpy cotton ball shapes
      float combined = f * 0.7 + clumpDetail * 0.3;
      float cloudMap = smoothstep(0.15, 0.65, combined);
      
      // Create distinct clump borders
      float clumpEdge = smoothstep(0.3, 0.5, f) * smoothstep(0.2, 0.5, clumpDetail);

      // Color
      vec3 colorLow = vec3(0.05, 0.12, 0.35);
      vec3 colorHigh = vec3(0.85, 0.35, 0.2);
      vec3 baseColor = mix(colorLow, colorHigh, u_valence);

      // Subtle internal gradients within each clump
      vec3 grad = vec3(q.x * 0.12, r.y * 0.1, clumpDetail * 0.15);
      vec3 color = baseColor + grad;

      color = mix(color, vec3(0.2, 0.45, 0.75), (1.0 - cloudMap) * (1.0 - u_valence) * 0.4);
      color = mix(color, vec3(0.9, 0.65, 0.3), clumpEdge * u_valence * 0.4);

      float dimness = 0.55 + (u_arousal * 0.45);

      // Density: clumpy with soft bright centers
      float fogDensity = cloudMap * 1.1 + clumpEdge * 0.3 + 0.08;
      
      gl_FragColor = vec4(color * fogDensity * dimness, 1.0);
  }
`;

function createShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export default function Fog({ valence, arousal, mousePos }: { valence: number, arousal: number, mousePos: {x: number, y: number} }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dynamicProps = useRef({ valence, arousal, mousePos });

  useEffect(() => {
    dynamicProps.current = { valence, arousal, mousePos };
  }, [valence, arousal, mousePos]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl");
    if (!gl) return;

    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    if (!vertexShader || !fragmentShader) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);

    const positionLocation = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    const timeLocation = gl.getUniformLocation(program, "u_time");
    const resolutionLocation = gl.getUniformLocation(program, "u_resolution");
    const mouseLocation = gl.getUniformLocation(program, "u_mouse");
    const valenceLocation = gl.getUniformLocation(program, "u_valence");
    const arousalLocation = gl.getUniformLocation(program, "u_arousal");

    let animationFrameId: number;
    const startTime = Date.now();

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
    };
    window.addEventListener("resize", resize);
    resize();

    const render = () => {
      const time = (Date.now() - startTime) * 0.001;
      const p = dynamicProps.current;
      gl.uniform1f(timeLocation, time);
      gl.uniform2f(mouseLocation, p.mousePos.x, canvas.height - p.mousePos.y);
      gl.uniform1f(valenceLocation, p.valence);
      gl.uniform1f(arousalLocation, p.arousal);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      animationFrameId = requestAnimationFrame(render);
    };
    render();

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <canvas 
      ref={canvasRef} 
      className="fixed inset-0 w-full h-full -z-10 pointer-events-none"
    />
  );
}
