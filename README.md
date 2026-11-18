# EJ2311 Modulation – PWM Explorer

Interactive PWM visualisation for EJ2311 *Modulation of Power Electronic Converters* at KTH.
Live at https://enesayaz.github.io/Modulation-Course/.

- Converters: three-phase two-level, single-phase H-bridge (bipolar/unipolar), three-level NPC,
  cascaded H-bridge with 1–3 cells (PS, PD, POD, APOD carriers), and flying capacitor with 3 or 4
  levels (phase-shifted carriers).
- Methods: sine PWM, 1/6 third-harmonic injection, SVM (min–max zero sequence), DPWM1, six-step,
  and two- and three-level selective harmonic elimination.
- Animated circuit schematic with switch states at a time cursor, switched waveform, harmonic
  spectrum, THD / WTHD0, R-L load current, voltage vectors and stator flux.
- 31 examples from the lectures, computer assignments and lab, in the picker at the top.

The page follows the Atlas style: theme tokens, light/dark/system themes, short labels, and every
explanation behind an (i) button.

## One file

The published `index.html` is a **single self-contained file**: CSS, JS and the logo are inlined,
with no external resources. It can be sent on its own and opened by double-click, offline.
`index.html` is generated; do not edit it by hand.

| Source | What it is |
|---|---|
| `src/index.src.html` | Page template (markup and all (i) texts) |
| `assets/css/style.css` | Styles and theme tokens |
| `assets/js/explorer.js` | PWM engine and plots |
| `assets/js/ui.js` | Tooltips, theme switcher, segmented controls |
| `assets/js/examples.js` | The example list |
| `assets/js/fft.js` | Radix-2 FFT |
| `tools/logo.svg` | Logo and favicon |
| `tools/build.py` | Inlines everything into `index.html` |

After changing a source file, rebuild:

```
python tools/build.py
```

`explorer.html` only redirects old links to `index.html`.

## Adding an example

Add an item to `assets/js/examples.js`: an `id`, a `title`, a `text` (use `v_ab` for subscripts) and
a `cfg` with the explorer settings, then rebuild.

## Linking to settings

Settings are kept in the URL, e.g. `index.html#topo=chb&cells=2&arr=ps&strat=spwm&M=0.8&p=10&out=vaz`.
The link button next to the spectrum copies the current one.

Keys: `topo` (`2l hb npc chb fc`), `cells` (`1 2 3`), `fcn` (`2 3`), `arr` (`ps pd pod apod`), `hbmod` (`bip uni`),
`strat` (`spwm thi svm dpwm1 sixstep she`), `carrier` (`tri sawr sawf`), `samp` (`nat sym asym`),
`M`, `p`, `nshe` (`1 3 5 7`), `out` (`vaz vab van ia`), `phi` (load angle, degrees),
`view` (`360 180 90`), `hmax` (`auto 25 50 100 200`), `cur` (time cursor, degrees), `ex` (example id).

## The Source/ folder

`Source/` is the private course archive (book chapters, student submissions, exams, lab results).
It is in `.gitignore` and must never be pushed: the repository is public, and GitHub rejects files
over 100 MB.
