// The CRT: draws the airing Clip onto a WebGL canvas as a curved TV
// picture, with the Date stamp burned in so it bends along with it. How it
// looks is set entirely by LOOK.
import type { DateStampLines } from "./date-stamp.ts";
import { LOOK } from "./look.ts";

// What's on screen in a frame.
export interface Picture {
  video: HTMLVideoElement;
  dateStamp: DateStampLines | null;
}

const VERTEX_SHADER = `
attribute vec2 position;
varying vec2 vUv;
void main() {
  // Texture coordinates run top to bottom, like the images uploaded to them.
  vUv = vec2(position.x, -position.y) * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uVideo;
uniform sampler2D uStamp;
uniform bool uSignal;
uniform float uDistortion;
uniform float uVignette;
uniform vec3 uBackground;
uniform vec2 uResolution;
void main() {
  // Barrel distortion, scaled so the middle of each edge stays put and the
  // corners curve away into the background.
  vec2 centred = vUv * 2.0 - 1.0;
  centred *= (1.0 + uDistortion * dot(centred, centred)) / (1.0 + uDistortion);
  vec2 uv = centred * 0.5 + 0.5;

  // 1 inside the curved screen, 0 outside, antialiased over a pixel.
  vec2 edge = min(uv, 1.0 - uv) * uResolution;
  float inside = clamp(min(edge.x, edge.y) + 0.5, 0.0, 1.0);

  vec3 picture = vec3(0.0);
  if (uSignal) {
    picture = texture2D(uVideo, uv).rgb;
    vec4 stamp = texture2D(uStamp, uv);
    picture = mix(picture, stamp.rgb, stamp.a);
  }
  // 1 at the centre, falling to 0 at the edges; kept above 0 since pow(0, 0)
  // is undefined.
  float falloff = max(16.0 * uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y), 1e-6);
  gl_FragColor = vec4(mix(uBackground, picture * pow(falloff, uVignette), inside), 1.0);
}`;

// Draws `picture()` (null for a blank screen) onto `canvas` every frame.
// Without WebGL the screen stays blank.
export function startCrt(canvas: HTMLCanvasElement, picture: () => Picture | null): void {
  // The page sizes the canvas to fit the viewport at this ratio.
  document.documentElement.style.setProperty("--aspect-ratio", String(LOOK.screen.aspectRatio));
  const stamp = new StampLayer();
  let renderer = createRenderer(canvas);
  if (!renderer) console.error("WebGL is unavailable: the CRT can't draw");

  // Mobile browsers drop WebGL contexts under memory pressure or in the
  // background; asking to restore one means starting the renderer afresh.
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    renderer = null;
  });
  canvas.addEventListener("webglcontextrestored", () => {
    renderer = createRenderer(canvas);
    stamp.invalidate();
  });

  function frame(): void {
    renderer?.draw(picture(), stamp);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

interface Renderer {
  draw(picture: Picture | null, stamp: StampLayer): void;
}

function createRenderer(canvas: HTMLCanvasElement): Renderer | null {
  const context = canvas.getContext("webgl", { alpha: false, antialias: false });
  if (!context || context.isContextLost()) return null;
  // Narrowed once, for the functions below.
  const gl: WebGLRenderingContext = context;
  const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;

  const program = createProgram(gl);
  gl.useProgram(program);
  // A quad covering the canvas, as a triangle strip.
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const uniform = (name: string) => gl.getUniformLocation(program, name);
  gl.uniform1i(uniform("uVideo"), 0);
  gl.uniform1i(uniform("uStamp"), 1);
  gl.uniform1f(uniform("uDistortion"), LOOK.screen.distortion);
  gl.uniform1f(uniform("uVignette"), LOOK.screen.vignette);
  gl.uniform3fv(uniform("uBackground"), hexToRgb(LOOK.background));
  const signal = uniform("uSignal");
  const resolution = uniform("uResolution");

  const videoTexture = createTexture(gl, gl.TEXTURE0);
  const stampTexture = createTexture(gl, gl.TEXTURE1);

  // Matches the drawing buffer to the canvas's size on screen, within what
  // the GPU can take as a texture (the Date stamp is drawn at this size).
  function resize(): void {
    const scale = Math.min(devicePixelRatio, maxSize / canvas.clientWidth, maxSize / canvas.clientHeight);
    const width = Math.round(canvas.clientWidth * scale);
    const height = Math.round(canvas.clientHeight * scale);
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = width;
    canvas.height = height;
    gl.viewport(0, 0, width, height);
    gl.uniform2f(resolution, width, height);
  }

  function upload(texture: WebGLTexture, unit: number, source: TexImageSource): void {
    gl.activeTexture(unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  return {
    draw(picture, stamp) {
      resize();
      // A video still loading or seeking (just cut to, say) has no frame of
      // its own to show yet: a blank screen beats a stale frame from
      // whatever was on before.
      const video = picture?.video;
      const showing = video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && !video.seeking;
      gl.uniform1i(signal, showing ? 1 : 0);
      if (showing) {
        upload(videoTexture, gl.TEXTURE0, video);
        const pixelRatio = canvas.width / canvas.clientWidth;
        if (stamp.update(picture.dateStamp, canvas.width, canvas.height, pixelRatio)) {
          upload(stampTexture, gl.TEXTURE1, stamp.canvas);
        }
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
  };
}

// CSS pixels per point.
const PIXELS_PER_POINT = 4 / 3;

const DIGITS = "0123456789";

// A piece of text placed at (x, y) on the Date stamp's canvas.
interface Glyphs {
  text: string;
  x: number;
  y: number;
}

// The Date stamp, drawn as text on a transparent canvas the size of the
// picture, redrawn only when it changes.
class StampLayer {
  readonly canvas = document.createElement("canvas");
  private readonly context = this.canvas.getContext("2d")!;
  // Identifies what's currently drawn, to tell when it needs redrawing.
  private drawnKey = "";
  private fontLoaded = false;

  constructor() {
    // Until the font arrives, show no Date stamp rather than one in a
    // fallback font.
    const loaded = () => (this.fontLoaded = true);
    document.fonts.load(`16px "${LOOK.dateStamp.font}"`).then(loaded, loaded);
  }

  // Forces the next update to redraw, e.g. for a new texture to take it.
  invalidate(): void {
    this.drawnKey = "";
  }

  // Redraws for `lines` at `width`x`height`, with `pixelRatio` of the
  // canvas's pixels to a CSS pixel on screen, if anything's changed;
  // returns whether it did.
  update(lines: DateStampLines | null, width: number, height: number, pixelRatio: number): boolean {
    const shown = this.fontLoaded ? lines : null;
    const key = JSON.stringify([shown, width, height, pixelRatio]);
    if (key === this.drawnKey) return false;
    this.drawnKey = key;

    const { canvas, context } = this;
    canvas.width = width;
    canvas.height = height;
    context.clearRect(0, 0, width, height);
    if (shown) {
      const { font, size, lineHeight, left, bottom, colour, stroke } = LOOK.dateStamp;
      context.font = `${size * height}px "${font}"`;
      const x = left * width;
      const y = (1 - bottom) * height;
      const glyphs = [
        { text: shown[0], x, y: y - lineHeight * size * height },
        ...this.monospaced(shown[1], x, y),
      ];
      // Strokes are centred on the outline, so twice as wide as the part
      // showing outside it, and drawn first so the fill covers the inside.
      if (stroke.width > 0) {
        context.lineWidth = 2 * stroke.width * PIXELS_PER_POINT * pixelRatio;
        context.lineJoin = "round";
        context.strokeStyle = stroke.colour;
        for (const glyph of glyphs) context.strokeText(glyph.text, glyph.x, glyph.y);
      }
      context.fillStyle = colour;
      for (const glyph of glyphs) context.fillText(glyph.text, glyph.x, glyph.y);
    }
    return true;
  }

  // Lays `text` out from (x, y) with every digit in a cell as wide as the
  // widest, so ticking digits don't shift what follows them.
  private monospaced(text: string, x: number, y: number): Glyphs[] {
    const measure = (char: string) => this.context.measureText(char).width;
    const digitWidth = Math.max(...[...DIGITS].map(measure));
    const glyphs: Glyphs[] = [];
    for (const char of text) {
      const width = measure(char);
      const cell = DIGITS.includes(char) ? digitWidth : width;
      glyphs.push({ text: char, x: x + (cell - width) / 2, y });
      x += cell;
    }
    return glyphs;
  }
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram {
  const program = gl.createProgram()!;
  gl.attachShader(program, createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? "link failed");
  }
  return program;
}

function createShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? "compile failed");
  }
  return shader;
}

// A texture for images of any size (WebGL 1 only mipmaps and repeats
// power-of-two ones), bound to `unit`.
function createTexture(gl: WebGLRenderingContext, unit: number): WebGLTexture {
  const texture = gl.createTexture()!;
  gl.activeTexture(unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  // An empty texture until the first upload.
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  return texture;
}

// "#rrggbb" as RGB components from 0 to 1.
function hexToRgb(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}
