// Every visual parameter of the picture, in one place, for tuning by hand.
// Edit a value and reload; nothing else needs to change.
export const LOOK = {
  // Behind and around the screen, as "#rrggbb".
  background: "#000000",

  // The curved CRT screen, filling the viewport at this width:height.
  screen: {
    aspectRatio: 16 / 9,
    screenSizePercent: 0.7,
    // Barrel distortion: 0 is flat; larger bulges the picture more and
    // rounds off the corners. Around 0.02–0.15 looks like a TV.
    distortion: 0.06,
    // How strongly the picture darkens towards its edges: 0 is none.
    // Around 0.1–0.5.
    vignette: 0.35,
  },

  // The camcorder Date stamp, drawn onto the picture before it's curved.
  dateStamp: {
    // Self-hosted (see main.ts), so it must match an @font-face we serve.
    font: "Jersey 25",
    // Text size, as a fraction of the picture's height.
    size: 0.032,
    // Distance between the two lines' baselines, as a multiple of `size`.
    lineHeight: 1.0,
    // The bottom-left corner of the text, as fractions of the picture's
    // width and height from its left and bottom edges.
    left: 0.09,
    bottom: 0.9,
    // Any CSS colour.
    colour: "#ffffff",
    // An outline around the text: `width` in points on screen (0 for
    // none), `colour` any CSS colour.
    stroke: { width: 1, colour: "#000000" },
  },
} as const;
