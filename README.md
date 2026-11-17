# EJ2311 Modulation – PWM visualisations

Interactive visualisations of PWM for power electronic converters, made for EJ2311 *Modulation of
Power Electronic Converters* at KTH. Live at https://enesayaz.github.io/Modulation-Course/.

- **Examples** (`index.html`): cases from the lectures, computer assignments and lab, each opening
  the explorer with its settings and a short note on what to look for.
- **PWM Explorer** (`explorer.html`):
  - Converters: three-phase two-level, single-phase H-bridge (bipolar/unipolar), three-level NPC,
    cascaded H-bridge with 1–3 cells (PS, PD, POD, APOD carriers), and flying capacitor with 3 or 4
    levels (phase-shifted carriers).
  - Methods: sine PWM, 1/6 third-harmonic injection, SVM (min–max zero sequence), DPWM1, six-step,
    and two- and three-level selective harmonic elimination.
  - Animated circuit schematic with switch states at a time cursor, switched waveform, harmonic
    spectrum, THD / WTHD0, R-L load current, voltage vectors and stator flux.

It is a plain static site (HTML/CSS/JS, no build step, no external libraries), served by GitHub Pages.

## Layout

| Path | What it is |
|---|---|
| `index.html` | Example gallery |
| `explorer.html`, `assets/js/explorer.js` | PWM explorer |
| `assets/js/examples.js` | The example list, shared by the gallery and the explorer |
| `assets/js/fft.js` | Radix-2 FFT used by the explorer |
| `assets/css/style.css` | Shared styles (light and dark mode) |

## Adding an example

Add an item to `assets/js/examples.js`: an `id`, a `title`, a `text` (use `v_ab` for subscripts) and
a `cfg` with the explorer settings. It then appears both in the gallery and in the explorer's picker.

## Linking to explorer settings

The explorer keeps its settings in the URL, e.g.
`explorer.html#topo=chb&cells=2&arr=ps&strat=spwm&M=0.8&p=10&out=vaz`. Use the **Copy link** button
to get a link for the current settings.

Keys: `topo` (`2l hb npc chb fc`), `cells` (`1 2 3`), `fcn` (`2 3`), `arr` (`ps pd pod apod`), `hbmod` (`bip uni`),
`strat` (`spwm thi svm dpwm1 sixstep she`), `carrier` (`tri sawr sawf`), `samp` (`nat sym asym`),
`M`, `p`, `nshe` (`1 3 5 7`), `out` (`vaz vab van ia`), `phi` (load angle, degrees),
`view` (`360 180 90`), `hmax` (`auto 25 50 100 200`), `cur` (time cursor, degrees), `ex` (example id).

## The Source/ folder

`Source/` is the private course archive (book chapters, student submissions, exams, lab results).
It is in `.gitignore` and must never be pushed: the repository is public, and GitHub rejects files
over 100 MB.

## Preview locally

```
python -m http.server 8000
```
then open http://localhost:8000.
