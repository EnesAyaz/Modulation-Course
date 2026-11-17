# EJ2311 Modulation of Power Electronic Converters

Course website for EJ2311 (KTH): syllabus, assignments, materials and an interactive
**PWM Explorer** (three-phase two-level VSI: sine PWM, 1/6 third-harmonic injection, SVM, DPWM1,
six-step and selective harmonic elimination; natural / regular sampling; waveform, harmonic spectrum,
THD / WTHD0, R-L load current and αβ space vectors).

It is a plain static site (HTML/CSS/JS, no build step, no external libraries), served by GitHub Pages.

## Layout

| Path | What goes there |
|---|---|
| `index.html` | Home page and announcements |
| `syllabus.html` | Course info, weekly outline, grading (fill in the `[placeholders]`) |
| `assignments.html` | Computer exercises and lab; files go in `assignments/` |
| `materials.html` | Lecture table; files go in `materials/lectures/`, `materials/code/` |
| `explorer.html`, `assets/js/explorer.js` | PWM explorer |
| `assets/js/fft.js` | Radix-2 FFT used by the explorer |
| `assets/css/style.css` | Shared styles (light and dark mode) |

GitHub Pages does not list folder contents, so link each file directly, e.g.
`<a href="materials/lectures/week01.pdf">week01.pdf</a>`.

## Linking to explorer settings

The explorer keeps its settings in the URL, e.g.
`explorer.html#strat=svm&carrier=tri&samp=asym&M=1&p=9&out=vab`. Use the **Copy link** button to
get a link for the current settings and paste it into an assignment or slide.

Keys: `strat` (`spwm thi svm dpwm1 sixstep she`), `carrier` (`tri sawr sawf`), `samp` (`nat sym asym`),
`M`, `p`, `nshe` (`1 3 5 7`), `out` (`vaz vab van ia`), `phi` (load angle, degrees),
`view` (`360 180 90`), `hmax` (`auto 25 50 100 200`).

## The Source/ folder

`Source/` is the private course archive (book chapters, student submissions, exams, lab results).
It is in `.gitignore` and must never be pushed: the repository is public once Pages is on, and
GitHub rejects files over 100 MB. Copy individual files you want to publish into `assignments/` or
`materials/` and link them from the pages.

## Preview locally

```
python -m http.server 8000
```
then open http://localhost:8000.

## Publish on GitHub Pages

1. Create a repository on GitHub and push this folder to the `main` branch.
2. In the repository: **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   branch `main`, folder `/ (root)`.
3. The site appears at `https://<user>.github.io/<repository>/` after a minute.
